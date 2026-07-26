"""
Yahoo!오ーク션(auctions.yahoo.co.jp)에서, 메루카리 알림 봇과 "같은 브랜드 목록 +
같은 가격 조건(1만엔 이하)"으로 검색하되, "경매 마감까지 30분 이내로 남은 상품"만
디스코드로 알려주는 스크립트.

주의 (중요):
- 야후는 일반 개발자용 오픈 API(검색/상품상세)를 이미 종료했다
  (구 버전 API는 2015년, 나머지도 2018년경 종료). 그래서 이 스크립트는
  검색 결과 페이지의 HTML을 직접 요청해서 파싱하는 비공식 방식이다.
  mercari main.py의 mercapi(공식에 준하는 라이브러리)와는 성격이 다르다.
- 상품 URL 패턴(/jp/auction/상품ID)과 "현재 ○○円" / "잔여시간" 텍스트
  패턴 위주로 파싱한다. 실제 실행 후 결과가 이상하면 파싱 로직을 조정해야
  할 수 있다 (아래 "실행 전 꼭 확인할 것" 참고).
- 이미 알림을 보낸 상품 ID는 data/yahoo_seen.json 에 저장해두고,
  같은 상품에 대해 중복 알림을 보내지 않는다.
"""
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

# ----------------------------------------------------------------------
# 설정
# ----------------------------------------------------------------------
# mercari main.py의 TARGET_BRANDS와 완전히 동일한 브랜드 목록 (표시용 이름 -> 검색 키워드)
TARGET_BRAND_KEYWORDS = {
    "NIL ADMIRARI": "NIL ADMIRARI",
    "BLACK COMME des GARCONS": "BLACK COMME des GARCONS",
    "COMME des GARCONS HOMME PLUS": "COMME des GARCONS HOMME PLUS",
    "COMME des GARCONS HOMME": "COMME des GARCONS HOMME",
    "COMME des GARCONS": "COMME des GARCONS",
    "Maison Martin Margiela": "Maison Martin Margiela",
    "Maison Margiela": "Maison Margiela",
    "D&G / Dolce&Gabbana": "D&G Dolce Gabbana",
    "MM6": "MM6 Maison Margiela",
    "MM6 Maison Margiela": "MM6 Maison Margiela",
    "JUNYA WATANABE COMME des GARCONS MAN": "JUNYA WATANABE COMME des GARCONS MAN",
    "JUNYA WATANABE COMME des GARCONS": "JUNYA WATANABE COMME des GARCONS",
    "JUNYA WATANABE MAN": "JUNYA WATANABE MAN",
    "JUNYA WATANABE": "JUNYA WATANABE",
    "Prada Linea Rossa": "Prada Linea Rossa",
    "PRADA SPORT": "PRADA SPORT",
    "Helmut Lang": "Helmut Lang",
    "NUMBER (N)INE": "NUMBER (N)INE",
    "RAF by RAF SIMONS": "RAF by RAF SIMONS",
    "RAF SIMONS": "RAF SIMONS",
    "EYE JUNYA WATANABE MAN": "EYE JUNYA WATANABE MAN",
    "eYe COMME des GARCONS JUNYA WATANABE MAN": "eYe COMME des GARCONS JUNYA WATANABE MAN",
    "Givenchy": "Givenchy",
    "Dior Homme": "Dior Homme",
    "Yohji Yamamoto": "Yohji Yamamoto",
}

# mercari 알림 봇과 동일: 넥타이/스카프류는 제외
EXCLUDE_KEYWORDS = ["ネクタイ", "necktie", "tie", "スカーフ", "scarf", "マフラー"]

PRICE_MAX = 10000  # 엔 (mercari 알림 봇과 동일한 가격 조건)
REMAINING_MINUTES_MAX = 30  # 경매 마감까지 이 시간(분) 이내인 것만 알림
RESULTS_PER_PAGE = 100
REQUEST_DELAY_SEC = 1.2  # 브랜드별 요청 사이 딜레이 (차단 회피용)
CHUNK_SIZE = 10  # 디스코드 embed는 메시지 하나에 최대 10개까지

SEARCH_URL = "https://auctions.yahoo.co.jp/search/search"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

DATA_DIR = Path(__file__).parent / "data"
SEEN_FILE = DATA_DIR / "yahoo_seen.json"
MAX_SEEN_KEEP = 5000
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

ITEM_URL_RE = re.compile(r"^https://auctions\.yahoo\.co\.jp/jp/auction/([A-Za-z0-9]+)")
PRICE_RE = re.compile(r"現在\s*([\d,]+)\s*円")
# "3日", "6時間", "45分", "20秒" 등 잔여시간 텍스트에서 각 단위를 뽑아낸다.
REMAINING_RE = re.compile(r"(?:(\d+)\s*日)?\s*(?:(\d+)\s*時間)?\s*(?:(\d+)\s*分)?\s*(?:(\d+)\s*秒)?")


def _parse_remaining_minutes(text: str):
    """'잔여시간' 근처 텍스트에서 분 단위 잔여시간을 추출. 못 찾으면 None."""
    if not text:
        return None
    # "残り" 라는 단어 뒤쪽부터 찾는 게 더 정확하다.
    idx = text.find("残り")
    search_text = text[idx:idx + 30] if idx != -1 else text
    m = REMAINING_RE.search(search_text)
    if not m or not any(m.groups()):
        return None
    days, hours, minutes, seconds = (int(g) if g else 0 for g in m.groups())
    total_minutes = days * 24 * 60 + hours * 60 + minutes
    if total_minutes == 0 and seconds > 0:
        total_minutes = 1  # 초 단위만 있으면 1분 미만이라는 뜻이므로 최소값 1로 취급
    if days == hours == minutes == seconds == 0:
        return None
    return total_minutes


