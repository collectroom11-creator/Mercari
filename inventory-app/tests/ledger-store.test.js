const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ledgerGet, ledgerSet, importLedgerBackup, exportLedgerBackup } = require("../ledger-store");

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ledger-")), "ledger.json");
}

const backup = {
  version: 1,
  exportedAt: "2026-10-18T13:47:00.067Z",
  transactions: [{ id: 9 }, { id: 10 }],
  recentDesc: { expense: ["켄즈포스트"], income: [] },
  categories: { expense: ["배송"], income: [] },
  categoryKeywords: { expense: {}, income: {} },
};

test("set 후 get은 같은 문자열을 돌려주고, 없는 키는 throw", () => {
  const f = tmpFile();
  assert.throws(() => ledgerGet(f, "ledger:transactions"));
  ledgerSet(f, "ledger:transactions", "[1,2]");
  assert.deepEqual(ledgerGet(f, "ledger:transactions"), { value: "[1,2]" });
});

test("예시 데이터가 시드된 상태에서 불러오면 4개 키가 교체되고 seed 키가 '1'", () => {
  const f = tmpFile();
  ledgerSet(f, "ledger:transactions", JSON.stringify([{ id: 1, desc: "예시" }]));
  const r = importLedgerBackup(f, backup);
  assert.equal(r.transactionCount, 2);
  assert.deepEqual(JSON.parse(ledgerGet(f, "ledger:transactions").value), [{ id: 9 }, { id: 10 }]);
  assert.deepEqual(JSON.parse(ledgerGet(f, "ledger:recentDesc").value), backup.recentDesc);
  assert.deepEqual(JSON.parse(ledgerGet(f, "ledger:categories").value), backup.categories);
  assert.deepEqual(JSON.parse(ledgerGet(f, "ledger:categoryKeywords").value), backup.categoryKeywords);
  assert.equal(ledgerGet(f, "ledger:seed_jan_jun_2026").value, "1");
});

test("형식이 다르면 throw하고 기존 데이터는 그대로", () => {
  const f = tmpFile();
  ledgerSet(f, "ledger:transactions", "[7]");
  assert.throws(() => importLedgerBackup(f, { ...backup, version: 2 }));
  assert.throws(() => importLedgerBackup(f, { ...backup, transactions: "x" }));
  assert.equal(ledgerGet(f, "ledger:transactions").value, "[7]");
});

test("exportLedgerBackup: 불러오기와 같은 형식으로 내보내고, 다시 불러오면 그대로", () => {
  const f = tmpFile();
  importLedgerBackup(f, backup);
  const out = exportLedgerBackup(f, new Date("2026-10-21T00:00:00Z"));
  assert.deepEqual(out, { ...backup, exportedAt: "2026-10-21T00:00:00.000Z" });
  const g = tmpFile();
  assert.equal(importLedgerBackup(g, out).transactionCount, 2);
});

test("exportLedgerBackup: 아직 기록이 없으면 빈 거래 목록", () => {
  const out = exportLedgerBackup(tmpFile());
  assert.equal(out.version, 1);
  assert.deepEqual(out.transactions, []);
});
