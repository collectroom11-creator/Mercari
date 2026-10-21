// 대시보드 브랜드 비율용. 상품에 브랜드 칸이 따로 없어서 제목(영어/일본어/한국어가 섞인
// 메루카리·켄즈포스트 상품명)에서 브랜드를 찾는다. 같은 회사의 라인(엠포리오/조르지오 아르마니,
// AZ by junhashimoto 등)은 한 브랜드로 묶는다. 위에서부터 먼저 맞는 브랜드로 정한다.
const BRANDS = [
  { name: "junhashimoto", aliases: ["junhashimoto", "ジュンハシモト", "エーゼイ", "준하시모토"] },
  { name: "Armani", aliases: ["armani", "アルマーニ", "아르마니"] },
  { name: "Dior Homme", aliases: ["diorhomme", "dior", "ディオール", "디올"] },
  { name: "Dolce&Gabbana", aliases: ["dolce&gabbana", "dolce＆gabbana", "d&g", "ドルチェ", "돌체"] },
  { name: "Margiela", aliases: ["margiela", "マルジェラ", "마르지엘라"] },
  { name: "Hysteric Glamour", aliases: ["hystericglamour", "ヒステリック", "히스테릭"] },
  { name: "Helmut Lang", aliases: ["helmutlang", "ヘルムートラング", "헬무트랭"] },
  { name: "TORNADO MART", aliases: ["tornadomart", "トルネードマート", "토네이도마트"] },
  { name: "LAD MUSICIAN", aliases: ["ladmusician", "ラッドミュージシャン", "라드뮤지션"] },
  { name: "HUGO BOSS", aliases: ["hugoboss", "ヒューゴボス", "휴고보스"] },
  { name: "PRADA", aliases: ["prada", "プラダ", "프라다"] },
  { name: "GUCCI", aliases: ["gucci", "グッチ", "구찌"] },
  { name: "DIESEL", aliases: ["diesel", "ディーゼル", "디젤"] },
  { name: "Neil Barrett", aliases: ["neilbarrett", "ニールバレット", "닐바렛"] },
  { name: "Saint Laurent", aliases: ["saintlaurent", "サンローラン", "생로랑"] },
  { name: "Vivienne Westwood", aliases: ["viviennewestwood", "ヴィヴィアン", "비비안웨스트우드"] },
  { name: "Alexander McQueen", aliases: ["mcqueen", "mcq", "マックイーン", "맥퀸"] },
  { name: "nil admirari", aliases: ["niladmirari", "ニルアドミラリ"] },
  { name: "wjk", aliases: ["wjk"] },
  { name: "ISAMU KATAYAMA BACKLASH", aliases: ["isamukatayama", "backlash", "バックラッシュ", "백래쉬"] },
  { name: "Paul Smith", aliases: ["paulsmith", "ポールスミス", "폴스미스"] },
  { name: "Levi's", aliases: ["levi's", "levis", "リーバイス", "리바이스"] },
  { name: "VANS", aliases: ["vans", "バンズ", "반스"] },
  { name: "Stussy", aliases: ["stussy", "ステューシー", "스투시"] },
  { name: "ZUCCa", aliases: ["zucca", "ズッカ"] },
  { name: "Yohji Yamamoto", aliases: ["yohjiyamamoto", "ヨウジヤマモト", "요지야마모토"] },
  { name: "COMME des GARCONS", aliases: ["commedesgarcons", "コムデギャルソン", "꼼데가르송"] },
  { name: "Undercover", aliases: ["undercover", "アンダーカバー", "언더커버"] },
];

// 공백, 가운뎃점, 전각 공백을 없애고 소문자로 - "AZ by jun hashimoto", "エンポリオ・アルマーニ"도 맞게
const normalize = (s) => String(s).toLowerCase().replace(/[\s　・·]/g, "");
const NORMALIZED = BRANDS.map((b) => ({ name: b.name, aliases: b.aliases.map(normalize) }));

function detectBrand(title) {
  const t = normalize(title);
  const hit = NORMALIZED.find((b) => b.aliases.some((a) => t.includes(a)));
  return hit ? hit.name : null;
}

// 지금 가진 재고(판매완료·개인구매 제외)의 브랜드 비율. by: "count"(상품 수) 또는 "cost"(원가 합).
// 큰 순으로 top개까지, 나머지와 브랜드를 못 찾은 상품은 '기타' 한 조각으로.
function computeBrandMix(items, { top = 7, by = "count" } = {}) {
  const groups = new Map();
  const other = { name: "기타", value: 0, count: 0 };
  const list = items.filter((i) => i.status !== "판매완료" && i.status !== "개인구매");
  for (const i of list) {
    const name = detectBrand(i.title);
    const g = name ? groups.get(name) || { name, value: 0, count: 0 } : other;
    g.value += by === "cost" ? i.costKrw : 1;
    g.count += 1;
    if (name) groups.set(name, g);
  }
  const sorted = [...groups.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const slices = sorted.slice(0, top);
  for (const g of sorted.slice(top)) {
    other.value += g.value;
    other.count += g.count;
  }
  if (other.count > 0) slices.push(other);
  return { total: slices.reduce((s, g) => s + g.value, 0), slices };
}

module.exports = { detectBrand, computeBrandMix };
