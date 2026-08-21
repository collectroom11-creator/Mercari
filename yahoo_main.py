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
- 알림 조건은 "새로 등록된 상품"이 아니라 "경매 종료가 임박한 상품"이다
  (ENDING_SOON_MAX_MINUTES, 기본 24시간). 그래서 seen 파일의 의미도
  메루카리 봇과 다르다 - "한 번이라도 검색에 걸린 적 있는 id"가 아니라
  "이미 알림을 보낸 id"만 기록한다. 아직 종료까지 24시간 넘게 남은
  상품은 seen에 넣지 않고 그냥 넘어가서, 나중에 24시간 이내로 들어오면
  그때 다시 후보로 평가된다. data-cl-params의 end(종료 유닉스 타임스탬프)
  값을 기준으로 남은 시간을 계산한다.
- seen 기록은 메루카리 봇과 완전히 분리된 파일(data/yahoo_seen.json)에
  저장한다 - 플랫폼이 다르면 상품 id 체계도 다르므로 섞지 않는다.
  순서 보장 구조(dict)로 저장하는 이유는 메루카리 봇과 동일하다: set으로
  저장하면 MAX_SEEN_KEEP개로 자를 때 무작위로 id가 탈락해서 재알림
  버그가 생긴다.
- 종료 임박으로 처음 알림되는 시점에, "우리가 이 상품을 검색에서 처음
  발견한 시각"과 "경매 시작 시각"을 stderr에 함께 로그로 남긴다
  (data/yahoo_first_seen.json). 둘 사이 간격이 크면, 그 상품이 인기
  검색어 상위 100위 밖에 있다가 나중에 다시 들어왔다는 뜻이다 - "종료
  임박까지 왜 못 봤는지"를 나중에 로그로 바로 확인할 수 있게 하기 위함.
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
ENDING_SOON_MAX_MINUTES = 24 * 60  # 종료까지 이 시간 이내로 남은 것만 알림
SEARCH_CONCURRENCY = 5  # 브랜드x언어 검색을 동시에 몇 개까지 날릴지

DATA_DIR = Path(__file__).parent / "data"
SEEN_FILE = DATA_DIR / "yahoo_seen.json"
MAX_SEEN_KEEP = 3000
# "우리가 이 상품을 검색 결과에서 처음 본 시각" 기록 (알림 여부와 무관하게,
# 후보 필터를 통과 못해도 기록한다). 경매 시작 시각과 비교해서 "왜 늦게
# 발견됐는지"(가격/카테고리 검색 상위 100위 밖으로 밀려났었는지 등)를
# 진단하기 위한 용도 - seen.json과는 목적이 다른 별도 파일이다.
FIRST_SEEN_FILE = DATA_DIR / "yahoo_first_seen.json"
MAX_FIRST_SEEN_KEEP = 5000
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
END_TIME_RE = re.compile(r"end:(\d+)")
START_TIME_RE = re.compile(r"st:(\d+)")

# 즉결가는 Product__imageLink가 아니라 각 상품 카드의 별도
# <div class="Product__bonus" data-auction-id="..." data-auction-endtime="..."
#      data-auction-buynowprice="..."> 에 들어있어서 따로 id 기준으로 매칭한다.
# "0"은 즉결가 없음(경매 전용)을 의미한다.
BUYNOW_RE = re.compile(
    r'data-auction-id="([^"]*)"\s*data-auction-endtime="[^"]*"\s*data-auction-buynowprice="([^"]*)"'
)

# ----------------------------------------------------------------------
# 검색
# ----------------------------------------------------------------------
def _parse_search_html(page_html: str) -> list:
    buynow_by_id = {}
    for bid, bprice in BUYNOW_RE.findall(page_html):
        try:
            val = int(bprice)
        except ValueError:
            val = 0
        buynow_by_id[bid] = val or None  # "0"은 즉결가 없음(경매 전용)을 의미한다.

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

        end = None
        start = None
        if values.get("cl_params"):
            end_match = END_TIME_RE.search(values["cl_params"])
            if end_match:
                end = datetime.fromtimestamp(int(end_match.group(1)))
            start_match = START_TIME_RE.search(values["cl_params"])
            if start_match:
                start = datetime.fromtimestamp(int(start_match.group(1)))

        try:
            price = int(values["price"]) if values.get("price") else None
        except ValueError:
            price = None

        items[item_id] = {
            "id": item_id,
            "title": html.unescape(values.get("title") or ""),
            "img": values.get("img"),
            "price": price,
            "buynowprice": buynow_by_id.get(item_id),
            "start": start,
            "end": end,
        }
    return list(items.values())


