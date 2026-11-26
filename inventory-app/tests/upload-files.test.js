const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const uf = require("../upload-files");

const SAMPLE = `ARMANI 자켓 XL

※ 소매 하자
※ 어깨 패드 있음

- Price : 180,000원
- Size : XL (어깨 53.5 / 총장 80.5)

@collectroom_
`;

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "uf-"));
}
function touch(dir, ...names) {
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(dir, n), n);
}

test("parseListing reads size line, ※ defect lines and · material lines", () => {
  assert.deepStrictEqual(uf.parseListing(SAMPLE), {
    size: "XL (어깨 53.5 / 총장 80.5)",
    defects: ["소매 하자", "어깨 패드 있음"],
    materials: [],
  });
  assert.deepStrictEqual(uf.parseListing("A\n\n· 면 97%\n· 폴리우레탄 3%\n").materials, ["면 97%", "폴리우레탄 3%"]);
});

test("applyListingEdits inserts materials before defects and replaces them later", () => {
  const withMat = uf.applyListingEdits(SAMPLE, { materials: ["면 100%"] });
  assert.match(withMat, /XL\n\n· 면 100%\n\n※ 소매 하자/);
  const changed = uf.applyListingEdits(withMat, { materials: ["겉감 면 97% 폴리우레탄 3%", "안감 폴리에스터 100%"] });
  assert.match(changed, /XL\n\n· 겉감 면 97% 폴리우레탄 3%\n· 안감 폴리에스터 100%\n\n※ 소매 하자/);
  assert.strictEqual(uf.applyListingEdits(changed, { materials: [] }), SAMPLE);
});

test("buildListing makes the user's template (no body line for shoes)", () => {
  const t = uf.buildListing({ productName: "PRADA 자켓", size: "M (어깨 46 / 총장 68)", materials: ["면 100%"], defects: ["오염"], price: 180000 });
  assert.strictEqual(t, "PRADA 자켓 M\n\n· 면 100%\n\n※ 오염\n\n- Price : 180,000원\n- Size : M (어깨 46 / 총장 68)\n\n178cm / 63kg\n\n최선을 다해 검수하고 있습니다.\n가품 확인시 100% 환불 도와드리겠습니다.\n\n@collectroom_\n");
  assert.doesNotMatch(uf.buildListing({ productName: "X 부츠", size: "40", price: 1, isShoes: true }), /178cm/);
  assert.deepStrictEqual(uf.parseListing(t), { size: "M (어깨 46 / 총장 68)", defects: ["오염"], materials: ["면 100%"] });
});

test("applyListingEdits replaces size and defect block only", () => {
  const out = uf.applyListingEdits(SAMPLE, { size: "L (총장 70)", defects: ["단추 없음"] });
  assert.match(out, /- Size : L \(총장 70\)/);
  assert.match(out, /\n\n※ 단추 없음\n\n- Price/);
  assert.doesNotMatch(out, /소매 하자/);
});

test("applyListingEdits removes defect block cleanly and adds one when missing", () => {
  const none = uf.applyListingEdits(SAMPLE, { defects: [] });
  assert.match(none, /XL\n\n- Price/);
  const added = uf.applyListingEdits(none, { defects: ["오염"] });
  assert.match(added, /XL\n\n※ 오염\n\n- Price/);
});

test("listPhotos splits thumbnails, numbered (numeric order) and others", () => {
  const dir = path.join(tmpRoot(), "p");
  touch(dir, "10.jpg", "2.jpg", "1.jpg", "인스타 썸네일.jpg", "후루츠 썸네일.jpg", "x.png", "a.txt");
  assert.deepStrictEqual(uf.listPhotos(dir), {
    thumbs: ["인스타 썸네일.jpg", "후루츠 썸네일.jpg"],
    numbered: ["1.jpg", "2.jpg", "10.jpg"],
    others: ["x.png"],
  });
});

