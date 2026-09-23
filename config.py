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
    "Ann Demeulemeester",
    "JEAN PAUL GAULTIER",
    "Jean Paul GAULTIER HOMME",
    "SAINT LAURENT PARIS",
    "Saint Laurent",
    "Helmut Lang",
    "Hysteric Glamour",
    "Dries Van Noten",
    "Neil Barrett",
    "Undercover",
    "Gucci",
    "Vivienne Westwood",
    "Givenchy",
    "Stone Island",
    "Junya Watanabe",
    "Celine",
    # 메루카리 브랜드 태그가 D&G와 한 항목으로 합쳐져 있어서 표시 이름을 그대로 써야 매칭된다.
    "D&G ／ Dolce＆Gabbana",
    "Kris Van Assche",
    "Dirk Bikkembergs",
    "Yohji Yamamoto",
    "Issey Miyake",
    "wjk",
    # 메루카리 브랜드 태그 표기가 이렇게 붙어 있어서(공백/마침표 포함) 그대로 써야 매칭된다.
    "TAKAHIROMIYASHITATheSoloist.",
    "John Galliano",
    # "Black Barrett"가 아니라 메루카리 브랜드 태그명 그대로 써야 매칭된다.
    "BLACKBARRETT by NEIL BARRETT",
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
    "Ann Demeulemeester": 30000,
    "JEAN PAUL GAULTIER": 30000,
    "Jean Paul GAULTIER HOMME": 30000,
    "SAINT LAURENT PARIS": 30000,
    "Saint Laurent": 30000,
    "Dries Van Noten": 30000,
    "Neil Barrett": 30000,
    "Undercover": 30000,
    "Gucci": 30000,
    "Vivienne Westwood": 30000,
    "Givenchy": 30000,
    "Stone Island": 30000,
    "Junya Watanabe": 30000,
    "Celine": 30000,
    "D&G ／ Dolce＆Gabbana": 30000,
    "Kris Van Assche": 30000,
    "Dirk Bikkembergs": 30000,
    "Yohji Yamamoto": 30000,
    "Issey Miyake": 30000,
    "wjk": 30000,
    "TAKAHIROMIYASHITATheSoloist.": 30000,
    "John Galliano": 30000,
    "BLACKBARRETT by NEIL BARRETT": 30000,
    "VANS": 5000,
    "STUSSY": 5000,
}

# 브랜드+가격상한만으로는 부족하고, 제목에 특정 키워드 중 하나라도 있어야만
# 알림하고 싶을 때 채운다.
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

# "メンズ" 하위 카테고리 중 모든 브랜드에서 공통으로 빼고 싶은 것들.
# "アクセサリー"(목걸이/반지 등)와 "小物"(지갑/벨트/키홀더 등)은 실제로 뒤져보면
# 저가 잡화 위주라 의류 위주로 보고 싶은 목적에 안 맞아서 브랜드 상관없이 전부 뺀다.
# 이름은 리프 자신뿐 아니라 상위 카테고리 이름과도 비교되므로(resolve_leaf_category_ids_excluding
# 참고) 이렇게 상위 카테고리 이름만 적어도 그 밑 리프 전부가 빠진다. 야후옥션은
# 카테고리를 이런 식으로 다룰 수 없어서(auccat 하나만 지정 가능) 이건
# main.py(메루카리)에서만 쓰이고, 야후 쪽은 여전히 BRAND_EXCLUDE_KEYWORDS_OVERRIDES로
# 처리한다.
GLOBAL_CATEGORY_EXCLUDE = ["アクセサリー", "小物"]

# 브랜드별로 GLOBAL_CATEGORY_EXCLUDE에 추가로 더 빼고 싶은 카테고리가 있을 때만 채운다.
BRAND_CATEGORY_EXCLUDE_OVERRIDES = {
    # 히스테릭글래머: 티셔츠, 그리고 모자도 원하지 않아서 뺐다.
    "Hysteric Glamour": ["Tシャツ/カットソー(半袖/袖なし)", "Tシャツ/カットソー(七分/長袖)", "帽子"],
    # "靴"는 리프가 아니라 스니ーカー/부츠/로퍼 등을 묶은 상위 카테고리 이름 - VANS는
    # 신발 자체보다 다른 아이템(의류/굿즈 등)을 원해서 신발 카테고리 전체를 뺐다.
    "VANS": ["靴"],
}

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
    {"display": "Ann Demeulemeester", "queries": ["Ann Demeulemeester", "アン ドゥムルメステール"]},
    {"display": "JEAN PAUL GAULTIER", "queries": ["Jean Paul Gaultier", "ジャンポールゴルチエ"]},
    {"display": "Jean Paul GAULTIER HOMME", "queries": ["Jean Paul Gaultier Homme", "ジャンポールゴルチエ オム"]},
    {"display": "SAINT LAURENT PARIS", "queries": ["Saint Laurent Paris", "サンローラン パリ"]},
    {"display": "Saint Laurent", "queries": ["Saint Laurent", "サンローラン"]},
    {"display": "Helmut Lang", "queries": ["Helmut Lang", "ヘルムートラング"]},
    {"display": "Hysteric Glamour", "queries": ["Hysteric Glamour", "ヒステリックグラマー"]},
    {"display": "Dries Van Noten", "queries": ["Dries Van Noten", "ドリスヴァンノッテン"]},
    {"display": "Neil Barrett", "queries": ["Neil Barrett", "ニールバレット"]},
    {"display": "Undercover", "queries": ["Undercover", "アンダーカバー"]},
    {"display": "Gucci", "queries": ["Gucci", "グッチ"]},
    {"display": "Vivienne Westwood", "queries": ["Vivienne Westwood", "ヴィヴィアンウエストウッド"]},
    {"display": "Givenchy", "queries": ["Givenchy", "ジバンシィ"]},
    {"display": "Stone Island", "queries": ["Stone Island", "ストーンアイランド"]},
    {"display": "Junya Watanabe", "queries": ["Junya Watanabe", "ジュンヤワタナベ"]},
    {"display": "Celine", "queries": ["Celine", "セリーヌ"]},
    {"display": "D&G ／ Dolce＆Gabbana", "queries": ["Dolce & Gabbana", "D&G", "ドルチェアンドガッバーナ"]},
    {"display": "Kris Van Assche", "queries": ["Kris Van Assche", "クリスヴァンアッシュ"]},
    {"display": "Dirk Bikkembergs", "queries": ["Dirk Bikkembergs", "ダークビッケンバーグ"]},
    {"display": "Yohji Yamamoto", "queries": ["Yohji Yamamoto", "ヨウジヤマモト"]},
    {"display": "Issey Miyake", "queries": ["Issey Miyake", "イッセイミヤケ"]},
    {"display": "wjk", "queries": ["wjk"]},
    {"display": "TAKAHIROMIYASHITATheSoloist.", "queries": ["Takahiromiyashita The Soloist", "タカヒロミヤシタザソロイスト"]},
    {"display": "John Galliano", "queries": ["John Galliano", "ジョンガリアーノ"]},
    {"display": "BLACKBARRETT by NEIL BARRETT", "queries": ["Black Barrett", "ブラックバレット"]},
    {"display": "VANS", "queries": ["VANS", "バンズ"]},
    {"display": "STUSSY", "queries": ["STUSSY", "ステューシー"]},
    {"display": "PRADA", "queries": ["PRADA", "プラダ"]},
    {"display": "PRADA SPORT", "queries": ["PRADA SPORT", "プラダスポーツ"]},
]
