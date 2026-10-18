const test = require("node:test");
const assert = require("node:assert/strict");
const { computeCostKrw, getTieredMarginRate, computeTieredSalePrice } = require("../pricing");

test("computeCostKrw: 상품가+배송비 합산 통관가액에 환율/관세/부가세를 순서대로 반영한다", () => {
  // 상품 12000엔 + 현지배송 800엔 + 국제배송 1000엔 = 통관가액 13800엔
  // 환율 950(100엔당): 13800 * 950 / 100 = 131100
  // 관세 13%: 131100 * 1.13 = 148143
  // 부가세 10%(관세 포함 금액에 부과): 148143 * 1.10 = 162957.3 -> 162957
  assert.equal(
    computeCostKrw({
      jpyPrice: 12000,
      fxRate: 950,
      dutyRate: 0.13,
      vatRate: 0.10,
      localShippingJpy: 800,
      intlShippingJpy: 1000,
    }),
    162957
  );
});

test("computeCostKrw: 배송비/관세율/부가세율이 0이면 순수 환산가만 나온다", () => {
  assert.equal(
    computeCostKrw({ jpyPrice: 10000, fxRate: 900, dutyRate: 0, vatRate: 0 }),
    90000
  );
});

test("computeCostKrw: 켄즈포스트 수수료도 배송비처럼 통관가액에 합산돼 관세/부가세가 붙는다", () => {
  // 상품 8000엔 + 수수료 300엔 + 국제배송 500엔 = 통관가액 8800엔
  // 환율 907(100엔당): 8800 * 907 / 100 = 79816
  // 관세 13%: 79816 * 1.13 = 90192.08
  // 부가세 10%: 90192.08 * 1.10 = 99211.288 -> 99211
  assert.equal(
    computeCostKrw({
      jpyPrice: 8000,
      fxRate: 907,
      dutyRate: 0.13,
      vatRate: 0.10,
      feeJpy: 300,
      intlShippingJpy: 500,
    }),
    99211
  );
});

test("computeCostKrw: feeJpy를 안 주면 0으로 취급해 이전과 동일하게 계산한다", () => {
  assert.equal(
    computeCostKrw({
      jpyPrice: 12000,
      fxRate: 950,
      dutyRate: 0.13,
      vatRate: 0.10,
      localShippingJpy: 800,
      intlShippingJpy: 1000,
    }),
    162957
  );
});

test("getTieredMarginRate: 엔화 제품가 구간별 마진율", () => {
  assert.equal(getTieredMarginRate(4999), 0.6); // 5천엔 미만
  assert.equal(getTieredMarginRate(5000), 0.5); // 5천~1만엔
  assert.equal(getTieredMarginRate(9999), 0.5);
  assert.equal(getTieredMarginRate(10000), 0.4); // 1만엔 이상
  assert.equal(getTieredMarginRate(20000), 0.4);
});

test("computeTieredSalePrice: 제품가 5천엔 미만이면 60% 마진율", () => {
  // 60000 / 0.4 = 150000
  assert.deepEqual(computeTieredSalePrice(60000, 3000), { rate: 0.6, price: 150000 });
});

test("computeTieredSalePrice: 제품가 5천~1만엔이면 50% 마진율", () => {
  // 100000 / 0.5 = 200000
  assert.deepEqual(computeTieredSalePrice(100000, 7000), { rate: 0.5, price: 200000 });
});

test("computeTieredSalePrice: 제품가 1만엔 이상이면 40% 마진율", () => {
  // 200000 / 0.6 = 333333.33 -> 333333
  assert.deepEqual(computeTieredSalePrice(200000, 15000), { rate: 0.4, price: 333333 });
});

const { parseItemHtml } = require("../pricing");

test("parseItemHtml: h1과 엔화 금액을 추출한다", () => {
  const html = `
    <html><body>
      <h1>Maison Margiela 10 데님 팬츠</h1>
      <div>가격: 12,000円</div>
      <div>수수료: 1,000円</div>
    </body></html>
  `;
  const result = parseItemHtml(html);
  assert.equal(result.title, "Maison Margiela 10 데님 팬츠");
  assert.equal(result.jpyPrice, 12000);
});

