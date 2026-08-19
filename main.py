"""
메루카리(mercari.jp) 브랜드/카테고리/가격 조건에 맞는 신규 매물을
디스코드 웹훅으로 알려주는 스크립트.

- 카테고리/브랜드 ID는 하드코딩하지 않는다. 별도 워크플로우(facets.yml)가
  주기적으로 mercapi 공식 유틸(utils/fetch_facets.py)로 최신 ID 목록을
  ./facets/ 폴더에 커밋해두면, 이 스크립트는 그 폴더를 읽기만 한다.
  (Mercari 내부 ID는 수시로 바뀌고, facets 생성 자체가 오래 걸려서
  1분마다 도는 이 스크립트와는 갱신 주기를 분리했다.)
- 이 저장소는 GitHub Actions 자체 schedule cron이 사실상 안 돌기 때문에,
  cron-job.org가 1분마다 workflow_dispatch를 강제로 호출해서 실행한다.
  간격이 매우 짧으므로, 같은 가격 상한을 쓰는 브랜드들을 한 검색 요청에
  묶어서 보내 요청 수를 최소화한다(메루카리가 차단할 만큼 요청이 몰리는
  걸 피하기 위함).
- 브랜드 정보는 검색 결과에 들어있지 않다(mercapi로 직접 확인해보면
  검색 API는 itemBrand를 항상 null로 준다). 대신 상품 상세조회 원본
  JSON에는 item_brand가 들어있는데, 설치된 mercapi 라이브러리의 Item
  모델이 이 필드를 누락하고 있어서(라이브러리 미구현) 그동안 브랜드를
  못 읽어왔다. 그래서 신규 상품에 한해서만(전체 검색 결과가 아니라)
  상세조회 원본을 직접 읽어 item_brand.name을 가져온다 - 신규 상품은
  보통 소수라 상세조회 비용도 작다.
- "신규" 판단은 seen.json 대조 + Mercari가 주는 실제 생성 시각(created)이
  NEW_ITEM_MAX_AGE_MINUTES 이내인지로 한 번 더 거른다. 상품 정보를
  수정하면 updated만 바뀌고 created는 그대로이므로, 수정된 옛 매물이
  검색 순위만 바뀌어 재알림되는 걸 구조적으로 막는다.
- seen 기록은 순서를 보장하는 구조(dict)로 저장한다. set으로 저장했을
  때는 MAX_SEEN_KEEP개로 자를 때 파이썬 해시 순서가 실행마다 달라져
  사실상 무작위로 id가 탈락했고, 그게 탈락 후 재알림(중복 알림)의
  원인이었다.
- 디스코드 알림은 embed 10개씩 묶어서 한 번의 webhook 요청으로 보낸다
  (레이트리밋 회피 목적). 배치 사이에는 0.5초 딜레이를 둔다. 전송에
  성공한 배치의 아이템만 seen에 기록하고, 실패한 배치는 다음 실행에서
  자동으로 재시도된다.
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
from datetime import datetime
from pathlib import Path
from typing import Optional
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
# 브랜드/가격/카테고리/제외키워드는 config.py에서 관리한다.
CHUNK_SIZE = 10  # 디스코드 embed는 메시지 하나에 최대 10개까지
NEW_ITEM_MAX_AGE_MINUTES = 10  # created가 이보다 오래된 매물은 "신규"로 취급하지 않음
BRAND_LOOKUP_CONCURRENCY = 10  # 신규 상품 브랜드 조회를 동시에 몇 개까지 날릴지

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
    """후보 카테고리명과 정확히 일치하는 항목을 우선하고, 없으면 부분 일치로 폴백한다."""
    for cand in TARGET_CATEGORY_CANDIDATES:
        for c in entries:
            name = str(c.get("name", "")).strip()
            if name.lower() == cand.strip().lower():
                return c["id"], c.get("name")

    for cand in TARGET_CATEGORY_CANDIDATES:
        for c in entries:
            if cand.lower() in str(c.get("name", "")).lower():
                return c["id"], c.get("name")

    return None, None


def check_category_drift(category_id, category_name):
    """이전 실행의 category_id와 다르면 stderr에 경고하고 기록을 갱신한다."""
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
        target = display_name.strip().lower()
        found = next(
            (b for b in entries if str(b.get("name", "")).strip().lower() == target),
            None,
        )
        if not found:
            found = next(
                (b for b in entries if target in str(b.get("name", "")).lower()),
                None,
            )
        if found:
            resolved[display_name] = found["id"]
        else:
            missing.append(display_name)
    return resolved, missing


# ----------------------------------------------------------------------
# seen 기록 (순서 보장 - dict는 삽입 순서를 유지하므로 오래된 것부터 잘라낸다)
# ----------------------------------------------------------------------
def load_seen():
    if SEEN_FILE.exists():
        try:
            ids = json.loads(SEEN_FILE.read_text(encoding="utf-8"))
            return dict.fromkeys(ids)
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def save_seen(seen_ids):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    trimmed = list(seen_ids)[-MAX_SEEN_KEEP:]
    SEEN_FILE.write_text(json.dumps(trimmed, ensure_ascii=False), encoding="utf-8")


# ----------------------------------------------------------------------
# 신규 판단
# ----------------------------------------------------------------------
def _is_excluded_item(item_name: str) -> bool:
    lowered = (item_name or "").lower()
    return any(keyword.lower() in lowered for keyword in EXCLUDE_KEYWORDS)


def _is_recently_created(created: Optional[datetime]) -> bool:
    # mercapi는 created를 로컬 타임존 기준 naive datetime으로 파싱한다.
    # GitHub Actions 러너의 로컬 타임존은 기본적으로 UTC라 datetime.now()와 그대로 비교해도 맞다.
    if created is None:
        return True
    age_seconds = (datetime.now() - created).total_seconds()
    return age_seconds <= NEW_ITEM_MAX_AGE_MINUTES * 60


async def _fetch_item_brand(m: Mercapi, semaphore: asyncio.Semaphore, item_id: str) -> Optional[str]:
    # mercapi의 Item 모델에는 item_brand 필드가 빠져 있어서(라이브러리 미구현),
    # 상세조회 원본 JSON을 직접 읽어 브랜드명을 가져온다.
    async with semaphore:
        try:
            resp = await m._client.send(m._item(item_id))
        except Exception as e:
            print(f"경고: {item_id} 브랜드 조회 실패: {e}", file=sys.stderr)
            return None
    if resp.status_code != 200:
        return None
    brand = resp.json().get("data", {}).get("item_brand")
    return brand.get("name") if isinstance(brand, dict) else None


# ----------------------------------------------------------------------
# 디스코드 알림 (배치 전송)
# ----------------------------------------------------------------------
def _build_embed(item, brand_display: str):
    price = getattr(item, "price", None)
    item_id = getattr(item, "id_", None)
    mercari_url = f"https://jp.mercari.com/item/{item_id}"
    url = f"https://kenzpost.com/mercari/bid.s/{mercari_url}"  # 켄즈포스트 구매대행 링크
    thumbnails = getattr(item, "thumbnails", None)
    embed = {
        "title": brand_display,
        "url": url,
        "description": f"💴 {price}円",
        "color": 0x2ECC71,
    }
    if thumbnails:
        embed["image"] = {"url": thumbnails[0]}  # 큰 이미지로 표시
    return embed


def send_discord_batch(client: httpx.Client, items, max_retries: int = 5) -> bool:
    """전송 성공 시 True, 재시도 소진 시 False."""
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
# 메인
# ----------------------------------------------------------------------
async def main():
    facets = load_facets()
    if not facets:
        print(
            "오류: ./facets 폴더에 유효한 facets 데이터가 없습니다. "
            "facets.yml 워크플로우가 아직 한 번도 성공하지 못했을 수 있습니다. "
            "Actions 탭에서 수동으로 한 번 실행해보세요.",
            file=sys.stderr,
        )
        sys.exit(1)

    category_id, category_name = resolve_category_id(facets)
    if category_id is None:
        print("경고: 대상 카테고리를 facets 파일에서 찾지 못했습니다. "
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
    status_filter = [SearchRequestData.Status.STATUS_ON_SALE]
    sort_by = SearchRequestData.SortBy.SORT_CREATED_TIME

    # 가격 상한이 브랜드별로 다를 수 있으므로, 같은 가격 상한을 쓰는 브랜드끼리 묶어서
    # 그룹별로 따로 검색한다 (메루카리 검색 API는 요청 하나에 가격 상한을 하나만 지정 가능).
    # 브랜드를 하나씩 나눠 검색하지 않는 이유: 1분마다 도는 워크플로우에서 브랜드 수만큼
    # 요청이 나가면 메루카리 쪽에서 차단될 위험이 있다 - 브랜드 식별은 신규 상품만
    # 상세조회해서 해결한다(아래 _fetch_item_brand).
    price_groups = {}
    for display_name, brand_id in brand_id_map.items():
        price_cap = BRAND_PRICE_OVERRIDES.get(display_name, PRICE_MAX)
        price_groups.setdefault(price_cap, []).append(brand_id)

    all_result_items = []
    for price_cap, brand_ids in price_groups.items():
        results = await m.search(
            "",
            categories=[category_id] if category_id else [],
            brands=brand_ids,
            price_max=price_cap,
            status=status_filter,
            sort_by=sort_by,
            sort_order=SearchRequestData.SortOrder.ORDER_DESC,
        )
        print(f"가격상한 {price_cap}엔 그룹 검색: 브랜드 {len(brand_ids)}개, 결과 {len(results.items)}건")
        all_result_items.extend(results.items)

    is_first_run = not SEEN_FILE.exists()
    seen = load_seen()
    seen_this_run = set()
    new_candidates = []
    for item in all_result_items:
        item_id = getattr(item, "id_", None)
        if not item_id or item_id in seen or item_id in seen_this_run:
            continue
        seen_this_run.add(item_id)
        if _is_excluded_item(getattr(item, "name", "")):
            continue
        if not _is_recently_created(getattr(item, "created", None)):
            continue
        new_candidates.append(item)

    print(f"검색 결과 {len(all_result_items)}건 중 신규 {len(new_candidates)}건")

    # 신규 상품에 한해서만(전체 검색 결과가 아니라) 상세조회로 브랜드명을 가져온다.
    lookup_semaphore = asyncio.Semaphore(BRAND_LOOKUP_CONCURRENCY)
    brand_names = await asyncio.gather(
        *[
            _fetch_item_brand(m, lookup_semaphore, getattr(item, "id_", None))
            for item in new_candidates
        ]
    )
    new_items = [
        (item, brand_name or "브랜드 미상")
        for item, brand_name in zip(new_candidates, brand_names)
    ]

    if is_first_run:
        for item_id in seen_this_run:
            seen[item_id] = None
        print("첫 실행이므로 알림 없이 현재 매물을 기준점으로만 저장합니다.")
    elif new_items:
        with httpx.Client() as sync_client:
            success_count = 0
            for i in range(0, len(new_items), CHUNK_SIZE):
                chunk = new_items[i:i + CHUNK_SIZE]
                ok = send_discord_batch(sync_client, chunk)
                if ok:
                    for item, _ in chunk:
                        item_id = getattr(item, "id_", None)
                        if item_id:
                            seen[item_id] = None
                    success_count += len(chunk)
                time.sleep(0.5)  # 배치 사이 최소 간격
            print(f"전송 성공 {success_count}건 / 시도 {len(new_items)}건 (배치 단위 전송)")

    save_seen(seen)


if __name__ == "__main__":
    asyncio.run(main())
