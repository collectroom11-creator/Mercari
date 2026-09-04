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
