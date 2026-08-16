# ----------------------------------------------------------------------
# 메루카리 알림봇 설정 파일
# ----------------------------------------------------------------------
# 이 파일만 수정하면 main.py는 건드릴 필요 없습니다.
# 브랜드 추가/삭제, 가격 상한 변경, 제외 키워드 조정은 전부 여기서 합니다.
#
# 주의:
# - 문자열은 반드시 큰따옴표(") 또는 작은따옴표(')로 감싸야 합니다.
# - 각 항목 끝에 콤마(,)를 빠뜨리지 않도록 주의하세요.
# - 브랜드 이름은 메루카리 앱에서 실제로 표기되는 것을 그대로 복붙하는 게 안전합니다
#   (대소문자/띄어쓰기가 달라도 어느 정도 매칭은 되지만, 정확할수록 좋습니다).
# ----------------------------------------------------------------------

# 알림 받을 브랜드 목록 (메루카리 표기 이름 그대로).
# 대부분은 이 리스트에 이름 하나만 적으면 됩니다.
TARGET_BRANDS = [
    "NIL ADMIRARI",
    "BLACK COMME des GARCONS",
    "COMME des GARCONS HOMME PLUS",
    "COMME des GARCONS HOMME",
    "COMME des GARCONS",
    "Maison Martin Margiela",
    "Maison Margiela",
    "D&G ／ Dolce＆Gabbana",
    "MM6",
    "MM6 Maison Margiela",
    "JUNYA WATANABE COMME des GARCONS MAN",
    "JUNYA WATANABE COMME des GARCONS",
    "JUNYA WATANABE MAN",
    "JUNYA WATANABE",
    "Prada Linea Rossa",
    "PRADA SPORT",
    "Helmut Lang",
    "NUMBER (N)INE",
    "RAF by RAF SIMONS",
    "RAF SIMONS",
    "EYE JUNYA WATANABE MAN",
    "eYe COMME des GARCONS JUNYA WATANABE MAN",
    "Givenchy",
    "Dior Homme",
    "Yohji Yamamoto",
    "whoop-de-doo",
    "NEIL BARRETT",
    "SAINT LAURENT PARIS",
    "Saint Laurent",
    "LAD MUSICIAN",
    "ISAMUKATAYAMA BACKLASH",
    "GUIDI",
    "junhashimoto",
    "Alexander Wang",
    "ripvanwinkle",
    "CABANE de ZUCCA",
    "The Viridi-anne",
    "Hysteric Glamour",
    "UNDERCOVER",
    "Vivienne Westwood",
    "Vivienne Westwood MAN",
]

# 전체 기본 가격 상한(엔). TARGET_BRANDS의 모든 브랜드에 적용됨.
PRICE_MAX = 20000

# 특정 브랜드만 가격 상한을 다르게 주고 싶을 때 여기에 등록.
# 형식: "TARGET_BRANDS에 적은 표시이름 그대로": 가격(엔)
# 예: "Saint Laurent": 13000,
# 등록 안 된 브랜드는 위 PRICE_MAX(20000엔)가 그대로 적용됩니다.
# 지금은 전 브랜드가 동일한 가격 상한을 쓰므로 비워둔 상태입니다.
BRAND_PRICE_OVERRIDES = {}

# 검색 대상 카테고리 후보 (facets에서 이 중 하나라도 이름에 포함되면 그 카테고리 사용).
TARGET_CATEGORY_CANDIDATES = ["メンズファッション", "男性ファッション", "men's fashion", "メンズ"]

# 상품명에 아래 키워드 중 하나라도 포함되면 알림에서 제외.
# 넥타이/스카프/지갑/시계류처럼 원치 않는 소품 카테고리를 거르는 용도.
EXCLUDE_KEYWORDS = [
    "ネクタイ", "necktie", "tie", "スカーフ", "scarf", "マフラー",
    "財布", "wallet",
    "腕時計", "時計", "watch",
]
