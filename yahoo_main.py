"""
야후옥션(auctions.yahoo.co.jp) 브랜드/가격 조건에 맞는 신규 매물을
디스코드 웹훅으로 알려주는 스크립트. main.py(메루카리 봇)와 같은
디스코드 채널에 알림을 모은다.

- 야후옥션은 메루카리처럼 브랜드를 ID로 정확히 필터링하는 기능이 없다
  (검색 페이지의 brand_id 파라미터를 실제로 테스트해봤지만 결과에
  반영되지 않았다 - 장식용 캐러셀 링크였을 뿐 실제 필터가 아니었다).
  그래서 브랜드명을 키워드로 검색한다. 셀러가 영어/일본어 중 아무
  표기로나 상품명을 적기 때문에, 브랜드마다 두 표기를 다 검색한다
  (config.py의 TARGET_BRANDS_YAHOO).
- 공식 API가 없다(야후재팬이 오픈 API를 몇 년 전 닫았다). 대신 검색
  결과 페이지가 서버에서 완성된 HTML로 내려오고(JS 실행 불필요),
  상품마다 data-auction-* 속성에 id/가격/제목/이미지가, data-cl-params
  속성에 등록 시각(st, 유닉스 타임스탬프)이 안정적으로 박혀있어서
  정규식으로 충분히 안정적으로 파싱할 수 있다.
- "신규" 판단은 메루카리 봇과 동일하게 seen 파일 대조 + 등록 시각(st)이
  최근 폴링 주기 이내인지로 한 번 더 거른다.
- seen 기록은 메루카리 봇과 완전히 분리된 파일(data/yahoo_seen.json)에
  저장한다 - 플랫폼이 다르면 상품 id 체계도 다르므로 섞지 않는다.
  순서 보장 구조(dict)로 저장하는 이유는 메루카리 봇과 동일하다: set으로
  저장하면 MAX_SEEN_KEEP개로 자를 때 무작위로 id가 탈락해서 재알림
  버그가 생긴다.
"""
import asyncio
import html
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
import httpx

from config import (
    TARGET_BRANDS_YAHOO,
    PRICE_MAX,
    BRAND_PRICE_OVERRIDES,
    EXCLUDE_KEYWORDS,
)

# ----------------------------------------------------------------------
# 설정
# ----------------------------------------------------------------------
SEARCH_URL = "https://auctions.yahoo.co.jp/search/search"
CHUNK_SIZE = 10  # 디스코드 embed는 메시지 하나에 최대 10개까지
NEW_ITEM_MAX_AGE_MINUTES = 10  # 등록시각(st)이 이보다 오래된 매물은 "신규"로 취급하지 않음
SEARCH_CONCURRENCY = 5  # 브랜드x언어 검색을 동시에 몇 개까지 날릴지

DATA_DIR = Path(__file__).parent / "data"
SEEN_FILE = DATA_DIR / "yahoo_seen.json"
MAX_SEEN_KEEP = 3000
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept-Language": "ja,en;q=0.9",
}

# 상품 카드 <a class="Product__imageLink ..." data-auction-id="..." ...>
# <a와 class 사이에 개행/공백이 들어가는 실제 마크업이라 \s+로 허용해야 매칭된다.
ITEM_LINK_RE = re.compile(r'<a\s+class="Product__imageLink[^"]*"(.*?)>', re.S)
ATTR_PATTERNS = {
    "id": re.compile(r'data-auction-id="([^"]*)"'),
    "title": re.compile(r'data-auction-title="([^"]*)"'),
    "img": re.compile(r'data-auction-img="([^"]*)"'),
    "price": re.compile(r'data-auction-price="([^"]*)"'),
    "cl_params": re.compile(r'data-cl-params="([^"]*)"'),
}
START_TIME_RE = re.compile(r"st:(\d+)")


# ----------------------------------------------------------------------
# 검색
# ----------------------------------------------------------------------
def _parse_search_html(page_html: str) -> list:
    items = {}
    for m in ITEM_LINK_RE.finditer(page_html):
        attrs = m.group(1)
        values = {}
        for key, pattern in ATTR_PATTERNS.items():
            found = pattern.search(attrs)
            values[key] = found.group(1) if found else None

        item_id = values.get("id")
        if not item_id or item_id in items:
            continue

        created = None
        if values.get("cl_params"):
            st_match = START_TIME_RE.search(values["cl_params"])
            if st_match:
                created = datetime.fromtimestamp(int(st_match.group(1)))

        try:
            price = int(values["price"]) if values.get("price") else None
        except ValueError:
            price = None

        items[item_id] = {
            "id": item_id,
            "title": html.unescape(values.get("title") or ""),
            "img": values.get("img"),
            "price": price,
            "created": created,
        }
    return list(items.values())