test("parseItemHtml: 입찰대행 페이지(mercari/bid.s)는 box-bid-price 구조의 실제 구매가를 쓴다 (실제 페이지 마크업 기준 - 상품 설명 속 '1만원 이상 할인' 문구의 더 큰 숫자에 낚이면 안 됨)", () => {
  const html = `
    <html><body>
      ☆フォローで割引☆<br>
      5,000円以上で300円OFF<br>
      10,000円以上で600円OFF<br>
      15,000円以上で5%OFF<br>
      20,000円以上で7%OFF<br>
      <div class="box-bid-price">
        <table class="table bid-price-tbl"><tbody><tr>
          <th><span class="item">금액</span></th>
          <td class="price">6,170円 <span>(약 55,284)</span></td>
        </tr></tbody></table>
      </div>
    </body></html>
  `;
  const result = parseItemHtml(html);
  assert.equal(result.jpyPrice, 6170);
});

test("parseItemHtml: og:image가 있으면 상품 사진 URL로 쓴다 (사이트 로고 og-image는 건너뜀)", () => {
  const html = `
    <html><head>
      <meta property="og:image" content="https://kenzpost.com/skin/default/images/og-image.png">
      <meta property="og:image" content="https://static.mercdn.net/item/detail/photo123.jpg">
    </head><body><h1>제목</h1></body></html>
  `;
  const result = parseItemHtml(html);
  assert.equal(result.imageUrl, "https://static.mercdn.net/item/detail/photo123.jpg");
});

test("parseItemHtml: og:image가 없으면 첫 img src를 쓴다", () => {
  const html = `<html><body><h1>제목</h1><img src="https://static.mercdn.net/item/detail/photo456.jpg"></body></html>`;
  const result = parseItemHtml(html);
  assert.equal(result.imageUrl, "https://static.mercdn.net/item/detail/photo456.jpg");
});

test("parseItemHtml: 금액이 없으면 jpyPrice는 null", () => {
  const result = parseItemHtml("<html><body><h1>제목만</h1></body></html>");
  assert.equal(result.title, "제목만");
  assert.equal(result.jpyPrice, null);
});

test("parseItemHtml: h1도 없으면 title은 null", () => {
  const result = parseItemHtml("<html><body>내용 없음</body></html>");
  assert.equal(result.title, null);
});

test("parseItemHtml: h1이 없으면 og:title로 대체한다", () => {
  const html = `<html><head><meta property="og:title" content="Helmut Lang 로고 티셔츠"></head><body>내용 없음</body></html>`;
  const result = parseItemHtml(html);
  assert.equal(result.title, "Helmut Lang 로고 티셔츠");
});

test("parseItemHtml: h1/og:title 둘 다 없으면 <title> 태그로 대체한다", () => {
  const html = `<html><head><title>Comme des Garcons 셔츠 - 켄즈포스트</title></head><body>내용 없음</body></html>`;
  const result = parseItemHtml(html);
  assert.equal(result.title, "Comme des Garcons 셔츠 - 켄즈포스트");
});

test("parseItemHtml: 제목에 HTML 엔티티가 있으면 디코딩한다", () => {
  const html = `<html><body><h1>Levi&#39;s &amp; Co Jeans</h1></body></html>`;
  const result = parseItemHtml(html);
  assert.equal(result.title, "Levi's & Co Jeans");
});

const { extractBuyFxRate } = require("../pricing");

test("extractBuyFxRate: 켄즈포스트 환율안내 표에서 '살 때' 값을 읽는다 (실제 페이지 마크업 기준)", () => {
  const html = `<section class="cs-exchange"><h3 class="tit">환율안내 <small>(일본 JPY 100엔)</small></h3><table class="amount"><colgroup><col width="26.4%"><col width="36.3%"><col width="36.3%"></colgroup><tbody><tr><td rowspan="2">적용환율</td><td class="exchange-title">살 때</td><td class="exchange-title">팔 때</td></tr><tr><td>901</td><td>884</td></tr></tbody></table></section>`;
  assert.equal(extractBuyFxRate(html), 901);
});

test("extractBuyFxRate: 표가 없으면 null", () => {
  assert.equal(extractBuyFxRate("<html><body>내용 없음</body></html>"), null);
});

const { computeDashboard } = require("../pricing");

function item(overrides) {
  return {
    id: Math.random().toString(),
    title: "x",
    costKrw: 0,
    actualPrice: null,
    status: "재고",
    createdAt: "2026-08-01T00:00:00.000Z",
    soldAt: null,
    ...overrides,
  };
}

