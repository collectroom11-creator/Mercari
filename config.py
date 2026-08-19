"""
검색 필터 설정. 실제 배포 전 아래 값을 채워넣으세요.
"""

# 알림받고 싶은 브랜드의 "표시 이름" 목록.
# facets 폴더의 브랜드 JSON에 있는 name과 정확히 일치(우선), 없으면 부분 일치(폴백)하는 걸 찾는다.
TARGET_BRANDS = [
    # "Comme des Garcons",
    # "Yohji Yamamoto",
]

# 기본 가격 상한(엔). TARGET_BRANDS 중 BRAND_PRICE_OVERRIDES에 없는 브랜드는 이 값을 쓴다.
PRICE_MAX = 50000

# 브랜드별로 다른 가격 상한을 쓰고 싶을 때만 채운다.
BRAND_PRICE_OVERRIDES = {
    # "Supreme": 30000,
}

# 카테고리 후보 이름들 (정확 일치 우선, 없으면 부분 일치로 폴백).
# facets 폴더의 카테고리 JSON에 있는 name과 비교한다.
TARGET_CATEGORY_CANDIDATES = [
    "メンズファッション",
]

# 상품명에 이 키워드 중 하나라도 포함되면 알림에서 제외한다.
EXCLUDE_KEYWORDS = [
    "ネクタイ",
    "スカーフ",
]
