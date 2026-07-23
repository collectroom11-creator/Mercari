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
"""

import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
from mercapi import Mercapi
from mercapi.requests import SearchRequestData

# ----------------------------------------------------------------------
# 설정
# ----------------------------------------------------------------------

# 찾고 싶은 브랜드 이름들. 매칭이 잘 안 되는 브랜드가 있으면
# 실행 로그에 경고가 뜨니, 그때 별칭을 추가하면 된다.
# key: 사람이 알아보기 쉬운 이름, value: facets 파일에서 매칭을 시도할 후보 문자열들
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
    "Maison Margiela": ["Maison Margiela", "メゾンマルジェラ", "Martin Margiela", "マルタンマルジェラ"],
    "HELMUT LANG": ["HELMUT LANG", "ヘルムートラング"],
    "D&G": ["D&G", "ディーアンドジー", "Dolce & Gabbana", "ドルチェ&ガッバーナ"],
    "Raf Simons": ["Raf Simons", "ラフシモンズ"],
    "Junya Watanabe": ["Junya Watanabe", "ジュンヤワタナベ"],
    "junhashimoto": ["junhashimoto", "ジュンハシモト"],
    "ARMANI EXCHANGE": ["ARMANI EXCHANGE", "A|X ARMANI EXCHANGE", "アルマーニ エクスチェンジ"],
    "DIESEL": ["DIESEL", "ディーゼル"],
    "HYSTERIC GLAMOUR": ["HYSTERIC GLAMOUR", "ヒステリックグラマー"],
    "NIL ADMIRARI": ["NIL ADMIRARI", "ニルアドミラリ"],
}

# 카테고리: 패션 > 남성 패션. facets 파일에서 이름으로 검색해서 찾는다.
TARGET_CATEGORY_CANDIDATES = ["メンズファッション", "男性ファッション", "men's fashion", "メンズ"]

PRICE_MAX = 10000  # 엔

# GitHub Actions 워크플로우가 실행 전에 utils/fetch_facets.py로 생성해두는 폴더
FACETS_DIR = Path(__file__).parent / "facets"

DATA_DIR = Path(__file__).parent / "data"
SEEN_FILE = DATA_DIR / "seen.json"
MAX_SEEN_KEEP = 3000  # 파일이 무한정 커지지 않도록 최근 N개만 유지

DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")


# ----------------------------------------------------------------------
# facets(카테고리/브랜드 ID) 조회
# ----------------------------------------------------------------------

def _flatten(node, out):
    """facets json은 트리/리스트 구조가 섞여 있을 수 있어 재귀적으로 평탄화.
    id와 name을 동시에 가진 dict만 후보로 수집한다."""
    if isinstance(node, dict):
        if "id" in node and "name" in node:
            out.append(node)
        for v in node.values():
            _flatten(v, out)
    elif isinstance(node, list):
        for item in node:
            _flatten(item, out)


def load_facets():
    """./facets 폴더 아래 모든 *.json 파일을 읽어 (id, name) 후보를 모아 반환.
    카테고리 파일인지 브랜드 파일인지 구분하지 않고 전부 하나의 풀로 모은다 —
    카테고리 이름과 브랜드 이름은 서로 겹치지 않으므로, 이름으로 찾을 때는
    이렇게 합쳐도 결과가 달라지지 않고, 파일명을 정확히 몰라도 되는 장점이 있다.
    """
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
        # 정확히 일치하는 게 없으면 부분 일치로 한 번 더 시도
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
# 검색 + 알림
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


def send_discord_notification(client: httpx.Client, item):
    if not DISCORD_WEBHOOK_URL:
        print("경고: DISCORD_WEBHOOK_URL 환경변수가 없어 알림을 건너뜁니다.", file=sys.stderr)
        return

    price = getattr(item, "price", None)
    name = getattr(item, "name", "(제목 없음)")
    item_id = getattr(item, "id_", None) or getattr(item, "id", None)
    url = f"https://jp.mercari.com/item/{item_id}"

    # mercapi 버전에 따라 사진 관련 속성 이름이 다를 수 있어 여러 후보를 순서대로 확인
    image_url = None
    for attr in ("thumbnails", "photos", "photo_urls", "images"):
        value = getattr(item, attr, None)
        if value:
            image_url = value[0] if isinstance(value, (list, tuple)) else value
            break

    embed = {
        "title": name[:250],
        "url": url,
        "description": f"💴 {price}円",
        "color": 0x2ECC71,
    }
    if image_url:
        embed["image"] = {"url": image_url}  # 큰 이미지로 표시
    else:
        print(f"경고: {item_id} 상품의 이미지 URL을 찾지 못했습니다.", file=sys.stderr)

    payload = {"embeds": [embed]}
    resp = client.post(DISCORD_WEBHOOK_URL, json=payload, timeout=15)
    if resp.status_code >= 300:
        print(f"디스코드 전송 실패({resp.status_code}): {resp.text}", file=sys.stderr)


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
    # Status enum 멤버 이름이 라이브러리 버전에 따라 다를 수 있어 안전하게 조회
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
    # "새로 올라온 순"으로 정렬할 수 있으면 사용, 없으면 기본 정렬로 조회
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
        if item_id and item_id not in seen:
            new_items.append(item)
            seen.add(item_id)

    print(f"검색 결과 {len(results.items)}건 중 신규 {len(new_items)}건")

    if is_first_run:
        # 첫 실행에서는 기존 매물 전체가 알림으로 쏟아지지 않도록
        # seen 목록만 채워두고 알림은 보내지 않는다.
        print("첫 실행이므로 알림 없이 현재 매물을 기준점으로만 저장합니다.")
    elif new_items:
        with httpx.Client() as sync_client:
            for item in new_items:
                send_discord_notification(sync_client, item)

    save_seen(seen)


if __name__ == "__main__":
    asyncio.run(main())
