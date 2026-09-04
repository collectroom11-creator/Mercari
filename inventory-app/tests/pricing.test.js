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
