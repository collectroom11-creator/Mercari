const test = require("node:test");
const assert = require("node:assert");
const ps = require("../photo-sort");

test("planMoves orders front, back, tag, detail per product and leaves unknowns unsorted", () => {
  const photos = ["p1.jpg", "p2.jpg", "p3.jpg", "p4.jpg", "p5.jpg", "p6.jpg"];
  const result = {
    photos: [
      { file: "p1.jpg", productId: "A", kind: "detail" },
      { file: "p2.jpg", productId: "A", kind: "front" },
      { file: "p3.jpg", productId: "A", kind: "tag" },
      { file: "p4.jpg", productId: null, kind: "front" },
      { file: "p5.jpg", productId: "ZZZ", kind: "back" },
      { file: "p6.jpg", productId: "A", kind: "measure" },
      { file: "nope.jpg", productId: "A", kind: "front" },
    ],
  };
  const { moves, unsorted } = ps.planMoves(result, { validIds: ["A"], photos });
  assert.deepStrictEqual(moves.map((m) => m.file), ["p2.jpg", "p3.jpg", "p1.jpg", "p6.jpg"]);
  assert.deepStrictEqual(unsorted, ["p4.jpg", "p5.jpg"]);
});

test("cleanNames only keeps names for products without one, stripping slashes", () => {
  const r = { names: [{ productId: "A", name: " PRADA / 자켓 " }, { productId: "B", name: "X" }] };
  assert.deepStrictEqual(ps.cleanNames(r, ["A"]), [{ productId: "A", name: "PRADA 자켓" }]);
});

test("buildPrompt lists products and photos", () => {
  const text = ps.buildPrompt({
    products: [{ id: "A", mercariTitle: "プラダ", mercImage: "merc/A.jpg", knownImage: null, folder: null }],
    photos: ["p1.jpg"],
    nameExamples: ["PRADA SPORT 고어텍스 집업 자켓"],
  });
  assert.match(text, /productId A/);
  assert.match(text, /p1\.jpg/);
  assert.match(text, /제안 필요/);
});

test("cleanMaterials merges lines of the same part into one", () => {
  const r = { materials: [{ productId: "A", lines: ["· 겉감 면 97%", "겉감 폴리우레탄 3%", "안감 폴리에스터 100%"] }, { productId: "Z", lines: ["면 100%"] }] };
  assert.deepStrictEqual(ps.cleanMaterials(r, ["A"]), [{ productId: "A", lines: ["겉감 면 97% 폴리우레탄 3%", "안감 폴리에스터 100%"] }]);
  assert.deepStrictEqual(ps.cleanMaterials({ materials: [{ productId: "A", lines: ["면 97%", "폴리우레탄 3%"] }] }, ["A"])[0].lines, ["면 97%", "폴리우레탄 3%"]);
});
