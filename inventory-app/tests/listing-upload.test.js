const test = require("node:test");
const assert = require("node:assert");
const lu = require("../listing-upload");

test("parsePrice reads the Price line", () => {
  assert.strictEqual(lu.parsePrice("x\n- Price : 180,000원\n- Size : M"), 180000);
  assert.strictEqual(lu.parsePrice("no price"), null);
});

test("photoOrder puts the platform thumbnail first and skips extras", () => {
  const photos = { thumbs: ["인스타 썸네일.jpg", "후루츠 썸네일.jpg".normalize("NFD")], numbered: ["1.jpg", "2.jpg"], others: ["실측.jpg"] };
  assert.deepStrictEqual(lu.photoOrder(photos, "fruits"), ["후루츠 썸네일.jpg".normalize("NFD"), "1.jpg", "2.jpg"]);
  assert.deepStrictEqual(lu.photoOrder(photos, "insta"), ["인스타 썸네일.jpg", "1.jpg", "2.jpg"]);
  assert.deepStrictEqual(lu.photoOrder({ thumbs: [], numbered: ["1.jpg"], others: [] }, "insta"), ["1.jpg"]);
});

test("batchPrompt numbers tasks, includes only needed platform rules and the one-window rule", () => {
  const p = lu.batchPrompt([
    { platform: "fruits", productName: "A", text: "A M\n\n- Price : 1원", photoPaths: ["/x/01.jpg"] },
    { platform: "fruits", productName: "B", text: "B L", photoPaths: ["/y/01.jpg"] },
  ]);
  assert.match(p, /작업 1: 후루츠 · A/);
  assert.match(p, /작업 2: 후루츠 · B/);
  assert.match(p, /후루츠 작업 규칙/);
  assert.doesNotMatch(p, /인스타 작업 규칙/);
  assert.match(p, /tabs_close_mcp/);
});

test("withPrice swaps the Price line only when it differs", () => {
  const t = "x\n- Price : 80,000원\n- Size : S";
  assert.strictEqual(lu.withPrice(t, 100000), "x\n- Price : 100,000원\n- Size : S");
  assert.strictEqual(lu.withPrice(t, 80000), t);
  assert.strictEqual(lu.withPrice("no price", 100000), "no price");
  assert.strictEqual(lu.withPrice(t, null), t);
});