# ----------------------------------------------------------------------
# 검색 결과 HTML 파싱
# ----------------------------------------------------------------------
def _is_excluded(title: str) -> bool:
    lowered = (title or "").lower()
    return any(keyword.lower() in lowered for keyword in EXCLUDE_KEYWORDS)


def parse_search_html(html: str, brand_display: str):
    """검색 결과 페이지 HTML에서 상품 목록을 뽑아낸다.
    상품 상세 URL 패턴(/jp/auction/상품ID)을 기준으로 앵커를 찾고,
    그 앵커를 감싸는 상위 요소의 텍스트에서 가격/잔여시간을 정규식으로 추출한다."""
    soup = BeautifulSoup(html, "html.parser")
    items = {}

    for a in soup.find_all("a", href=True):
        m = ITEM_URL_RE.match(a["href"])
        if not m:
            continue
        item_id = m.group(1)
        if item_id in items:
            continue

        # 상품 카드로 보이는 상위 컨테이너까지 최대 5단계 위로 올라가서
        # 그 안의 텍스트에서 가격/잔여시간을 찾는다.
        container = a
        price = None
        remaining_minutes = None
        for _ in range(5):
            if container is None:
                break
            text = container.get_text(" ", strip=True)
            if price is None:
                price_match = PRICE_RE.search(text)
                if price_match:
                    price = int(price_match.group(1).replace(",", ""))
            if remaining_minutes is None:
                remaining_minutes = _parse_remaining_minutes(text)
            if price is not None and remaining_minutes is not None:
                break
            container = container.parent

        title = (a.get("title") or a.get_text(strip=True) or "").strip()
        if not title:
            continue

        items[item_id] = {
            "id": item_id,
            "title": title,
            "url": f"https://auctions.yahoo.co.jp/jp/auction/{item_id}",
            "price": price,
            "remaining_minutes": remaining_minutes,
            "brand": brand_display,
        }

    return list(items.values())


async def fetch_brand_items(client: httpx.AsyncClient, keyword: str, brand_display: str):
    params = {
        "p": keyword,
        "va": keyword,
        "aucmaxprice": PRICE_MAX,
        "b": 1,
        "n": RESULTS_PER_PAGE,
        "s1": "end",  # 마감 임박순 정렬 (핵심: 마감이 빠른 것부터 보이게)
        "o1": "a",
    }
    resp = await client.get(SEARCH_URL, params=params)
    resp.raise_for_status()
    return parse_search_html(resp.text, brand_display)


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
def _build_embed(item):
    price_text = f"💴 {item['price']}円" if item["price"] is not None else "💴 가격 확인 필요"
    remaining_text = (
        f"⏰ 마감까지 약 {item['remaining_minutes']}분"
        if item["remaining_minutes"] is not None
        else "⏰ 잔여시간 확인 필요"
    )
    embed = {
        "title": item["brand"],
        "url": item["url"],
        "description": f"{price_text}\n{remaining_text}",
        "color": 0xE67E22,
    }
    return embed


def send_discord_batch(client: httpx.Client, items, max_retries: int = 5) -> bool:
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
    is_first_run = not SEEN_FILE.exists()
    seen = load_seen()
    all_new = []

    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        timeout=20,
        follow_redirects=True,
    ) as client:
        for brand_display, keyword in TARGET_BRAND_KEYWORDS.items():
            try:
                items = await fetch_brand_items(client, keyword, brand_display)
            except httpx.HTTPStatusError as e:
                print(f"경고: '{brand_display}' 검색 실패 (HTTP {e.response.status_code})", file=sys.stderr)
                await asyncio.sleep(REQUEST_DELAY_SEC)
                continue
            except Exception as e:
                print(f"경고: '{brand_display}' 검색 중 오류: {e}", file=sys.stderr)
                await asyncio.sleep(REQUEST_DELAY_SEC)
                continue

            found_new = 0
            for item in items:
                if item["price"] is not None and item["price"] > PRICE_MAX:
                    continue
                if _is_excluded(item["title"]):
                    continue
                # 핵심 필터: 마감까지 30분 이내로 남은 것만
                if item["remaining_minutes"] is None or item["remaining_minutes"] > REMAINING_MINUTES_MAX:
                    continue
                if item["id"] not in seen:
                    all_new.append(item)
                    found_new += 1

            # [디버그] 잔여시간 파싱이 실제로 되고 있는지 확인용 — 앞에서 3개만 샘플로 출력
            sample = items[:3]
            sample_str = ", ".join(
                f"{it['id']}=price:{it['price']}/remain:{it['remaining_minutes']}분" for it in sample
            )
            print(f"  [디버그] 샘플 파싱 결과: {sample_str if sample else '(검색 결과 없음)'}")

            print(f"'{brand_display}' 검색 결과 {len(items)}건 중 마감임박 신규 {found_new}건")
            await asyncio.sleep(REQUEST_DELAY_SEC)

    print(f"전체 브랜드 합산 마감임박 신규 {len(all_new)}건")

    if is_first_run:
        for item in all_new:
            seen.add(item["id"])
        print("첫 실행이므로 알림 없이 현재 매물을 기준점으로만 저장합니다.")
    elif all_new:
        with httpx.Client() as sync_client:
            success_count = 0
            for i in range(0, len(all_new), CHUNK_SIZE):
                chunk = all_new[i:i + CHUNK_SIZE]
                ok = send_discord_batch(sync_client, chunk)
                if ok:
                    for item in chunk:
                        seen.add(item["id"])
                    success_count += len(chunk)
                time.sleep(0.5)
            print(f"전송 성공 {success_count}건 / 시도 {len(all_new)}건 (배치 단위 전송)")

    save_seen(seen)


if __name__ == "__main__":
    asyncio.run(main())
