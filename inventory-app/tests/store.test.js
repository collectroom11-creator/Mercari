const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { loadItems, addItem, updateItem, listItems } = require("../store");

function tempFile() {
  return path.join(os.tmpdir(), `inv-test-${Date.now()}-${Math.random()}.json`);
}

test("loadItems: 파일이 없으면 빈 배열", () => {
  const file = tempFile();
  assert.deepEqual(loadItems(file), []);
});

test("addItem: 항목을 추가하고 기본 status는 재고", () => {
  const file = tempFile();
  const item = addItem(file, {
    title: "테스트 아이템",
    sourceUrl: "https://example.com",
    jpyPrice: 10000,
    fxRate: 950,
    dutyRate: 0.23,
    costKrw: 116850,
    targetPrice: 190000,
  });
  assert.equal(item.status, "재고");
  assert.ok(item.id);
  assert.ok(item.createdAt);
  assert.equal(loadItems(file).length, 1);
});

test("updateItem: 상태를 판매완료로 바꾸고 실제 판매가를 기록한다", () => {
  const file = tempFile();
  const item = addItem(file, {
    title: "테스트",
    sourceUrl: "u",
    jpyPrice: 1,
    fxRate: 1,
    dutyRate: 0,
    costKrw: 1000,
    targetPrice: 2000,
  });
  const updated = updateItem(file, item.id, {
    status: "판매완료",
    actualPrice: 2200,
    soldAt: "2026-09-10T00:00:00.000Z",
  });
  assert.equal(updated.status, "판매완료");
  assert.equal(updated.actualPrice, 2200);
});

test("updateItem: 없는 id면 null", () => {
  const file = tempFile();
  assert.equal(updateItem(file, "no-such-id", { status: "판매완료" }), null);
});

test("listItems: status로 필터링", () => {
  const file = tempFile();
  const a = addItem(file, { title: "A", sourceUrl: "u", jpyPrice: 1, fxRate: 1, dutyRate: 0, costKrw: 1, targetPrice: 1 });
  addItem(file, { title: "B", sourceUrl: "u", jpyPrice: 1, fxRate: 1, dutyRate: 0, costKrw: 1, targetPrice: 1 });
  updateItem(file, a.id, { status: "개인구매" });
  const personal = listItems(file, { status: "개인구매" });
  assert.equal(personal.length, 1);
  assert.equal(personal[0].title, "A");
});
