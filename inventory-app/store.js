const fs = require("node:fs");

function loadItems(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) return [];
  return JSON.parse(raw);
}

function saveItems(filePath, items) {
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
}

function addItem(filePath, data) {
  const items = loadItems(filePath);
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: data.title,
    sourceUrl: data.sourceUrl,
    jpyPrice: data.jpyPrice,
    fxRate: data.fxRate,
    dutyRate: data.dutyRate,
    costKrw: data.costKrw,
    targetPrice: data.targetPrice,
    actualPrice: null,
    status: "재고",
    createdAt: new Date().toISOString(),
    soldAt: null,
    memo: data.memo || "",
  };
  items.push(item);
  saveItems(filePath, items);
  return item;
}

function updateItem(filePath, id, patch) {
  const items = loadItems(filePath);
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...patch };
  saveItems(filePath, items);
  return items[idx];
}

function listItems(filePath, opts = {}) {
  const items = loadItems(filePath);
  if (!opts.status) return items;
  return items.filter((i) => i.status === opts.status);
}

module.exports = { loadItems, saveItems, addItem, updateItem, listItems };
