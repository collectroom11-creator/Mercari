"""
검색 필터 설정. 실제 배포 전 아래 값을 채워넣으세요.
"""
import json
from pathlib import Path

# 앱(재고관리 툴의 "메루카리 필터" 탭)에서 편집하는 값은 filters.json에 있다.
# 브랜드 이름은 facets 폴더 브랜드 JSON의 name과 정확히 일치해야 매칭된다
# (예: "D&G ／ Dolce＆Gabbana", "TAKAHIROMIYASHITATheSoloist.", "ripvanwinkle").
_FILTERS = json.loads((Path(__file__).parent / "filters.json").read_text(encoding="utf-8"))

# 알림받고 싶은 브랜드의 "표시 이름" 목록.
# facets 폴더의 브랜드 JSON에 있는 name과 정확히 일치(우선), 없으면 부분 일치(폴백)하는 걸 찾는다.
TARGET_BRANDS = [b["name"] for b in _FILTERS["brands"]]

# 기본 가격 상한(엔). TARGET_BRANDS 중 BRAND_PRICE_OVERRIDES에 없는 브랜드는 이 값을 쓴다.
PRICE_MAX = 20000

# 브랜드별로 다른 가격 상한을 쓰고 싶을 때만 채운다.
BRAND_PRICE_OVERRIDES = {b["name"]: b["priceMax"] for b in _FILTERS["brands"]}

# 브랜드+가격상한만으로는 부족하고, 제목에 특정 키워드 중 하나라도 있어야만
# 알림하고 싶을 때 채운다.
BRAND_REQUIRE_KEYWORDS_OVERRIDES = {}

# 카테고리 후보 이름들 (정확 일치 우선, 없으면 부분 일치로 폴백).
# facets 폴더의 카테고리 JSON에 있는 name과 비교한다.
TARGET_CATEGORY_CANDIDATES = [
    "メンズ",
]

# 브랜드별로 TARGET_CATEGORY_CANDIDATES 대신 쓸 카테고리를 지정하고 싶을 때만 채운다.
# "メンズ" 루트 아래에서 이름이 정확히 일치하는 카테고리들을 전부 찾아서 검색에 쓴다
# (여러 개면 OR로 검색됨).
# 히스테릭글래머는 예전엔 청바지로만 좁혀놨었는데, 그러면 청바지 말고 다른
# 아이템은 놓쳐서 범위를 풀었다 - 대신 티셔츠만 아래 BRAND_CATEGORY_EXCLUDE_OVERRIDES로 뺀다.
BRAND_CATEGORY_OVERRIDES = {}

# "メンズ" 하위 카테고리 중 모든 브랜드에서 공통으로 빼고 싶은 것들.
# "アクセサリー"(목걸이/반지 등)와 "小物"(지갑/벨트/키홀더 등)은 실제로 뒤져보면
# 저가 잡화 위주라 의류 위주로 보고 싶은 목적에 안 맞아서 브랜드 상관없이 전부 뺀다.
# 이름은 리프 자신뿐 아니라 상위 카테고리 이름과도 비교되므로(resolve_leaf_category_ids_excluding
# 참고) 이렇게 상위 카테고리 이름만 적어도 그 밑 리프 전부가 빠진다.
GLOBAL_CATEGORY_EXCLUDE = ["アクセサリー", "小物", "時計"]

# 브랜드별로 GLOBAL_CATEGORY_EXCLUDE에 추가로 더 빼고 싶은 카테고리가 있을 때만 채운다.
BRAND_CATEGORY_EXCLUDE_OVERRIDES = {
    # 히스테릭글래머: 티셔츠, 그리고 모자도 원하지 않아서 뺐다.
    "Hysteric Glamour": ["Tシャツ/カットソー(半袖/袖なし)", "Tシャツ/カットソー(七分/長袖)", "帽子"],
}

# 상품명에 이 키워드 중 하나라도 포함되면 알림에서 제외한다(모든 브랜드 공통).
EXCLUDE_KEYWORDS = _FILTERS["excludeKeywords"]

# 특정 브랜드에서만 이 키워드가 제목에 있으면 제외한다(EXCLUDE_KEYWORDS와 별개로
# 추가 적용됨, 다른 브랜드에는 영향 없음). 상품 상세조회로 얻은 실제 브랜드명 기준으로 판단한다.
BRAND_EXCLUDE_KEYWORDS_OVERRIDES = _FILTERS["brandExcludeKeywords"]
