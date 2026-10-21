const test = require("node:test");
const assert = require("node:assert/strict");
const { computeShopStats, computeMonthlySales } = require("../stats");

const now = new Date(2026, 9, 18, 12);
const sold = (cost, actual, soldAt) => ({ status: "판매완료", costKrw: cost, actualPrice: actual, soldAt: soldAt.toISOString() });
const items = [
  sold(145898, 225000, new Date(2026, 9, 5)),
  sold(70120, 102000, new Date(2026, 9, 9)),
  sold(139527, 257000, new Date(2026, 9, 16)),
  sold(100000, 150000, new Date(2026, 8, 20)),
  { status: "판매중", costKrw: 50000 },
  { status: "판매중", costKrw: 60000 },
  { status: "업로드전", costKrw: 999999 },
  { status: "개인구매", costKrw: 88888, actualPrice: 1, soldAt: new Date(2026, 9, 1).toISOString() },
  { status: "판매완료", costKrw: 77777, actualPrice: null, soldAt: new Date(2026, 9, 2).toISOString() },
];

test("computeShopStats: 10월 매출/순이익/회전율/판매중 원가", () => {
  const s = computeShopStats(items, { now });
  assert.equal(s.monthRevenue, 584000);
  assert.equal(s.monthProfit, 584000 - 355545);
  assert.equal(s.listedCost, 110000);
  assert.equal(s.turnoverPct, Math.round((355545 / (355545 + 110000)) * 100));
});

test("computeShopStats: 이번 달 판매 건수 (actualPrice 없는 건 제외)", () => {
  assert.equal(computeShopStats(items, { now }).monthSoldCount, 3);
});

test("computeShopStats: 재고원가 합 = 안 팔린 상품(배송전/업로드전/판매중) 원가, 개인구매 제외", () => {
  const list = [
    ...items,
    { status: "배송전", costKrw: 30000 },
    { status: "개인구매", costKrw: 12345 },
  ];
  assert.equal(computeShopStats(list, { now }).stockCost, 50000 + 60000 + 999999 + 30000);
});

test("computeMonthlySales: 첫 판매월부터 이번 달까지 오래된 순", () => {
  assert.deepEqual(computeMonthlySales(items, { now }), [
    { month: "2026-09", revenue: 150000, profit: 50000 },
    { month: "2026-10", revenue: 584000, profit: 228455 },
  ]);
});

test("computeMonthlySales: 중간에 판매 없는 달은 0으로 채운다", () => {
  const list = [sold(1000, 2000, new Date(2026, 7, 3)), sold(1000, 3000, new Date(2026, 9, 3))];
  assert.deepEqual(computeMonthlySales(list, { now }).map((m) => [m.month, m.revenue]), [
    ["2026-08", 2000],
    ["2026-09", 0],
    ["2026-10", 3000],
  ]);
});

test("computeMonthlySales: lastMonths 6이면 이번 달까지 최근 6개월만, 판매 없는 달은 0", () => {
  const list = [sold(1000, 2000, new Date(2026, 0, 3)), sold(1000, 3000, new Date(2026, 9, 3))];
  assert.deepEqual(computeMonthlySales(list, { now, lastMonths: 6 }).map((m) => [m.month, m.revenue]), [
    ["2026-05", 0],
    ["2026-06", 0],
    ["2026-07", 0],
    ["2026-08", 0],
    ["2026-09", 0],
    ["2026-10", 3000],
  ]);
});

test("computeMonthlySales: lastMonths 6이면 판매 기록이 없어도 6개월을 0으로 채운다", () => {
  assert.equal(computeMonthlySales([], { now, lastMonths: 6 }).length, 6);
});

test("판매 기록이 없으면 회전율 0, 월별은 빈 배열", () => {
  const list = [{ status: "판매중", costKrw: 5000 }];
  assert.equal(computeShopStats(list, { now }).turnoverPct, 0);
  assert.deepEqual(computeMonthlySales(list, { now }), []);
});

test("computeShopStats: 전체 평균 마진율 = 상품별 마진율 평균 (판매완료는 실판매가, 나머지는 판매가), 개인구매·가격 없는 상품 제외", () => {
  const list = [
    { status: "판매완료", costKrw: 50, actualPrice: 100, soldAt: new Date(2026, 9, 1).toISOString() }, // 50%
    { status: "판매중", costKrw: 75, listPrice: 100, targetPrice: 999 }, // 25% (listPrice 우선)
    { status: "배송전", costKrw: 90, targetPrice: 100 }, // 10% (listPrice 없으면 targetPrice)
    { status: "업로드전", costKrw: 10 }, // 가격 없음 → 제외
    { status: "개인구매", costKrw: 1, actualPrice: 100 }, // 제외
  ];
  const s = computeShopStats(list, { now });
  assert.equal(s.avgMarginPct, Math.round((50 + 25 + 10) / 3));
  assert.equal(s.soldAvgMarginPct, 50);
  assert.equal(s.stockAvgMarginPct, Math.round((25 + 10) / 2));
});

test("computeShopStats: 마진을 계산할 상품이 없으면 평균 마진율은 null", () => {
  const s = computeShopStats([{ status: "업로드전", costKrw: 10 }], { now });
  assert.equal(s.avgMarginPct, null);
  assert.equal(s.soldAvgMarginPct, null);
});

test("computeShopStats: 재고 단계별 원가와 개수 (재고 상태는 판매중으로)", () => {
  const list = [
    { status: "배송전", costKrw: 100 }, { status: "배송전", costKrw: 50 },
    { status: "업로드전", costKrw: 30 },
    { status: "판매중", costKrw: 20 }, { status: "재고", costKrw: 5 },
    { status: "판매완료", costKrw: 999, actualPrice: 1, soldAt: new Date(2026, 9, 1).toISOString() },
  ];
  assert.deepEqual(computeShopStats(list, { now }).stockByStatus, [
    { status: "배송전", count: 2, cost: 150 },
    { status: "업로드전", count: 1, cost: 30 },
    { status: "판매중", count: 2, cost: 25 },
  ]);
});
