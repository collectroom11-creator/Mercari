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

test("computeBrandMix: 개인구매 제외, 개수 많은 순, top개 넘으면 나머지와 모르는 브랜드는 '기타'", () => {
  const it = (title, status = "판매중") => ({ title, status });
  const items = [
    it("ARMANI JEANS"), it("EMPORIO ARMANI", "판매완료"), it("アルマーニ"),
    it("PRADA"), it("PRADA SPORT"),
    it("GUCCI"),
    it("DIESEL"),
    it("Berlin Industries"),
    it("ARMANI", "개인구매"),
  ];
  const mix = computeBrandMix(items, { top: 2 });
  assert.equal(mix.total, 8);
  assert.deepEqual(mix.slices.map((s) => [s.name, s.count]), [["Armani", 3], ["PRADA", 2], ["기타", 3]]);
});