async def _search_keyword(client: httpx.AsyncClient, semaphore: asyncio.Semaphore, keyword: str, price_max: int) -> list:
    params = {
        "p": keyword,
        "va": keyword,
        "auccat": "23176",  # ファッション > メンズファッション. brand_id와 달리 이건 실제로 결과를 필터링한다.
        "s1": "new",
        "o1": "d",
        "aucmaxprice": str(price_max),
        "n": "100",  # 야후옥션이 실제로 허용하는 최댓값(200을 넣으면 조용히 50으로 되돌아감)
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


def load_first_seen() -> dict:
    if FIRST_SEEN_FILE.exists():
        try:
            return json.loads(FIRST_SEEN_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def save_first_seen(first_seen: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # dict는 삽입 순서를 유지하므로, 오래전에 처음 본 것부터 잘라낸다.
    trimmed = dict(list(first_seen.items())[-MAX_FIRST_SEEN_KEEP:])
    FIRST_SEEN_FILE.write_text(json.dumps(trimmed, ensure_ascii=False), encoding="utf-8")


# ----------------------------------------------------------------------
# 신규 판단
# ----------------------------------------------------------------------
def _is_excluded_item(title: str) -> bool:
    lowered = (title or "").lower()
    return any(keyword.lower() in lowered for keyword in EXCLUDE_KEYWORDS)


def _minutes_remaining(end: Optional[datetime]) -> Optional[float]:
    # 야후옥션도 종료시각(end)을 로컬 타임존 기준 유닉스 타임스탬프로 준다.
    # GitHub Actions 러너의 로컬 타임존은 기본적으로 UTC라 datetime.now()와 그대로 비교해도 맞다.
    if end is None:
        return None
    return (end - datetime.now()).total_seconds() / 60


def _is_ending_soon(end: Optional[datetime]) -> bool:
    remaining = _minutes_remaining(end)
    # 종료시각을 못 읽었으면 안전하게 알림하지 않는다(파싱 실패를 "임박"으로 오인하면 안 됨).
    # 이미 끝난 경매(remaining <= 0)도 제외한다.
    if remaining is None:
        return False
    return 0 < remaining <= ENDING_SOON_MAX_MINUTES


def _log_discovery_diagnostics(item: dict, first_seen_iso: Optional[str]):
    # "이 상품이 왜 종료 임박 시점에야 알림됐는지" 나중에 진단하기 위한 로그.
    # start(경매 시작)~first_seen(우리가 처음 검색에서 발견한 시각) 간격이 크면
    # 그 사이엔 검색 상위 100위 밖에 있었다는 뜻이다.
    remaining = _minutes_remaining(item.get("end"))
    start = item.get("start")
    gap_desc = "알 수 없음"
    if start and first_seen_iso:
        try:
            first_seen_dt = datetime.fromisoformat(first_seen_iso)
            gap_minutes = (first_seen_dt - start).total_seconds() / 60
            gap_desc = f"{gap_minutes:.0f}분"
        except ValueError:
            pass
    print(
        f"진단[{item['id']}] 알림 시점 잔여 {remaining:.0f}분 | "
        f"경매 시작 {start} 종료 {item.get('end')} | "
        f"최초 발견 {first_seen_iso} | 시작~최초발견 간격 {gap_desc}",
        file=sys.stderr,
    )


# ----------------------------------------------------------------------
# 디스코드 알림 (배치 전송) - 메루카리 봇과 동일한 방식/채널
# ----------------------------------------------------------------------
def _format_remaining(minutes: Optional[float]) -> str:
    if minutes is None:
        return ""
    total_minutes = max(0, int(minutes))
    hours, mins = divmod(total_minutes, 60)
    return f"⏰ {hours}시간 {mins}분 남음"


def _build_embed(item: dict, brand_display: str) -> dict:
    original_url = f"https://auctions.yahoo.co.jp/jp/auction/{item['id']}"
    url = f"https://kenzpost.com/yahoo/bid.s/{original_url}"  # 켄즈포스트 구매대행 링크
    price = item.get("price")
    lines = []
    if price is not None:
        lines.append(f"💴 {price}円")
    if item.get("buynowprice") is not None:
        lines.append(f"⚡ 즉결 {item['buynowprice']}円")
    remaining_text = _format_remaining(_minutes_remaining(item.get("end")))
    if remaining_text:
        lines.append(remaining_text)
    embed = {
        "author": {"name": "야후옥션"},
        "title": brand_display,
        "url": url,
        "description": "\n".join(lines),
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

    # seen은 "이미 알림 보낸 id"만 담는다. 종료까지 24시간 넘게 남은 상품은
    # 여기서 그냥 넘어가고(seen에 넣지 않음), 나중에 임박 구간에 들어오면
    # 그때 다시 후보로 평가된다 - 그래서 첫 실행이라고 특별히 억제할 필요가
    # 없다: 이미 임박한 상품이면 첫 실행이든 아니든 똑같이 알림이 필요하다.
    seen = load_seen()
    first_seen = load_first_seen()
    now_iso = datetime.now().isoformat()
    for display_name, items in all_items:
        for item in items:
            first_seen.setdefault(item["id"], now_iso)

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
            if not _is_ending_soon(item["end"]):
                continue
            _log_discovery_diagnostics(item, first_seen.get(item_id))
            new_items.append((item, display_name))

    print(f"검색 결과 {total_raw}건(중복 포함) 중 종료임박 {len(new_items)}건")

    if new_items:
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
    save_first_seen(first_seen)


if __name__ == "__main__":
    asyncio.run(main())