test("reorderPhotos renumbers in the given order", () => {
  const dir = path.join(tmpRoot(), "p");
  touch(dir, "1.jpg", "2.jpg", "3.jpg");
  uf.reorderPhotos(dir, ["3.jpg", "1.jpg", "2.jpg"]);
  assert.strictEqual(fs.readFileSync(path.join(dir, "1.jpg"), "utf-8"), "3.jpg");
  assert.strictEqual(fs.readFileSync(path.join(dir, "2.jpg"), "utf-8"), "1.jpg");
  assert.strictEqual(fs.readFileSync(path.join(dir, "3.jpg"), "utf-8"), "2.jpg");
});

test("movePhoto appends to target and compacts source numbers", () => {
  const root = tmpRoot();
  const a = path.join(root, "A");
  const b = path.join(root, "B");
  touch(a, "1.jpg", "2.jpg", "3.jpg");
  touch(b, "1.jpg");
  assert.strictEqual(uf.movePhoto(a, "2.jpg", b), "2.jpg");
  assert.strictEqual(fs.readFileSync(path.join(b, "2.jpg"), "utf-8"), "2.jpg");
  assert.deepStrictEqual(uf.listPhotos(a).numbered, ["1.jpg", "2.jpg"]);
  assert.strictEqual(fs.readFileSync(path.join(a, "2.jpg"), "utf-8"), "3.jpg");
});

test("addPhotos copies as next numbers and skips non-images", () => {
  const root = tmpRoot();
  const src = path.join(root, "src");
  touch(src, "IMG_1.JPEG", "note.txt");
  const dir = path.join(root, "P");
  touch(dir, "1.jpg");
  assert.deepStrictEqual(uf.addPhotos(dir, [path.join(src, "IMG_1.JPEG"), path.join(src, "note.txt")]), ["2.jpg"]);
  assert.ok(fs.existsSync(path.join(src, "IMG_1.JPEG")));
});

test("renameProduct renames folder, txt and first line", () => {
  const root = tmpRoot();
  const dir = path.join(root, "ARMANI 자켓");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "ARMANI 자켓.txt"), SAMPLE);
  uf.renameProduct(root, "ARMANI 자켓", "GIORGIO ARMANI 자켓");
  const txt = fs.readFileSync(path.join(root, "GIORGIO ARMANI 자켓", "GIORGIO ARMANI 자켓.txt"), "utf-8");
  assert.ok(txt.startsWith("GIORGIO ARMANI 자켓 XL\n"));
  assert.throws(() => {
    fs.mkdirSync(path.join(root, "X"));
    uf.renameProduct(root, "X", "GIORGIO ARMANI 자켓");
  });
});

test("finishProduct moves folder without overwriting", () => {
  const root = tmpRoot();
  const done = path.join(root, "done");
  touch(path.join(root, "up", "P"), "1.jpg");
  touch(path.join(done, "P"), "old.jpg");
  const to = uf.finishProduct(path.join(root, "up"), done, "P");
  assert.strictEqual(path.basename(to), "P 2");
  assert.ok(fs.existsSync(path.join(done, "P", "old.jpg")));
});

test("listPhotos finds thumbnails even with NFD (decomposed) Korean names", () => {
  const dir = path.join(tmpRoot(), "p");
  touch(dir, "인스타 썸네일.jpg".normalize("NFD"), "1.jpg");
  assert.strictEqual(uf.listPhotos(dir).thumbs.length, 1);
});

test("placePhoto moves numbered kinds to next number and extras by name", () => {
  const root = tmpRoot();
  const stage = path.join(root, "stage");
  touch(stage, "a.JPG", "b.jpg", "c.jpg");
  const dir = path.join(root, "P");
  touch(dir, "1.jpg");
  assert.strictEqual(uf.placePhoto(dir, path.join(stage, "a.JPG")), "2.jpg");
  assert.strictEqual(uf.placePhoto(dir, path.join(stage, "b.jpg"), "실측"), "실측.jpg");
  assert.strictEqual(uf.placePhoto(dir, path.join(stage, "c.jpg"), "실측"), "실측 2.jpg");
  assert.ok(!fs.existsSync(path.join(stage, "a.JPG")));
});
