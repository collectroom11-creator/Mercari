"""
검색 필터 설정. 실제 배포 전 아래 값을 채워넣으세요.
"""

# 알림받고 싶은 브랜드의 "표시 이름" 목록.
# facets 폴더의 브랜드 JSON에 있는 name과 정확히 일치(우선), 없으면 부분 일치(폴백)하는 걸 찾는다.
TARGET_BRANDS = [
    "Dior Homme",
    "Giorgio Armani",
    "EMPORIO ARMANI",
    "ARMANI COLLEZIONI",
    "ARMANI JEANS",
    "EMPORIO ARMANI EA7",
    "ARMANI",
    "D&G ／ Dolce＆Gabbana",
    "Maison Margiela",
    "Maison Martin Margiela",
    "Helmut Lang",
    "Hysteric Glamour",
]

# 기본 가격 상한(엔). TARGET_BRANDS 중 BRAND_PRICE_OVERRIDES에 없는 브랜드는 이 값을 쓴다.
PRICE_MAX = 20000

# 브랜드별로 다른 가격 상한을 쓰고 싶을 때만 채운다.
BRAND_PRICE_OVERRIDES = {
    # "Supreme": 0,
    "Helmut Lang": 30000,
    "Hysteric Glamour": 12000,
}

# 카테고리 후보 이름들 (정확 일치 우선, 없으면 부분 일치로 폴백).
# facets 폴더의 카테고리 JSON에 있는 name과 비교한다.
TARGET_CATEGORY_CANDIDATES = [
    "メンズ",
]

# 브랜드별로 TARGET_CATEGORY_CANDIDATES 대신 쓸 카테고리를 지정하고 싶을 때만 채운다.
# "メンズ" 루트 아래에서 이름이 정확히 일치하는 카테고리들을 전부 찾아서 검색에 쓴다
# (여러 개면 OR로 검색됨).
BRAND_CATEGORY_OVERRIDES = {
    "Hysteric Glamour": ["デニム/ジーンズ"],  # 남성 청바지
}

# 헬무트 랭: 브랜드+가격상한만으로는 "헬무트 랭 본인이 디렉터였던 시절
# (1986년 브랜드 시작 ~ 2005년 완전히 손 뗌)" 제품인지 구조화된 데이터로
# 구분할 방법이 없다. 그래서 제목에 아래 키워드 중 하나라도 있어야만 알림한다
# (가격상한 30000엔은 BRAND_PRICE_OVERRIDES에서 이미 적용됨).
# "本人期"는 일본 빈티지 시장에서만 쓰이는 표현이라 영어 대응어가 따로 없어 일본어만 넣었다.
HELMUT_LANG_KEYWORDS = [
    # 연도 표기 (1986~2005 두자리) - 앞뒤로 다른 숫자가 안 붙어있을 때만 매칭됨
    "86", "87", "88", "89", "90", "91", "92", "93", "94", "95",
    "96", "97", "98", "99", "00", "01", "02", "03", "04", "05",
    "本人期",
    "paint", "painter", "ペイント", "ペインター",
    "re-edition", "reedition", "リエディション",
    "bondage", "ボンテージ",
    "stripe", "striped", "ストライプ",
]

# 상품명에 이 키워드 중 하나라도 포함되면 알림에서 제외한다.
EXCLUDE_KEYWORDS = [
    "ネクタイ",
    "スカーフ",
    "香水",
    "時計",
    "下着",
]

# 야후옥션용 브랜드 목록. 야후옥션은 브랜드 ID 필터가 없어서 키워드로
# 검색한다(mercapi 검색과 다름). 셀러가 영어/일본어 중 아무 표기로나
# 상품명을 적기 때문에, 브랜드마다 두 표기를 다 넣어 두 번 검색한다.
# 가격상한은 위 PRICE_MAX / BRAND_PRICE_OVERRIDES를 그대로 재사용한다
# (display 이름이 BRAND_PRICE_OVERRIDES의 키와 일치해야 적용됨).
TARGET_BRANDS_YAHOO = [
    {"display": "Dior Homme", "queries": ["Dior Homme", "ディオール オム"]},
    {"display": "Giorgio Armani", "queries": ["Giorgio Armani", "ジョルジオ アルマーニ"]},
    {"display": "EMPORIO ARMANI", "queries": ["EMPORIO ARMANI", "エンポリオ アルマーニ"]},
    {"display": "ARMANI COLLEZIONI", "queries": ["ARMANI COLLEZIONI", "アルマーニ コレツィオーニ"]},
    {"display": "ARMANI JEANS", "queries": ["ARMANI JEANS", "アルマーニ ジーンズ"]},
    {"display": "EMPORIO ARMANI EA7", "queries": ["EMPORIO ARMANI EA7", "エンポリオ アルマーニ EA7"]},
    {"display": "ARMANI", "queries": ["ARMANI", "アルマーニ"]},
    {"display": "D&G ／ Dolce＆Gabbana", "queries": ["D&G", "ドルチェ&ガッバーナ"]},
    {"display": "Maison Margiela", "queries": ["Maison Margiela", "メゾン マルジェラ"]},
    {"display": "Maison Martin Margiela", "queries": ["Maison Martin Margiela", "メゾン マルタン マルジェラ"]},
    {"display": "Helmut Lang", "queries": ["Helmut Lang", "ヘルムートラング"]},
    # 야후는 카테고리 필터가 없어서, 검색어 자체에 デニム를 섞어 청바지로 좁힌다.
    {
        "display": "Hysteric Glamour",
        "queries": [
            "Hysteric Glamour デニム",
            "ヒステリックグラマー デニム",
        ],
    },
]
