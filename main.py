"""
메루카리(mercari.jp) 브랜드/카테고리/가격 조건에 맞는 신규 매물을
디스코드 웹훅으로 알려주는 스크립트.
- 카테고리/브랜드 ID는 하드코딩하지 않는다. GitHub Actions 워크플로우가
  이 스크립트를 실행하기 전에 mercapi 공식 유틸(utils/fetch_facets.py)을
  실제로 실행해서 최신 카테고리/브랜드 ID 목록을 ./facets/ 폴더에 생성해두고,
  이 스크립트는 그 폴더 안의 모든 JSON 파일을 읽어 이름으로 매칭한다.
  (Mercari 내부 ID는 수시로 바뀔 수 있어서, 정적 URL을 하드코딩하지 않고
  항상 그 시점의 최신 값을 직접 생성해서 쓰는 방식이 더 안정적이다.)
- 이미 알림을 보낸 상품 ID는 data/seen.json 에 저장해두고,
  다음 실행에서 새 ID만 다시 알림.
- 디스코드 알림은 embed 10개씩 묶어서 한 번의 webhook 요청으로 보낸다
  (레이트리밋 회피 목적). 배치 사이에는 0.5초 딜레이를 둔다.
  전송에 성공한 배치의 아이템만 seen에 기록하고, 실패한 배치는
  다음 실행에서 자동으로 재시도된다.
"""
import asyncio
import json
import os
import sys
import time
from pathlib import Path
import httpx
from mercapi import Mercapi
from mercapi.requests import SearchRequestData

# ----------------------------------------------------------------------
# 설정
# ----------------------------------------------------------------------
# DIESEL, HYSTERIC GLAMOUR는 매물이 너무 많이 쏟아져서 제외함
# PRADA는 빼고 PRADA SPORT(PRADA LINEA ROSSA)로 대체함
TARGET_BRANDS = {
    "NUMBER (N)INE": ["NUMBER (N)INE", "ナンバーナイン"],
    "COMME des GARCONS": ["COMME des GARCONS", "COMME des GARÇONS", "コムデギャルソン"],
    "COMME des GARCONS HOMME": ["COMME des GARCONS HOMME", "COMME des GARÇONS HOMME", "コムデギャルソン オム"],
    "COMME des GARCONS HOMME PLUS": [
        "COMME des GARCONS HOMME PLUS",
        "COMME des GARÇONS HOMME PLUS",
        "コムデギャルソン オムプリュス",
    ],
    "PRADA": ["PRADA", "プラダ"],
    "PRADA SPORT": ["PRADA SPORT", "プラダスポーツ", "PRADA LINEA ROSSA", "プラダ リネアロッサ"],
    "Maison Margiela": [
        "Maison Margiela",
        "メゾンマルジェラ",
        "Martin Margiela",
        "マルタンマルジェラ",
        "メゾン マルタン マルジェラ",
    ],
    "HELMUT LANG": ["HELMUT LANG", "ヘルムートラング"],
    "D&G": ["D&G", "ディーアンドジー", "Dolce & Gabbana", "ドルチェ&ガッバーナ", "ドルチェアンドガッバーナ"],
    "Raf Simons": ["Raf Simons", "ラフシモンズ"],
    "Junya Watanabe": ["Junya Watanabe", "ジュンヤワタナベ"],
    "NIL ADMIRARI": ["NIL ADMIRARI", "ニルアドミラリ"],
}
TARGET_CATEGORY_CANDIDATES = ["メンズファッション", "男性ファッション", "men's fashion", "メンズ"]
PRICE_MAX = 10000  # 엔
CHUNK_SIZE = 10  # 디스코드 embed는 메시지 하나에 최대 10개까지

FACETS_DIR = Path(__file__).parent / "facets"
DATA_DIR = Path(__file__).parent / "data"
SEEN_FILE = DATA_DIR / "seen.json"
MAX_SEEN_KEEP = 3000
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

# ----------------------------------------------------------------------
# facets(카테고리/브랜드 ID) 조회
# ----------------------------------------------------------------------
def _flatten(node, out):
    if isinstance(node, dict):
        if "id" in node and "name" in node:
            out.append(node)
        for v in node.values():
            _flatten(v, out)
    elif isinstance(node, list):
        for item in node:
            _flatten(item, out)


