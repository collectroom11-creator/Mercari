const test = require("node:test");
const assert = require("node:assert/strict");
const { detectBrand, computeBrandMix } = require("../brands");

test("detectBrand: 영어/일본어/한국어 표기와 라인 브랜드를 한 브랜드로 묶는다", () => {
  assert.equal(detectBrand("90s ARMANI JEANS Tシャツ"), "Armani");
  assert.equal(detectBrand("エンポリオアルマーニ レザーテーラードジャケット"), "Armani");
  assert.equal(detectBrand("엠포리오 아르마니 가죽 재킷"), "Armani");
  assert.equal(detectBrand("ドルチェアンドガッバーナ　メンズ　ローファー"), "Dolce&Gabbana");
  assert.equal(detectBrand("90s初期アーカイブHYSTERICGLAMOURダブルジップ"), "Hysteric Glamour");
  assert.equal(detectBrand("AZ エーゼイ ラム レザー ダブル ライダース"), "junhashimoto");
  assert.equal(detectBrand("【美品】 AZ by jun hashimoto ライダース"), "junhashimoto");
  assert.equal(detectBrand("トルネードマート ボタニカル×クロコダイル柄"), "TORNADO MART");
  assert.equal(detectBrand("名作）Lee型デニムジャケット　ラッドミュージシャン"), "LAD MUSICIAN");
  assert.equal(detectBrand("BOSS HUGO BOSS トレンチコート"), "HUGO BOSS");
  assert.equal(detectBrand("プラダスポーツ レザー スニーカー"), "PRADA");
  assert.equal(detectBrand("Martin Margiela 10 2012SS Tシャツ"), "Margiela");
});

test("detectBrand: 모르는 브랜드는 null", () => {
  assert.equal(detectBrand("Berlin Industries Patchwork Jacket"), null);
});

test("computeBrandMix: 지금 재고(판매완료·개인구매 제외)만, 많은 순, top개 넘으면 나머지와 모르는 브랜드는 '기타'", () => {
  const it = (title, costKrw, status = "판매중") => ({ title, costKrw, status });
  const items = [
    it("ARMANI JEANS", 10), it("EMPORIO ARMANI", 10, "배송전"), it("アルマーニ", 10, "업로드전"),
    it("PRADA", 50), it("PRADA SPORT", 50),
    it("GUCCI", 5),
    it("DIESEL", 5),
    it("Berlin Industries", 5),
    it("ARMANI", 999, "개인구매"),
    it("ARMANI", 999, "판매완료"),
  ];
  const byCount = computeBrandMix(items, { top: 2 });
  assert.equal(byCount.total, 8);
  assert.deepEqual(byCount.slices.map((s) => [s.name, s.value]), [["Armani", 3], ["PRADA", 2], ["기타", 3]]);
  const byCost = computeBrandMix(items, { top: 2, by: "cost" });
  assert.equal(byCost.total, 145);
  assert.deepEqual(byCost.slices.map((s) => [s.name, s.value, s.count]), [["PRADA", 100, 2], ["Armani", 30, 3], ["기타", 15, 3]]);
});
