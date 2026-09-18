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
    "ARMANI",
    "Maison Margiela",
    "Maison Martin Margiela",
    "Helmut Lang",
    "Hysteric Glamour",
    # 빈티지(올드) 제품만 원하는 브랜드 - 가격상한은 5000엔, 제목에
    # BRAND_REQUIRE_KEYWORDS_OVERRIDES 키워드가 있어야만 알림한다(아래 참고).
    "VANS",
    "STUSSY",
    "PRADA",
    "PRADA SPORT",
]

# 기본 가격 상한(엔). TARGET_BRANDS 중 BRAND_PRICE_OVERRIDES에 없는 브랜드는 이 값을 쓴다.
PRICE_MAX = 20000

# 브랜드별로 다른 가격 상한을 쓰고 싶을 때만 채운다.
BRAND_PRICE_OVERRIDES = {
    # "Supreme": 0,
    "Helmut Lang": 30000,
    "Hysteric Glamour": 20000,
    "Dior Homme": 30000,
    "Giorgio Armani": 30000,
    "EMPORIO ARMANI": 30000,
    "ARMANI COLLEZIONI": 30000,
    "ARMANI JEANS": 30000,
    "ARMANI": 30000,
    "Maison Margiela": 30000,
    "Maison Martin Margiela": 30000,
    "VANS": 5000,
    "STUSSY": 5000,
}

# 브랜드+가격상한만으로는 부족하고, 제목에 특정 키워드 중 하나라도 있어야만
# 알림하고 싶을 때 채운다(HELMUT_LANG_KEYWORDS와 별개 - 그쪽은 "본인 디렉팅
# 시절" 판별용으로 숫자 경계 처리 등 전용 로직이 있고, 이건 단순 부분일치).
# VANS/STUSSY: 올드(빈티지) 제품만 원해서 old/90s/00s 중 하나라도 있어야 통과.
BRAND_REQUIRE_KEYWORDS_OVERRIDES = {
    "VANS": ["old", "90s", "00s"],
    "STUSSY": ["old", "90s", "00s"],
}

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

# 브랜드별로 "メンズ" 하위의 모든 세부(리프) 카테고리 중 여기 적힌 이름만 빼고
# 전부 검색에 쓰고 싶을 때 채운다(제목에 안 적혀도 실제로 그 카테고리로 등록된
# 매물까지 확실히 걸러낼 수 있어 제목 키워드 매칭보다 정확하다). 야후옥션은
# 카테고리를 이런 식으로 다룰 수 없어서(auccat 하나만 지정 가능) 이건
# main.py(메루카리)에서만 쓰이고, 야후 쪽은 여전히 BRAND_EXCLUDE_KEYWORDS_OVERRIDES로
# 처리한다.
BRAND_CATEGORY_EXCLUDE_OVERRIDES = {
    "Hysteric Glamour": ["Tシャツ/カットソー(半袖/袖なし)", "Tシャツ/カットソー(七分/長袖)"],
    # "靴"는 리프가 아니라 스니ーカー/부츠/로퍼 등을 묶은 상위 카테고리 이름
    # (resolve_leaf_category_ids_excluding이 상위 이름 매칭도 처리한다) - VANS는
    # 신발 자체보다 다른 아이템(의류/굿즈 등)을 원해서 신발 카테고리 전체를 뺐다.
    "VANS": ["靴"],
    # "アクセサリー"(목걸이/반지 등)와 "小物"(지갑/벨트/키홀더 등)도 둘 다 리프가
    # 아니라 상위 카테고리 이름 - 프라다는 이 두 묶음(소품/악세사리) 말고 의류 등
    # 다른 아이템 위주로 보고 싶어서 뺐다.
    "PRADA": ["アクセサリー", "小物"],
    "PRADA SPORT": ["アクセサリー", "小物"],
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

# 상품명에 이 키워드 중 하나라도 포함되면 알림에서 제외한다(모든 브랜드 공통).
EXCLUDE_KEYWORDS = [
    "ネクタイ",
    "スカーフ",
    "香水",
    "時計",
    "下着",
    "財布",  # 지갑
]

# 특정 브랜드에서만 이 키워드가 제목에 있으면 제외한다(EXCLUDE_KEYWORDS와 별개로
# 추가 적용됨, 다른 브랜드에는 영향 없음). main.py는 상품 상세조회로 얻은 실제
# 브랜드명 기준으로, yahoo_main.py는 검색에 쓴 display명 기준으로 판단한다.
BRAND_EXCLUDE_KEYWORDS_OVERRIDES = {
    "Hysteric Glamour": ["Tシャツ", "T-Shirt", "Tshirt", "ティーシャツ"],
    "PRADA": ["バッグ", "かばん", "鞄", "Bag"],
}

# 야후옥션 카테고리 오버라이드. 야후는 브랜드 ID 필터는 없지만(그래서 키워드로
# 검색) 카테고리 필터(auccat)는 실제로 작동한다 - 기본값은 yahoo_main.py의
# DEFAULT_AUCCAT(메ンズファッション). 여기 등록된 브랜드는 그 대신 이 auccat을 쓴다.
BRAND_CATEGORY_OVERRIDES_YAHOO = {}

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
    {"display": "ARMANI", "queries": ["ARMANI", "アルマーニ"]},
    {"display": "Maison Margiela", "queries": ["Maison Margiela", "メゾン マルジェラ"]},
    {"display": "Maison Martin Margiela", "queries": ["Maison Martin Margiela", "メゾン マルタン マルジェラ"]},
    {"display": "Helmut Lang", "queries": ["Helmut Lang", "ヘルムートラング"]},
    {"display": "Hysteric Glamour", "queries": ["Hysteric Glamour", "ヒステリックグラマー"]},
    {"display": "VANS", "queries": ["VANS", "バンズ"]},
    {"display": "STUSSY", "queries": ["STUSSY", "ステューシー"]},
    {"display": "PRADA", "queries": ["PRADA", "プラダ"]},
    {"display": "PRADA SPORT", "queries": ["PRADA SPORT", "プラダスポーツ"]},
]