def load_facets():
    entries = []
    if not FACETS_DIR.exists():
        return entries
    json_files = list(FACETS_DIR.rglob("*.json"))
    for path in json_files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            print(f"경고: {path} 파싱 실패: {e}", file=sys.stderr)
            continue
        _flatten(data, entries)
    print(f"facets 파일 {len(json_files)}개에서 항목 {len(entries)}개 로드")
    return entries


def resolve_category_id(entries):
    for cand in TARGET_CATEGORY_CANDIDATES:
        for c in entries:
            if cand.lower() in str(c.get("name", "")).lower():
                return c["id"], c.get("name")
    return None, None


def resolve_brand_ids(entries):
    resolved = {}
    missing = []
    for display_name, candidates in TARGET_BRANDS.items():
        found = None
        for cand in candidates:
            for b in entries:
                if str(b.get("name", "")).strip().lower() == cand.strip().lower():
                    found = b
                    break
            if found:
                break
        if not found:
            for cand in candidates:
                for b in entries:
                    if cand.strip().lower() in str(b.get("name", "")).lower():
                        found = b
                        break
                if found:
                    break
        if found:
            resolved[display_name] = found["id"]
        else:
            missing.append(display_name)
    return resolved, missing


# ----------------------------------------------------------------------
# seen 기록
# ----------------------------------------------------------------------
def load_seen():
    if SEEN_FILE.exists():
        try:
            return set(json.loads(SEEN_FILE.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            return set()
    return set()


def save_seen(seen_ids):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    trimmed = list(seen_ids)[-MAX_SEEN_KEEP:]
    SEEN_FILE.write_text(json.dumps(trimmed, ensure_ascii=False), encoding="utf-8")


# ----------------------------------------------------------------------
# 디스코드 알림 (배치 전송)
# ----------------------------------------------------------------------
def _match_brand_display_name(item_name: str) -> str:
    """상품명 텍스트에서 TARGET_BRANDS 중 어느 브랜드에 해당하는지 찾아
    사람이 보기 좋은 표시용 이름을 반환. 못 찾으면 '브랜드 미상' 반환."""
    lowered = (item_name or "").lower()
    for display_name, candidates in TARGET_BRANDS.items():
        if any(cand.lower() in lowered for cand in candidates):
            return display_name
    return "브랜드 미상"


def _build_embed(item):
    price = getattr(item, "price", None)
    name = getattr(item, "name", "(제목 없음)")
    item_id = getattr(item, "id_", None) or getattr(item, "id", None)
    mercari_url = f"https://jp.mercari.com/item/{item_id}"
    url = f"https://kenzpost.com/mercari/bid.s/{mercari_url}"  # 켄즈포스트 구매대행 링크
    image_url = None
    for attr in ("thumbnails", "photos", "photo_urls", "images"):
        value = getattr(item, attr, None)
        if value:
            image_url = value[0] if isinstance(value, (list, tuple)) else value
            break
    brand_display = _match_brand_display_name(name)
    embed = {
        "title": brand_display,
        "url": url,
        "description": f"💴 {price}円",
        "color": 0x2ECC71,
    }
    if image_url:
        embed["image"] = {"url": image_url}  # 큰 이미지로 표시
    return embed


def send_discord_batch(client: httpx.Client, items, max_retries: int = 5) -> bool:
    """여러 아이템을 embed 여러 개로 묶어 한 번의 webhook 요청으로 전송.
    성공하면 True, 재시도 소진 시 False를 반환한다."""
    if not DISCORD_WEBHOOK_URL:
        print("경고: DISCORD_WEBHOOK_URL 환경변수가 없어 알림을 건너뜁니다.", file=sys.stderr)
        return False

    embeds = [_build_embed(item) for item in items]
    payload = {"embeds": embeds}

    for attempt in range(max_retries):
        resp = client.post(DISCORD_WEBHOOK_URL, json=payload, timeout=15)
        if resp.status_code < 300:
            return True
        if resp.status_code == 429:
            try:
                retry_after = resp.json().get("retry_after", 1.0)
            except Exception:
                retry_after = 1.0
            wait = float(retry_after) + 0.3
            print(f"디스코드 레이트리밋, {wait:.1f}초 대기 후 재시도 ({attempt + 1}/{max_retries})", file=sys.stderr)
            time.sleep(wait)
            continue
        print(f"디스코드 전송 실패({resp.status_code}): {resp.text}", file=sys.stderr)
        return False

    print("디스코드 전송 실패: 재시도 소진", file=sys.stderr)
    return False


# ----------------------------------------------------------------------
# 메인
# ----------------------------------------------------------------------
async def main():
    facets = load_facets()
    if not facets:
        print(
            "오류: ./facets 폴더에 유효한 facets 데이터가 없습니다. "
            "워크플로우의 'Fetch latest Mercari category/brand facets' 단계가 "
            "성공했는지 로그를 확인하세요.",
            file=sys.stderr,
        )
        sys.exit(1)

    category_id, category_name = resolve_category_id(facets)
    if category_id is None:
        print("경고: '남성 패션' 카테고리를 facets 파일에서 찾지 못했습니다. "
              "카테고리 필터 없이 검색합니다.", file=sys.stderr)
    else:
        print(f"카테고리 매칭: {category_name} (id={category_id})")

    brand_id_map, missing_brands = resolve_brand_ids(facets)
    if missing_brands:
        print(f"경고: 다음 브랜드는 facets에서 매칭되지 않았습니다: {missing_brands}", file=sys.stderr)
    if not brand_id_map:
        print("오류: 매칭된 브랜드가 하나도 없습니다. TARGET_BRANDS 후보 이름을 확인하세요.", file=sys.stderr)
        return

    print(f"검색 대상 브랜드({len(brand_id_map)}개): {list(brand_id_map.keys())}")
    brand_ids = list(brand_id_map.values())

    m = Mercapi()
    status_filter = []
    status_enum = getattr(SearchRequestData, "Status", None)
    if status_enum is not None:
        for candidate in ("ON_SALE", "STATUS_ON_SALE", "SELLING"):
            member = getattr(status_enum, candidate, None)
            if member is not None:
                status_filter = [member]
                break

    kwargs = dict(
        categories=[category_id] if category_id else [],
        brands=brand_ids,
        price_max=PRICE_MAX,
        status=status_filter,
    )
    sort_by = getattr(SearchRequestData.SortBy, "SORT_CREATED_TIME", None)
    if sort_by is not None:
        kwargs["sort_by"] = sort_by
        kwargs["sort_order"] = SearchRequestData.SortOrder.ORDER_DESC

    results = await m.search("", **kwargs)

    is_first_run = not SEEN_FILE.exists()
    seen = load_seen()
    new_items = []
    for item in results.items:
        item_id = getattr(item, "id_", None) or getattr(item, "id", None)
        # 주의: 여기서는 seen에 바로 넣지 않는다. 전송 성공 여부를 확인한 뒤에
        # 넣어야, 실패한 항목이 다음 실행에서 다시 시도된다.
        if item_id and item_id not in seen:
            new_items.append(item)

    print(f"검색 결과 {len(results.items)}건 중 신규 {len(new_items)}건")

    if is_first_run:
        for item in new_items:
            item_id = getattr(item, "id_", None) or getattr(item, "id", None)
            if item_id:
                seen.add(item_id)
        print("첫 실행이므로 알림 없이 현재 매물을 기준점으로만 저장합니다.")
    elif new_items:
        with httpx.Client() as sync_client:
            success_count = 0
            for i in range(0, len(new_items), CHUNK_SIZE):
                chunk = new_items[i:i + CHUNK_SIZE]
                ok = send_discord_batch(sync_client, chunk)
                if ok:
                    for item in chunk:
                        item_id = getattr(item, "id_", None) or getattr(item, "id", None)
                        if item_id:
                            seen.add(item_id)
                    success_count += len(chunk)
                time.sleep(0.5)  # 배치 사이 최소 간격
            print(f"전송 성공 {success_count}건 / 시도 {len(new_items)}건 (배치 단위 전송)")

    save_seen(seen)


if __name__ == "__main__":
    asyncio.run(main())
