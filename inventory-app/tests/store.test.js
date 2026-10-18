const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { loadItems, addItem, updateItem, listItems, deleteItem } = require("../store");

function tempFile() {
  return path.join(os.tmpdir(), `inv-test-${Date.now()}-${Math.random()}.json`);
}

test("loadItems: 파일이 없으면 빈 배열", () => {
  const file = tempFile();
  assert.deepEqual(loadItems(file), []);
});

test("addItem: 항목을 추가하고 기본 status는 배송전", () => {
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
  assert.equal(item.status, "배송전");
  assert.ok(item.id);
  assert.ok(item.createdAt);
  assert.ok(item.statusChangedAt);
  assert.equal(loadItems(file).length, 1);
});

test("addItem: listPrice를 안 주면 비어있다 (목록에서 추천가를 플레이스홀더로 보여주기 위함)", () => {
  const file = tempFile();
  const item = addItem(file, {
    title: "테스트", sourceUrl: "u", jpyPrice: 1, fxRate: 1, dutyRate: 0, costKrw: 1000, targetPrice: 2000,
  });
  assert.equal(item.listPrice, null);
  assert.equal(item.listPriceEdited, false);
});

test("updateItem: listPrice만 따로 수정할 수 있다", () => {
  const file = tempFile();
  const item = addItem(file, {
    title: "테스트", sourceUrl: "u", jpyPrice: 1, fxRate: 1, dutyRate: 0, costKrw: 1000, targetPrice: 2000,
  });
  const updated = updateItem(file, item.id, { listPrice: 2500 });
  assert.equal(updated.listPrice, 2500);
  assert.equal(updated.targetPrice, 2000);
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

test("deleteItem: id로 항목을 지운다", () => {
  const file = tempFile();
  const a = addItem(file, { title: "A", sourceUrl: "u", jpyPrice: 1, fxRate: 1, dutyRate: 0, costKrw: 1, targetPrice: 1 });
  addItem(file, { title: "B", sourceUrl: "u", jpyPrice: 1, fxRate: 1, dutyRate: 0, costKrw: 1, targetPrice: 1 });
  const deleted = deleteItem(file, a.id);
  assert.equal(deleted, true);
  const remaining = loadItems(file);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].title, "B");
});

test("deleteItem: 없는 id면 false, 아무것도 안 지워짐", () => {
  const file = tempFile();
  addItem(file, { title: "A", sourceUrl: "u", jpyPrice: 1, fxRate: 1, dutyRate: 0, costKrw: 1, targetPrice: 1 });
  const deleted = deleteItem(file, "no-such-id");
  assert.equal(deleted, false);
  assert.equal(loadItems(file).length, 1);
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
