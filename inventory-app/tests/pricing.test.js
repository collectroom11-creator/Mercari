const test = require("node:test");
const assert = require("node:assert/strict");
const { computeCostKrw, computeMinPrice } = require("../pricing");

test("computeCostKrw: 엔화가격에 환율과 관세율을 반영한다", () => {
  // 12000엔, 환율 950(100엔당), 관세율 23%
  // 12000 * 950 / 100 = 114000, * 1.23 = 140220
  assert.equal(computeCostKrw(12000, 950, 0.23), 140220);
});

test("computeCostKrw: 관세율 0이면 순수 환산가만 나온다", () => {
  assert.equal(computeCostKrw(10000, 900, 0), 90000);
});

test("computeMinPrice: 판매가 기준 마진율 40% 최소판매가", () => {
  // 원가 60000 -> 60000 / 0.6 = 100000
  assert.equal(computeMinPrice(60000, 0.4), 100000);
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

test("parseItemHtml: 금액이 없으면 jpyPrice는 null", () => {
  const result = parseItemHtml("<html><body><h1>제목만</h1></body></html>");
  assert.equal(result.title, "제목만");
  assert.equal(result.jpyPrice, null);
});

test("parseItemHtml: h1도 없으면 title은 null", () => {
  const result = parseItemHtml("<html><body>내용 없음</body></html>");
  assert.equal(result.title, null);
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

test("computeDashboard: 재고 총액과 상한선 대비 진행률", () => {
  const items = [
    item({ costKrw: 100000, status: "재고" }),
    item({ costKrw: 200000, status: "재고" }),
    item({ costKrw: 999999, status: "개인구매" }), // 제외되어야 함
  ];
  const now = new Date("2026-09-15T00:00:00.000Z");
  const result = computeDashboard(items, { capKrw: 300000, monthlyTargetKrw: 1000000, now });
  assert.equal(result.stockCostTotal, 300000);
  assert.equal(result.capProgressPct, 100);
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
  const result = computeDashboard(items, { capKrw: 3000000, monthlyTargetKrw: 1000000, now });
  // 월초재고 = 500000 + 300000 = 800000 (둘 다 9/1 시점엔 재고 상태였음)
  // 이번달매입 = 200000
  // 월말재고(지금) = 500000 + 200000 = 700000
  // 매출원가 = 800000 + 200000 - 700000 = 300000
  assert.equal(result.monthCogs, 300000);
  assert.equal(result.monthRevenue, 500000);
  assert.equal(result.monthProfit, 200000);
  assert.equal(result.targetProgressPct, 20);
});
