"""
[일회성 진단용 스크립트] 15분 주기가 충분히 빠른지 확인하기 위한 스크립트.

main.py와 똑같은 브랜드/가격 조건으로 검색하되, "판매완료" 상태인 상품만 찾는다.
그 상품이 기존 main.py의 data/seen.json에 있는지 확인해서:
  - seen.json에 있음  -> 우리 봇이 신규로 정상 캐치한 뒤 팔린 것 (문제 없음)
  - seen.json에 없음  -> 신규로 한 번도 못 잡았는데 벌써 팔림
                         => 15분 주기보다 빠르게 팔렸다는 증거

⚠️ 이 스크립트는 seen.json을 읽기만 하고 절대 쓰지 않는다 (진단용이라 상태를 안 건드림).
⚠️ 예약 실행(cron)용이 아니라 수동 실행(workflow_dispatch) 전용으로 설계됨.
"""
import asyncio
import json
import sys
from pathlib import Path

from mercapi import Mercapi
from mercapi.requests import SearchRequestData

# main.py와 완전히 동일한 브랜드/가격 조건
TARGET_BRANDS = {
    "NIL ADMIRARI": ["NIL ADMIRARI"],
    "BLACK COMME des GARCONS": ["BLACK COMME des GARCONS"],
    "COMME des GARCONS HOMME PLUS": ["COMME des GARCONS HOMME PLUS"],
    "COMME des GARCONS HOMME": ["COMME des GARCONS HOMME"],
    "COMME des GARCONS": ["COMME des GARCONS"],
    "Maison Martin Margiela": ["Maison Martin Margiela"],
    "Maison Margiela": ["Maison Margiela"],
    "D&G / Dolce&Gabbana": ["D&G ／ Dolce＆Gabbana", "D&G"],
    "MM6": ["MM6"],
    "MM6 Maison Margiela": ["MM6 Maison Margiela"],
    "JUNYA WATANABE COMME des GARCONS MAN": ["JUNYA WATANABE COMME des GARCONS MAN"],
    "JUNYA WATANABE COMME des GARCONS": ["JUNYA WATANABE COMME des GARCONS"],
    "JUNYA WATANABE MAN": ["JUNYA WATANABE MAN"],
    "JUNYA WATANABE": ["JUNYA WATANABE"],
    "Prada Linea Rossa": ["Prada Linea Rossa"],
    "PRADA SPORT": ["PRADA SPORT"],
    "Helmut Lang": ["Helmut Lang"],
    "NUMBER (N)INE": ["NUMBER (N)INE"],
    "RAF by RAF SIMONS": ["RAF by RAF SIMONS"],
    "RAF SIMONS": ["RAF SIMONS"],
    "EYE JUNYA WATANABE MAN": ["EYE JUNYA WATANABE MAN"],
    "eYe COMME des GARCONS JUNYA WATANABE MAN": ["eYe COMME des GARCONS JUNYA WATANABE MAN"],
    "Givenchy": ["Givenchy"],
    "Dior Homme": ["Dior Homme"],
    "Yohji Yamamoto": ["Yohji Yamamoto"],
    "whoop-de-doo": ["whoop-de-doo"],
    "NEIL BARRETT": ["NEIL BARRETT"],
    "SAINT LAURENT PARIS": ["SAINT LAURENT PARIS"],
    "Saint Laurent": ["Saint Laurent"],
    "InTheAttic": ["InTheAttic"],
    "LAD MUSICIAN": ["LAD MUSICIAN"],
    "ISAMUKATAYAMA BACKLASH": ["ISAMUKATAYAMA BACKLASH"],
    "GUIDI": ["GUIDI"],
}
BRAND_PRICE_OVERRIDES = {
    "SAINT LAURENT PARIS": 13000,
    "Saint Laurent": 13000,
    "GUIDI": 13000,
    "Dior Homme": 13000,
}
DEFAULT_PRICE_MAX = 10000
TARGET_CATEGORY_CANDIDATES = ["メンズファッション", "男性ファッション", "men's fashion", "メンズ"]

FACETS_DIR = Path(__file__).parent / "facets"
SEEN_FILE = Path(__file__).parent / "data" / "seen.json"  # main.py의 seen.json을 읽기 전용으로 참조
DISCORD_WEBHOOK_URL = __import__("os").environ.get("DISCORD_WEBHOOK_URL")


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
    for path in FACETS_DIR.rglob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        _flatten(data, entries)
    return entries


def resolve_category_id(entries):
    for cand in TARGET_CATEGORY_CANDIDATES:
        for c in entries:
            if cand.lower() in str(c.get("name", "")).lower():
                return c["id"]
    return None


