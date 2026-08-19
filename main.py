"""
메루카리(mercari.jp) 브랜드/카테고리/가격 조건에 맞는 신규 매물을
디스코드 웹훅으로 알려주는 스크립트.
- 카테고리/브랜드 ID는 하드코딩하지 않는다. facets/ 폴더는 별도의
  하루 1회짜리 워크플로우(fetch-facets.yml)가 미리 생성/커밋해두고,
  이 스크립트는 그 폴더 안의 모든 JSON 파일을 읽어 이름으로 매칭한다.
  (Mercari 내부 ID는 수시로 바뀔 수 있어서, 정적 URL을 하드코딩하지 않고
  최신 값을 생성해서 쓰는 방식이 더 안정적이다. 다만 15분마다 도는 이
  워크플로우에서 매번 재수집할 필요는 없어서 별도 워크플로우로 분리했다.)
- 이미 알림을 보낸 상품 ID는 data/seen.json 에 저장해두고,
  다음 실행에서 새 ID만 다시 알림.
  ⚠️ seen 저장은 "배치 전송 성공 직후" 그때그때 디스크에 반영한다.
  (예전에는 모든 배치를 다 보낸 뒤 마지막에 한 번만 저장했는데, 그 사이에
  워크플로우가 타임아웃/취소로 강제 종료되면 이미 보낸 알림의 기록이
  하나도 안 남아 다음 실행에서 같은 상품이 중복 알림으로 나가는 문제가
  있었다. 배치마다 즉시 저장하면 강제 종료돼도 이미 보낸 것까지는
  안전하게 기록된다.)
- 디스코드 알림은 embed 10개씩 묶어서 한 번의 webhook 요청으로 보낸다
  (레이트리밋 회피 목적). 배치 사이에는 0.5초 딜레이를 둔다.
  전송에 성공한 배치의 아이템만 seen에 기록하고, 실패한 배치는
  다음 실행에서 자동으로 재시도된다.
- 신규 아이템의 브랜드 역산출용 상세조회(full_item)는 세마포어로
  동시 처리 개수를 제한해 병렬로 호출한다. (예전에는 한 건씩 순서대로
  기다렸는데, 신규 매물이 몰리는 시간대에 이게 병목이 되어 워크플로우
  타임아웃의 주요 원인이 되었다.)
- 카테고리 매칭은 "정확 일치"를 "부분 일치"보다 우선한다. 메루카리가
  카테고리 구조를 바꿔서 후보 문자열을 포함하는 엉뚱한(더 좁은) 카테고리가
  새로 생기면, 부분 일치만으로는 의도치 않은 카테고리에 잘못 매칭될 수
  있기 때문이다. 또한 이전 실행과 카테고리 id가 달라지면 data/last_category.json
  기록과 비교해 stderr에 경고를 남겨, 검색 결과가 조용히 0건이 되는 상황을
  미리 알아챌 수 있게 한다.
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

from config import (
    TARGET_BRANDS,
    PRICE_MAX,
    BRAND_PRICE_OVERRIDES,
    TARGET_CATEGORY_CANDIDATES,
    EXCLUDE_KEYWORDS,
)

# ----------------------------------------------------------------------
# 설정
# ----------------------------------------------------------------------
# 브랜드/가격/카테고리/제외키워드는 config.py에서 관리합니다.
# 필터 조건을 바꾸고 싶으면 이 파일이 아니라 config.py를 수정하세요.

CHUNK_SIZE = 10  # 디스코드 embed는 메시지 하나에 최대 10개까지
DETAIL_FETCH_CONCURRENCY = 5  # full_item() 상세조회 동시 실행 개수

FACETS_DIR = Path(__file__).parent / "facets"
DATA_DIR = Path(__file__).parent / "data"
SEEN_FILE = DATA_DIR / "seen.json"
LAST_CATEGORY_FILE = DATA_DIR / "last_category.json"
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
    """카테고리 후보 문자열로 facets에서 카테고리를 찾는다.

    부분 문자열 매칭만 쓰면, 메루카리가 카테고리 구조를 바꿔서 후보
    문자열을 포함하는 다른(보통 더 좁은) 카테고리가 새로 생겼을 때
    엉뚱한 카테고리에 잘못 매칭될 수 있다. 그래서 이름이 후보와
    "정확히" 일치하는 카테고리를 먼저 찾고, 그게 하나도 없을 때만
    기존처럼 부분 문자열 포함 매칭으로 폴백한다.
    """
    # 1순위: 정확 일치
    for cand in TARGET_CATEGORY_CANDIDATES:
        for c in entries:
            name = str(c.get("name", "")).strip()
            if name.lower() == cand.strip().lower():
                return c["id"], c.get("name")

    # 2순위: 정확 일치가 하나도 없을 때만 부분 일치로 폴백
    for cand in TARGET_CATEGORY_CANDIDATES:
        for c in entries:
            if cand.lower() in str(c.get("name", "")).lower():
                return c["id"], c.get("name")

    return None, None


def check_category_drift(category_id, category_name):
    """카테고리 id가 이전 실행과 달라졌으면 경고를 남기고 기록을 갱신한다.

    메루카리가 카테고리 구조를 바꿔서 검색 범위가 의도치 않게 좁아지거나
    엉뚱해지면, 검색 결과가 갑자기 0건 근처로 조용히 줄어들 수 있다.
    이전에 성공했던 category_id를 파일로 남겨두고 매 실행마다 비교하면,
    그런 상황이 생겼을 때 바로 로그에서 알아챌 수 있다.
    """
    prev = None
    if LAST_CATEGORY_FILE.exists():
        try:
            prev = json.loads(LAST_CATEGORY_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            prev = None

    if prev is not None and prev.get("id") != category_id:
        print(
            f"⚠️ 경고: 카테고리 id가 바뀌었습니다! "
            f"이전: {prev.get('name')}(id={prev.get('id')}) → "
            f"현재: {category_name}(id={category_id}). "
            f"검색 범위가 의도와 달라졌을 수 있으니 확인이 필요합니다.",
            file=sys.stderr,
        )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LAST_CATEGORY_FILE.write_text(
        json.dumps({"id": category_id, "name": category_name}, ensure_ascii=False),
        encoding="utf-8",
    )


def resolve_brand_ids(entries):
    resolved = {}
    missing = []
    for display_name in TARGET_BRANDS:
        candidates = [display_name]
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
def _is_excluded_item(item_name: str) -> bool:
    """넥타이/스카프/지갑/시계류 등 제외 키워드가 상품명에 포함되어 있는지 확인."""
    lowered = (item_name or "").lower()
    return any(keyword.lower() in lowered for keyword in EXCLUDE_KEYWORDS)


def _build_embed(item, brand_display: str):
    price = getattr(item, "price", None)
    item_id = getattr(item, "id_", None) or getattr(item, "id", None)
    mercari_url = f"https://jp.mercari.com/item/{item_id}"
    url = f"https://kenzpost.com/mercari/bid.s/{mercari_url}"  # 켄즈포스트 구매대행 링크
    image_url = None
    for attr in ("thumbnails", "photos", "photo_urls", "images"):
        value = getattr(item, attr, None)
        if value:
            image_url = value[0] if isinstance(value, (list, tuple)) else value
            break
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
    """여러 (item, brand_display) 쌍을 embed 여러 개로 묶어 한 번의 webhook 요청으로 전송.
    성공하면 True, 재시도 소진 시 False를 반환한다."""
    if not DISCORD_WEBHOOK_URL:
        print("경고: DISCORD_WEBHOOK_URL 환경변수가 없어 알림을 건너뜁니다.", file=sys.stderr)
        return False

    embeds = [_build_embed(item, brand_display) for item, brand_display in items]
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
# 상세조회(브랜드 역산출) 병렬 처리
# ----------------------------------------------------------------------
async def _fetch_brand_for_item(item, brand_id_to_display, sem):
    """상세조회로 브랜드를 역산출한다. 실패하거나 못 찾으면 텍스트 매칭으로 폴백."""
    brand_display = "브랜드 미상"
    async with sem:
        try:
            full_item = await item.full_item()
            matched_brand_id = None
            for attr in ("item_brand", "brand", "brand_id"):
                value = getattr(full_item, attr, None)
                if value is None:
                    continue
                # value가 {id, name} 객체이거나 id(int) 자체일 수 있어 둘 다 처리
                candidate_id = getattr(value, "id", None) or getattr(value, "id_", None) or value
                if isinstance(candidate_id, int) and candidate_id in brand_id_to_display:
                    matched_brand_id = candidate_id
                    break
            if matched_brand_id is not None:
                brand_display = brand_id_to_display[matched_brand_id]
        except Exception as e:
            print(f"경고: 상세조회로 브랜드 확인 실패({getattr(item, 'id_', None)}): {e}", file=sys.stderr)

    # 상세조회로 못 찾았으면 기존 텍스트 매칭으로 폴백 (완전히 놓치는 것보단 나음)
    if brand_display == "브랜드 미상":
        item_name = getattr(item, "name", "")
        lowered = item_name.lower()
        for display_name in TARGET_BRANDS:
            if display_name.lower() in lowered:
                brand_display = display_name
                break

    return item, brand_display


async def resolve_brands_for_items(items, brand_id_to_display):
    """신규 아이템들의 브랜드를 동시에(세마포어로 개수 제한) 조회한다.

    예전에는 for문 안에서 한 건씩 await로 순서대로 기다렸는데, 신규 매물이
    몰리는 시간대엔 이게 워크플로우 타임아웃(3분)의 주 원인이 될 수 있었다.
    """
    sem = asyncio.Semaphore(DETAIL_FETCH_CONCURRENCY)
    tasks = [_fetch_brand_for_item(item, brand_id_to_display, sem) for item in items]
    return await asyncio.gather(*tasks)


# ----------------------------------------------------------------------
# 메인
# ----------------------------------------------------------------------
async def main():
    facets = load_facets()
    if not facets:
        print(
            "오류: ./facets 폴더에 유효한 facets 데이터가 없습니다. "
            "별도의 'Fetch Mercari facets' 워크플로우(하루 1회 실행)가 "
            "성공했는지, facets/ 폴더가 커밋되어 있는지 확인하세요.",
            file=sys.stderr,
        )
        sys.exit(1)

    category_id, category_name = resolve_category_id(facets)
    if category_id is None:
        print("경고: '남성 패션' 카테고리를 facets 파일에서 찾지 못했습니다. "
              "카테고리 필터 없이 검색합니다.", file=sys.stderr)
    else:
        print(f"카테고리 매칭: {category_name} (id={category_id})")
        check_category_drift(category_id, category_name)

    brand_id_map, missing_brands = resolve_brand_ids(facets)
    if missing_brands:
        print(f"경고: 다음 브랜드는 facets에서 매칭되지 않았습니다: {missing_brands}", file=sys.stderr)
    if not brand_id_map:
        print("오류: 매칭된 브랜드가 하나도 없습니다. TARGET_BRANDS 후보 이름을 확인하세요.", file=sys.stderr)
        return

    print(f"검색 대상 브랜드({len(brand_id_map)}개): {list(brand_id_map.keys())}")

    m = Mercapi()
    status_filter = []
    status_enum = getattr(SearchRequestData, "Status", None)
    if status_enum is not None:
        for candidate in ("ON_SALE", "STATUS_ON_SALE", "SELLING"):
            member = getattr(status_enum, candidate, None)
            if member is not None:
                status_filter = [member]
                break

    sort_by = getattr(SearchRequestData.SortBy, "SORT_CREATED_TIME", None)

    # 가격 상한이 브랜드별로 다를 수 있으므로, 같은 가격 상한을 쓰는 브랜드끼리 묶어서
    # 그룹별로 따로 검색한다 (메루카리 검색 API는 요청 하나에 가격 상한을 하나만 지정 가능).
    price_groups = {}
    brand_id_to_display = {}
    for display_name, brand_id in brand_id_map.items():
        price_cap = BRAND_PRICE_OVERRIDES.get(display_name, PRICE_MAX)
        price_groups.setdefault(price_cap, []).append(brand_id)
        brand_id_to_display[brand_id] = display_name

    all_result_items = []
    for price_cap, brand_ids in price_groups.items():
        kwargs = dict(
            categories=[category_id] if category_id else [],
            brands=brand_ids,
            price_max=price_cap,
            status=status_filter,
        )
        if sort_by is not None:
            kwargs["sort_by"] = sort_by
            kwargs["sort_order"] = SearchRequestData.SortOrder.ORDER_DESC
        print(f"가격상한 {price_cap}엔 그룹 검색: 브랜드 {len(brand_ids)}개")
        group_results = await m.search("", **kwargs)
        all_result_items.extend(group_results.items)

    is_first_run = not SEEN_FILE.exists()
    seen = load_seen()
    new_items = []
    for item in all_result_items:
        item_id = getattr(item, "id_", None) or getattr(item, "id", None)
        item_name = getattr(item, "name", "")
        # 주의: 여기서는 seen에 바로 넣지 않는다. 전송 성공 여부를 확인한 뒤에
        # 넣어야, 실패한 항목이 다음 실행에서 다시 시도된다.
        if item_id and item_id not in seen and not _is_excluded_item(item_name):
            new_items.append(item)

    print(f"검색 결과 {len(all_result_items)}건 중 신규 {len(new_items)}건")

    # 신규 아이템에 대해서만(전체 검색 결과가 아니라) 상세 조회로 브랜드를 역산출한다.
    # 검색 API는 한 번에 여러 브랜드를 묶어 검색하므로 결과만 봐서는 어느 브랜드에
    # 매칭됐는지 알 수 없다 - 대신 상세 조회 응답의 브랜드 필드를 우리가 미리 만든
    # brand_id -> 표시이름 매핑(brand_id_to_display)에 대조해서 정확히 찾아낸다.
    # (동시에 여러 건을 조회해 순차 대기로 인한 타임아웃 위험을 줄인다.)
    new_items = await resolve_brands_for_items(new_items, brand_id_to_display)

    if is_first_run:
        for item, _ in new_items:
            item_id = getattr(item, "id_", None) or getattr(item, "id", None)
            if item_id:
                seen.add(item_id)
        save_seen(seen)
        print("첫 실행이므로 알림 없이 현재 매물을 기준점으로만 저장합니다.")
    elif new_items:
        with httpx.Client() as sync_client:
            success_count = 0
            for i in range(0, len(new_items), CHUNK_SIZE):
                chunk = new_items[i:i + CHUNK_SIZE]
                ok = send_discord_batch(sync_client, chunk)
                if ok:
                    for item, _ in chunk:
                        item_id = getattr(item, "id_", None) or getattr(item, "id", None)
                        if item_id:
                            seen.add(item_id)
                    # 배치 전송 성공 직후 바로 디스크에 저장한다.
                    # 여기서 저장해두면, 이후 배치 처리 중 워크플로우가
                    # 타임아웃/취소로 강제 종료되더라도 이미 성공적으로
                    # 보낸 알림은 다음 실행에서 중복으로 다시 나가지 않는다.
                    save_seen(seen)
                    success_count += len(chunk)
                time.sleep(0.5)  # 배치 사이 최소 간격
            print(f"전송 성공 {success_count}건 / 시도 {len(new_items)}건 (배치 단위 전송, 배치마다 즉시 저장)")
    else:
        # 신규 매물이 없어도 seen은 최신 상태 그대로 다시 써둔다 (trim 등 정합성 유지).
        save_seen(seen)


if __name__ == "__main__":
    asyncio.run(main())
