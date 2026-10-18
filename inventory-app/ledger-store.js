// 가계부(ledger/ledger.html)의 window.storage 저장소. 가계부 코드는 원래
// Claude.ai의 window.storage(get → {value}, 키가 없으면 throw / set(key, value))를
// 쓰도록 짜여 있어서, 같은 모양으로 앱 데이터 폴더의 JSON 파일에 저장해준다.
const fs = require("node:fs");
const path = require("node:path");

const DATA_KEYS = {
  transactions: "ledger:transactions",
  recentDesc: "ledger:recentDesc",
  categories: "ledger:categories",
  categoryKeywords: "ledger:categoryKeywords",
};
// 가계부는 이 키가 없으면 1~6월 예시 데이터를 넣는다 - 불러온 뒤엔 다시 넣지 않게 세팅한다.
const SEED_KEY = "ledger:seed_jan_jun_2026";

function readAll(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf-8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function writeAll(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function ledgerGet(filePath, key) {
  const data = readAll(filePath);
  if (!(key in data)) throw new Error(`not found: ${key}`);
  return { value: data[key] };
}

function ledgerSet(filePath, key, value) {
  const data = readAll(filePath);
  data[key] = String(value);
  writeAll(filePath, data);
}

function importLedgerBackup(filePath, backup) {
  if (!backup || backup.version !== 1 || !Array.isArray(backup.transactions)) {
    throw new Error("가계부 백업 파일 형식이 아니에요");
  }
  const data = readAll(filePath);
  for (const [field, key] of Object.entries(DATA_KEYS)) {
    data[key] = JSON.stringify(backup[field] ?? null);
  }
  data[SEED_KEY] = "1";
  writeAll(filePath, data);
  return { transactionCount: backup.transactions.length };
}

module.exports = { ledgerGet, ledgerSet, importLedgerBackup };