def resolve_brand_ids(entries):
    resolved = {}
    for display_name, candidates in TARGET_BRANDS.items():
        found = None
        for cand in candidates:
            for b in entries:
                if str(b.get("name", "")).strip().lower() == cand.strip().lower():
                    found = b
                    break
            if found:
                break
        if found:
            resolved[display_name] = found["id"]
    return resolved


def load_seen():
    if SEEN_FILE.exists():
        try:
            return set(json.loads(SEEN_FILE.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            return set()
    return set()


def build_embed(item, was_caught: bool):
    price = getattr(item, "price", None)
    name = getattr(item, "name", "(제목 없음)")
    item_id = getattr(item, "id_", None) or getattr(item, "id", None)
    mercari_url = f"https://jp.mercari.com/item/{item_id}"
    image_url = None
    for attr in ("thumbnails", "photos", "photo_urls", "images"):
        value = getattr(item, attr, None)
        if value:
            image_url = value[0] if isinstance(value, (list, tuple)) else value
            break
    if was_caught:
        title = f"✅ 정상 캐치 후 판매완료: {name}"
        color = 0x2ECC71
    else:
        title = f"⚠️ 신규 알림 없이 판매완료됨(놓쳤을 가능성): {name}"
        color = 0xE74C3C
    embed = {
        "title": title[:250],
        "url": mercari_url,
        "description": f"💴 {price}円",
        "color": color,
    }
    if image_url:
        embed["image"] = {"url": image_url}
    return embed


async def send_discord_batch(embeds):
    if not DISCORD_WEBHOOK_URL:
        print("경고: DISCORD_WEBHOOK_URL 환경변수가 없어 알림을 건너뜁니다.", file=sys.stderr)
        return
    import httpx
    with httpx.Client() as client:
        for i in range(0, len(embeds), 10):
            chunk = embeds[i:i + 10]
            resp = client.post(DISCORD_WEBHOOK_URL, json={"embeds": chunk}, timeout=15)
            if resp.status_code >= 300:
                print(f"디스코드 전송 실패({resp.status_code}): {resp.text}", file=sys.stderr)
            import time
            time.sleep(0.5)


async def main():
    facets = load_facets()
    if not facets:
        print("오류: ./facets 데이터가 없습니다. facets fetch 단계가 먼저 실행되어야 합니다.", file=sys.stderr)
        sys.exit(1)

    category_id = resolve_category_id(facets)
    brand_id_map = resolve_brand_ids(facets)
    if not brand_id_map:
        print("오류: 매칭된 브랜드가 없습니다.", file=sys.stderr)
        return

    price_groups = {}
    for display_name, brand_id in brand_id_map.items():
        price_cap = BRAND_PRICE_OVERRIDES.get(display_name, DEFAULT_PRICE_MAX)
        price_groups.setdefault(price_cap, []).append(brand_id)

    m = Mercapi()
    status_enum = getattr(SearchRequestData, "Status", None)
    sold_status = None
    if status_enum is not None:
        for candidate in ("SOLD_OUT", "STATUS_SOLD_OUT", "TRADING_COMPLETE", "SOLD"):
            member = getattr(status_enum, candidate, None)
            if member is not None:
                sold_status = member
                print(f"판매완료 상태 이름으로 '{candidate}' 사용")
                break
    if sold_status is None:
        print("경고: 판매완료 상태 enum을 못 찾았습니다. 상태 필터 없이 검색합니다 (판매중 포함될 수 있음).", file=sys.stderr)

    sort_by = getattr(SearchRequestData.SortBy, "SORT_CREATED_TIME", None)

    seen = load_seen()
    print(f"기존 seen.json에 등록된 상품 수: {len(seen)}")

    all_items = []
    for price_cap, brand_ids in price_groups.items():
        kwargs = dict(
            categories=[category_id] if category_id else [],
            brands=brand_ids,
            price_max=price_cap,
            status=[sold_status] if sold_status else [],
        )
        if sort_by is not None:
            kwargs["sort_by"] = sort_by
            kwargs["sort_order"] = SearchRequestData.SortOrder.ORDER_DESC
        print(f"가격상한 {price_cap}엔 그룹, 판매완료 검색: 브랜드 {len(brand_ids)}개")
        results = await m.search("", **kwargs)
        all_items.extend(results.items)

    print(f"판매완료 검색 결과 총 {len(all_items)}건")

    embeds = []
    missed_count = 0
    caught_count = 0
    for item in all_items:
        item_id = getattr(item, "id_", None) or getattr(item, "id", None)
        was_caught = item_id in seen
        if was_caught:
            caught_count += 1
        else:
            missed_count += 1
        embeds.append(build_embed(item, was_caught))

    print(f"결과 요약: 정상 캐치 {caught_count}건 / 놓쳤을 가능성 {missed_count}건")

    if embeds:
        await send_discord_batch(embeds)
    else:
        print("판매완료 상품이 검색되지 않았습니다.")


if __name__ == "__main__":
    asyncio.run(main())