async def _search_keyword(client: httpx.AsyncClient, semaphore: asyncio.Semaphore, keyword: str, price_max: int) -> list:
    params = {
        "p": keyword,
        "va": keyword,
        "s1": "new",
        "o1": "d",
        "aucmaxprice": str(price_max),
        "n": "50",
        "b": "1",
    }
    async with semaphore:
        try:
            resp = await client.get(SEARCH_URL, params=params, headers=REQUEST_HEADERS, timeout=20)
        except Exception as e:
            print(f"경고: '{keyword}' 검색 실패: {e}", file=sys.stderr)
            return []
    if resp.status_code != 200:
        print(f"경고: '{keyword}' 검색 실패(status={resp.status_code})", file=sys.stderr)
        return []
    return _parse_search_html(resp.text)


# ----------------------------------------------------------------------
# seen 기록 (순서 보장 - 메루카리 봇과 동일한 이유로 dict 사용)
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
def _is_excluded_item(title: str) -> bool:
    lowered = (title or "").lower()
    return any(keyword.lower() in lowered for keyword in EXCLUDE_KEYWORDS)


def _is_recently_created(created: Optional[datetime]) -> bool:
    # 야후옥션도 등록시각(st)을 로컬 타임존 기준 유닉스 타임스탬프로 준다.
    # GitHub Actions 러너의 로컬 타임존은 기본적으로 UTC라 datetime.now()와 그대로 비교해도 맞다.
    if created is None:
        return True
    age_seconds = (datetime.now() - created).total_seconds()
    return age_seconds <= NEW_ITEM_MAX_AGE_MINUTES * 60


# ----------------------------------------------------------------------
# 디스코드 알림 (배치 전송) - 메루카리 봇과 동일한 방식/채널
# ----------------------------------------------------------------------
def _build_embed(item: dict, brand_display: str) -> dict:
    original_url = f"https://auctions.yahoo.co.jp/jp/auction/{item['id']}"
    url = f"https://kenzpost.com/yahoo/bid.s/{original_url}"  # 켄즈포스트 구매대행 링크
    price = item.get("price")
    embed = {
        "title": brand_display,
        "url": url,
        "description": f"💴 {price}円" if price is not None else "",
        "color": 0x3B82F6,
    }
    if item.get("img"):
        embed["image"] = {"url": item["img"]}
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
    if not TARGET_BRANDS_YAHOO:
        print("오류: config.py의 TARGET_BRANDS_YAHOO가 비어있습니다.", file=sys.stderr)
        return

    semaphore = asyncio.Semaphore(SEARCH_CONCURRENCY)
    async with httpx.AsyncClient() as client:
        tasks = []
        task_brand = []
        for brand in TARGET_BRANDS_YAHOO:
            display_name = brand["display"]
            price_cap = BRAND_PRICE_OVERRIDES.get(display_name, PRICE_MAX)
            for keyword in brand["queries"]:
                tasks.append(_search_keyword(client, semaphore, keyword, price_cap))
                task_brand.append(display_name)

        results = await asyncio.gather(*tasks)

    print(f"검색 대상 브랜드({len(TARGET_BRANDS_YAHOO)}개, 쿼리 {len(tasks)}개)")

    all_items = []
    for display_name, items in zip(task_brand, results):
        all_items.append((display_name, items))
    total_raw = sum(len(items) for _, items in all_items)

    is_first_run = not SEEN_FILE.exists()
    seen = load_seen()
    seen_this_run = set()
    new_items = []
    for display_name, items in all_items:
        for item in items:
            item_id = item["id"]
            if item_id in seen or item_id in seen_this_run:
                continue
            seen_this_run.add(item_id)
            if _is_excluded_item(item["title"]):
                continue
            if not _is_recently_created(item["created"]):
                continue
            new_items.append((item, display_name))

    print(f"검색 결과 {total_raw}건(중복 포함) 중 신규 {len(new_items)}건")

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
                        seen[item["id"]] = None
                    success_count += len(chunk)
                time.sleep(0.5)  # 배치 사이 최소 간격
            print(f"전송 성공 {success_count}건 / 시도 {len(new_items)}건 (배치 단위 전송)")

    save_seen(seen)


if __name__ == "__main__":
    asyncio.run(main())