test("computeDashboard: periodEnd를 주면 이미 끝난 달(예: 지난달) 기준으로 계산한다", () => {
  const items = [
    // 7월에 사서 지금도 재고: 8월초재고, 8월말재고 둘 다 포함
    item({ costKrw: 500000, status: "재고", createdAt: "2026-07-10T00:00:00.000Z" }),
    // 7월에 사서 8월 5일에 팔림: 8월초재고엔 포함, 8월말재고엔 미포함(그 전에 팔림)
    item({ costKrw: 300000, status: "판매완료", createdAt: "2026-07-20T00:00:00.000Z", soldAt: "2026-08-05T00:00:00.000Z", actualPrice: 500000 }),
    // 8월에 사서 지금도 재고: 8월매입에 포함, 8월말재고에도 포함
    item({ costKrw: 200000, status: "재고", createdAt: "2026-08-10T00:00:00.000Z" }),
    // 9월(조회 대상인 8월 이후)에 사서 지금도 재고 - "현재 재고"에는 잡히지만
    // 8월 조회에는 전혀 안 잡혀야 한다(이게 이 테스트의 핵심).
    item({ costKrw: 999999, status: "재고", createdAt: "2026-09-02T00:00:00.000Z" }),
  ];
  const augStart = new Date("2026-08-01T00:00:00.000Z");
  const augEnd = new Date("2026-08-31T23:59:59.999Z");
  const result = computeDashboard(items, { now: augStart, periodEnd: augEnd });
  assert.equal(result.monthCogs, 300000); // 800000(월초) + 200000(매입) - 700000(월말)
  assert.equal(result.monthRevenue, 500000);
  assert.equal(result.monthProfit, 200000);
  // "현재 재고"는 조회 기간과 무관하게 항상 지금 시점 기준 - 9월에 산 것도 포함된다.
  assert.equal(result.stockCostTotal, 500000 + 200000 + 999999);
});

test("computeDashboard: 재고 총액 (개인구매는 제외)", () => {
  const items = [
    item({ costKrw: 100000, status: "재고" }),
    item({ costKrw: 200000, status: "재고" }),
    item({ costKrw: 999999, status: "개인구매" }), // 제외되어야 함
  ];
  const now = new Date("2026-09-15T00:00:00.000Z");
  const result = computeDashboard(items, { now });
  assert.equal(result.stockCostTotal, 300000);
});

test("computeDashboard: 이번달 매출원가 = 월초재고 + 이번달매입 - 월말재고", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");
  const items = [
    // 8월에 사서 아직도 재고(월초에도 재고, 지금도 재고): 월초재고에 포함, 월말재고에도 포함
    item({ costKrw: 500000, status: "재고", createdAt: "2026-08-10T00:00:00.000Z" }),
    // 8월에 사서 9월 5일에 팔림: 월초재고엔 포함(8/1 시점엔 재고였음), 월말재고엔 미포함, 이번달매입 아님
    item({ costKrw: 300000, status: "판매완료", createdAt: "2026-08-20T00:00:00.000Z", soldAt: "2026-09-05T00:00:00.000Z", actualPrice: 500000 }),
    // 9월에 사서 아직 재고: 이번달매입에 포함, 월말재고에도 포함
    item({ costKrw: 200000, status: "재고", createdAt: "2026-09-02T00:00:00.000Z" }),
  ];
  const result = computeDashboard(items, { now });
  // 월초재고 = 500000 + 300000 = 800000 (둘 다 9/1 시점엔 재고 상태였음)
  // 이번달매입 = 200000
  // 월말재고(지금) = 500000 + 200000 = 700000
  // 매출원가 = 800000 + 200000 - 700000 = 300000
  assert.equal(result.monthCogs, 300000);
  assert.equal(result.monthRevenue, 500000);
  assert.equal(result.monthProfit, 200000);
  // 회전율 = 매출원가(300000) / 현재재고(500000+200000=700000) = 42.86% -> 반올림 43%
  assert.equal(result.turnoverPct, 43);
});

test("computeDashboard: 재고가 하나도 없으면 회전율은 0", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");
  const result = computeDashboard([], { now });
  assert.equal(result.turnoverPct, 0);
});

test("computeDashboard: 개인구매 항목은 monthCogs/monthRevenue 계산에서도 제외된다", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");
  const baseItems = [
    item({ costKrw: 500000, status: "재고", createdAt: "2026-08-10T00:00:00.000Z" }),
    item({ costKrw: 300000, status: "판매완료", createdAt: "2026-08-20T00:00:00.000Z", soldAt: "2026-09-05T00:00:00.000Z", actualPrice: 500000 }),
    item({ costKrw: 200000, status: "재고", createdAt: "2026-09-02T00:00:00.000Z" }),
  ];
  // 개인구매 항목: 이번 달에 팔린 것처럼 보이는 큰 금액을 갖고 있지만 monthCogs/monthRevenue 어디에도 새면 안 됨
  const personalPurchase = item({
    costKrw: 999999999,
    status: "개인구매",
    createdAt: "2026-09-03T00:00:00.000Z",
    soldAt: "2026-09-10T00:00:00.000Z",
    actualPrice: 999999999,
  });

  const withoutPersonal = computeDashboard(baseItems, { now });
  const withPersonal = computeDashboard([...baseItems, personalPurchase], { now });

  assert.equal(withPersonal.monthCogs, withoutPersonal.monthCogs);
  assert.equal(withPersonal.monthRevenue, withoutPersonal.monthRevenue);
  assert.equal(withPersonal.monthCogs, 300000);
  assert.equal(withPersonal.monthRevenue, 500000);
});

