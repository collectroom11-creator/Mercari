function computeCostKrw({
  jpyPrice,
  fxRate,
  dutyRate,
  vatRate,
  localShippingJpy = 0,
  intlShippingJpy = 0,
  feeJpy = 0,
}) {
  // 관세/부가세는 상품가만이 아니라 현지+국제 배송비, 켄즈포스트 수수료까지
  // 합친 통관가액 기준으로 붙는다.
  const dutiableJpy = jpyPrice + localShippingJpy + intlShippingJpy + feeJpy;
  const landed = (dutiableJpy * fxRate) / 100;
  const afterDuty = landed * (1 + dutyRate);
  const afterVat = afterDuty * (1 + vatRate);
  return Math.round(afterVat);
}

const DUTY_RATE = 0.13;
const VAT_RATE = 0.10;
const INTL_SHIPPING_JPY = 500;
// 켄즈포스트 수수료는 매입가/등급과 무관하게 고정 300엔.
const FEE_JPY = 300;

// 엔화 제품가 구간별로 최소 마진율을 다르게 적용한다: 5천엔 미만 60%, 5천~1만엔 50%,
// 1만엔 이상 40%. 저가 상품은 %로는 커도 절대 금액이 작아서 마진율을 더 높게 잡는다.
function getTieredMarginRate(jpyPrice) {
  if (jpyPrice >= 10000) return 0.4;
  if (jpyPrice >= 5000) return 0.5;
  return 0.6;
}

function computeTieredSalePrice(costKrw, jpyPrice) {
  const rate = getTieredMarginRate(jpyPrice);
  return { rate, price: Math.round(costKrw / (1 - rate)) };
}

function extractImageUrl(html) {
  // og:image가 있으면 우선 쓰되, 사이트 공용 로고(og-image.png류)는 상품 사진이
  // 아니므로 건너뛴다. 없으면 페이지의 첫 <img> src를 대략적으로 사용한다.
  const ogMatches = [...html.matchAll(/<meta\s+property="og:image"\s+content="([^"]+)"/g)];
  for (const m of ogMatches) {
    if (!/og-image/i.test(m[1])) return m[1];
  }
  const imgMatch = html.match(/<img[^>]+src="([^"]+)"/);
  return imgMatch ? imgMatch[1] : null;
}

