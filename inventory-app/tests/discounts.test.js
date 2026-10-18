const test = require("node:test");
const assert = require("node:assert/strict");
const { computeDiscountAlerts, discountedPrice, DISCOUNT_STAGES } = require("../discounts");

const now = new Date(2026, 9, 18, 12);
const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();
const listed = (id, days, extra = {}) => ({
  id, title: `상품${id}`, status: "판매중", listedPrice: 330000, listPrice: 330000, listedAt: daysAgo(days), ...extra,
});

test("DISCOUNT_STAGES: 2/4/8/16주 → 5/10/15/20%", () => {
  assert.deepEqual(DISCOUNT_STAGES, [
    { days: 14, pct: 5 }, { days: 28, pct: 10 }, { days: 56, pct: 15 }, { days: 112, pct: 20 },
  ]);
});

test("35일 경과 → 10% 단계, newPrice 297000, weeks 5", () => {
  const [a] = computeDiscountAlerts([listed("a", 35)], {}, { now });
  assert.equal(a.id, "a");
  assert.equal(a.pct, 10);
  assert.equal(a.newPrice, 297000);
  assert.equal(a.weeks, 5);
  assert.equal(a.listPrice, 330000);
});

test("13일 경과 → 알림 없음", () => {
  assert.deepEqual(computeDiscountAlerts([listed("a", 13)], {}, { now }), []);
});

test("이미 그 단계 이상 할인됐으면 알림 없음", () => {
  assert.deepEqual(computeDiscountAlerts([listed("a", 35, { listPrice: 297000 })], {}, { now }), []);
});

test("X로 닫은 단계는 안 뜨고, 다음 단계가 되면 다시 뜬다", () => {
  assert.deepEqual(computeDiscountAlerts([listed("a", 35)], { a: 10 }, { now }), []);
  const [a] = computeDiscountAlerts([listed("a", 60)], { a: 10 }, { now });
  assert.equal(a.pct, 15);
});

test("판매완료/업로드전/listedPrice·listedAt 없음은 제외", () => {
  const list = [
    listed("s", 40, { status: "판매완료" }),
    listed("u", 40, { status: "업로드전" }),
    listed("p", 40, { listedPrice: null }),
    listed("t", 40, { listedAt: null }),
  ];
  assert.deepEqual(computeDiscountAlerts(list, {}, { now }), []);
});

test("오래된 상품이 먼저 온다", () => {
  const ids = computeDiscountAlerts([listed("a", 20), listed("b", 120)], {}, { now }).map((x) => x.id);
  assert.deepEqual(ids, ["b", "a"]);
});

test("discountedPrice(330000, 15) === 280500", () => {
  assert.equal(discountedPrice(330000, 15), 280500);
});