test("computeDashboard: 배송전/업로드전/판매중은 전부 재고로 잡힌다", () => {
  const items = [
    item({ costKrw: 100000, status: "배송전" }),
    item({ costKrw: 200000, status: "업로드전" }),
    item({ costKrw: 300000, status: "판매중" }),
  ];
  const now = new Date("2026-09-15T00:00:00.000Z");
  const result = computeDashboard(items, { now });
  assert.equal(result.stockCostTotal, 600000);
});

test("computeDashboard: 지난달에 사서 지난달에 판 물건은 이번달 계산에 안 들어간다", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");
  const items = [
    item({
      costKrw: 400000,
      status: "판매완료",
      createdAt: "2026-07-10T00:00:00.000Z",
      soldAt: "2026-07-20T00:00:00.000Z",
      actualPrice: 600000,
    }),
  ];
  const result = computeDashboard(items, { now });
  assert.equal(result.monthCogs, 0);
  assert.equal(result.monthRevenue, 0);
  assert.equal(result.monthProfit, 0);
});

const { computeMonthlyBreakdown } = require("../pricing");

test("computeMonthlyBreakdown: 항목이 없으면 빈 배열", () => {
  assert.deepEqual(computeMonthlyBreakdown([]), []);
});

test("computeMonthlyBreakdown: 첫 매입월부터 이번달까지 달마다 정리하고, 최신 달이 맨 앞에 온다", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");
  const items = [
    // 7월에 사서 7월에 팔림
    item({
      costKrw: 300000,
      status: "판매완료",
      createdAt: "2026-07-05T00:00:00.000Z",
      soldAt: "2026-07-25T00:00:00.000Z",
      actualPrice: 500000,
    }),
    // 8월에 사서 아직 재고(9월까지도 안 팔림)
    item({ costKrw: 100000, status: "재고", createdAt: "2026-08-10T00:00:00.000Z" }),
  ];
  const result = computeMonthlyBreakdown(items, { now });
  assert.deepEqual(
    result.map((m) => m.month),
    ["2026-09", "2026-08", "2026-07"]
  );
  const july = result.find((m) => m.month === "2026-07");
  assert.equal(july.monthCogs, 300000);
  assert.equal(july.monthRevenue, 500000);
  assert.equal(july.monthProfit, 200000);
  const august = result.find((m) => m.month === "2026-08");
  assert.equal(august.monthCogs, 0);
  assert.equal(august.monthRevenue, 0);
  const september = result.find((m) => m.month === "2026-09");
  assert.equal(september.monthCogs, 0);
  assert.equal(september.monthRevenue, 0);
});

const { extractMercariItemUrl, parseMercariPriceText } = require("../pricing");

test("extractMercariItemUrl: 켄즈포스트 대행 링크에서 메루카리 상품 주소를 꺼낸다", () => {
  assert.equal(
    extractMercariItemUrl("https://kenzpost.com/mercari/bid.s/https://jp.mercari.com/item/m85016106063"),
    "https://jp.mercari.com/item/m85016106063"
  );
  assert.equal(
    extractMercariItemUrl("https://kenzpost.com/mercari/bid.s/https://jp.mercari.com/shops/product/2JY8zPhymbmYCVezUjFaxq"),
    "https://jp.mercari.com/shops/product/2JY8zPhymbmYCVezUjFaxq"
  );
  assert.equal(extractMercariItemUrl("https://kenzpost.com/yahoo/auction/x123"), null);
});

test("parseMercariPriceText: 원화 환산이 같이 보여도 ¥ 뒤의 엔화 가격을 읽는다", () => {
  assert.equal(parseMercariPriceText("KRW\n\n69,077\n\n(\n\n¥\n\n7,650\n\n為替レート"), 7650);
  assert.equal(parseMercariPriceText("¥13,500"), 13500);
  assert.equal(parseMercariPriceText("価格なし"), null);
});