function extractBuyFxRate(html) {
  // 켄즈포스트 페이지 하단(사이드바)의 환율안내 박스에서 "살 때" 환율(100엔 기준)을
  // 읽는다. 실제 페이지 마크업 확인함:
  // <table class="amount"><tbody>
  //   <tr><td rowspan="2">적용환율</td><td class="exchange-title">살 때</td><td class="exchange-title">팔 때</td></tr>
  //   <tr><td>901</td><td>884</td></tr>
  // </tbody></table>
  const tableMatch = html.match(/<table class="amount">[\s\S]*?<\/table>/);
  if (!tableMatch) return null;
  const rows = [...tableMatch[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  if (rows.length < 2) return null;
  const valueCells = [...rows[1][1].matchAll(/<td[^>]*>([^<]+)<\/td>/g)].map((m) => m[1].trim());
  const buyRate = valueCells[0] ? parseFloat(valueCells[0]) : null;
  return Number.isFinite(buyRate) ? buyRate : null;
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function extractTitle(html) {
  // h1을 우선 쓰고, 없으면 og:title, 그래도 없으면 <title> 태그까지 순서대로 시도한다.
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  if (h1Match) return decodeHtmlEntities(h1Match[1].trim());

  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
  if (ogTitleMatch) return decodeHtmlEntities(ogTitleMatch[1].trim());

  const titleTagMatch = html.match(/<title>([^<]+)<\/title>/);
  if (titleTagMatch) return decodeHtmlEntities(titleTagMatch[1].trim());

  return null;
}

function extractJpyPrice(html) {
  // 입찰대행 페이지(mercari/bid.s 등)는 실제 구매가를
  // <div class="box-bid-price">...<td class="price">6,170円 ...</td> 구조로 명확히
  // 표시한다(실제 페이지 마크업 확인함). 이게 있으면 최우선으로 쓴다 - 상품 설명
  // 문구에 있는 "1만엔 이상 구매시 할인" 같은 문구 속 큰 숫자를 가격으로 잘못
  // 집어내는 문제가 있었다.
  const bidPriceMatch = html.match(/box-bid-price[\s\S]*?<td class="price">\s*([\d,]+)\s*円/);
  if (bidPriceMatch) {
    return parseInt(bidPriceMatch[1].replace(/,/g, ""), 10);
  }
  // 그 구조가 없는 페이지는 페이지에서 가장 큰 円 금액을 대신 쓴다.
  const priceMatches = [...html.matchAll(/([\d,]{3,})\s*円/g)].map((m) =>
    parseInt(m[1].replace(/,/g, ""), 10)
  );
  return priceMatches.length ? Math.max(...priceMatches) : null;
}

// 켄즈포스트 로그인이 풀려 있으면 대행 페이지에 가격이 안 나온다. 메루카리 상품은
// 링크 안에 원래 메루카리 주소가 들어있어서, 그 페이지(로그인 불필요)에서 대신 읽는다.
// 메루카리 Shops 상품(/shops/product/<id>)도 같은 페이지 구조(h1 제목, ¥가격)라 그대로 읽힌다.
function extractMercariItemUrl(kenzUrl) {
  const m = kenzUrl.match(/https:\/\/jp\.mercari\.com\/(item\/m\d+|shops\/product\/[A-Za-z0-9]+)/);
  return m ? `https://jp.mercari.com/${m[1]}` : null;
}

// 메루카리 가격 영역은 접속 지역에 따라 "KRW 69,077 (¥ 7,650)"처럼 원화가 먼저
// 나오기도 해서, 첫 숫자가 아니라 ¥ 바로 뒤의 숫자를 엔화 가격으로 쓴다.
function parseMercariPriceText(text) {
  const m = text.match(/¥\s*([\d,]+)/);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
}

function parseItemHtml(html) {
  const title = extractTitle(html);
  const jpyPrice = extractJpyPrice(html);
  const imageUrl = extractImageUrl(html);

  return { title, jpyPrice, imageUrl };
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function inStockAt(item, t) {
  if (item.status === "개인구매") return false;
  const created = new Date(item.createdAt);
  if (created >= t) return false;
  if (item.status === "판매완료") {
    const sold = item.soldAt ? new Date(item.soldAt) : null;
    return sold ? sold > t : false;
  }
  return true; // 배송전/업로드전/판매중(과거의 '재고' 포함) - 아직 안 팔린 상태는 전부 재고
}

function computeDashboard(items, opts) {
  const now = opts.now || new Date();
  const monthStart = startOfMonth(now);
  // 조회 기간의 끝 시점 - 이번달이면 지금, 지난달처럼 이미 끝난 달을 조회할 땐
  // 그 달의 마지막 순간을 넘겨받는다. "현재 재고"(stockCostTotal)는 이거와 무관하게
  // 항상 지금 시점 기준이다.
  const periodEnd = opts.periodEnd || now;

  const businessItems = items.filter((i) => i.status !== "개인구매");

  // 배송전/업로드전/판매중 전부 "아직 안 팔린" 재고로 잡는다.
  const stockCostTotal = businessItems
    .filter((i) => i.status !== "판매완료")
    .reduce((sum, i) => sum + i.costKrw, 0);

  const startOfMonthStock = businessItems
    .filter((i) => inStockAt(i, monthStart))
    .reduce((sum, i) => sum + i.costKrw, 0);

  // 조회 기간이 끝나는 시점의 재고 - 이번달이면 지금의 재고와 같고, 지난달처럼
  // 이미 끝난 달이면 그 달 마지막 날 기준 재고를 따로 계산해야 한다.
  const periodEndStock = businessItems
    .filter((i) => inStockAt(i, periodEnd))
    .reduce((sum, i) => sum + i.costKrw, 0);

  const monthPurchases = businessItems
    .filter((i) => new Date(i.createdAt) >= monthStart && new Date(i.createdAt) <= periodEnd)
    .reduce((sum, i) => sum + i.costKrw, 0);

  const monthCogs = startOfMonthStock + monthPurchases - periodEndStock;

  const monthRevenue = businessItems
    .filter(
      (i) =>
        i.status === "판매완료" &&
        i.soldAt &&
        new Date(i.soldAt) >= monthStart &&
        new Date(i.soldAt) <= periodEnd
    )
    .reduce((sum, i) => sum + (i.actualPrice || 0), 0);

  const monthProfit = monthRevenue - monthCogs;

  // 회전율 = 이번달 매출원가 / 현재 재고 - 지금 들고 있는 재고 중 이번달에 얼마나
  // 팔려나갔는지 비율. 재고가 0이면(항목이 아예 없으면) 0으로 둔다.
  const turnoverPct = stockCostTotal > 0 ? Math.round((monthCogs / stockCostTotal) * 100) : 0;

  return {
    stockCostTotal,
    monthCogs,
    monthRevenue,
    monthProfit,
    turnoverPct,
  };
}

// 첫 매입월부터 이번달까지, 달마다 매출/매출원가/순이익을 정리한 목록을 만든다.
// (최신 달이 배열 맨 앞에 오게) 값이 없는 중간 달도 0으로 채워서 쭉 이어지게 한다.
function computeMonthlyBreakdown(items, opts = {}) {
  const now = opts.now || new Date();
  const businessItems = items.filter((i) => i.status !== "개인구매");
  if (businessItems.length === 0) return [];

  const earliestCreated = businessItems.reduce((min, i) => {
    const d = new Date(i.createdAt);
    return d < min ? d : min;
  }, new Date(businessItems[0].createdAt));

  const months = [];
  let cursor = startOfMonth(earliestCreated);
  const lastMonth = startOfMonth(now);
  while (cursor <= lastMonth) {
    months.push(cursor);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return months
    .map((monthStart) => {
      const isCurrentMonth = monthStart.getTime() === lastMonth.getTime();
      const periodEnd = isCurrentMonth
        ? now
        : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);
      const { monthCogs, monthRevenue, monthProfit } = computeDashboard(items, {
        now: monthStart,
        periodEnd,
      });
      return {
        month: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`,
        monthCogs,
        monthRevenue,
        monthProfit,
      };
    })
    .reverse();
}

module.exports = {
  DUTY_RATE,
  VAT_RATE,
  INTL_SHIPPING_JPY,
  FEE_JPY,
  computeCostKrw,
  getTieredMarginRate,
  computeTieredSalePrice,
  parseItemHtml,
  extractMercariItemUrl,
  parseMercariPriceText,
  extractBuyFxRate,
  computeDashboard,
  computeMonthlyBreakdown,
};
