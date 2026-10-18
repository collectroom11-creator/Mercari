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
    imageUrl: data.imageUrl || null,
    sourceUrl: data.sourceUrl,
    jpyPrice: data.jpyPrice,
    fxRate: data.fxRate,
    dutyRate: data.dutyRate,
    vatRate: data.vatRate,
    localShippingJpy: data.localShippingJpy || 0,
    intlShippingJpy: data.intlShippingJpy || 0,
    feeJpy: data.feeJpy || 0,
    costKrw: data.costKrw,
    targetPrice: data.targetPrice,
    // 판매가: 사용자가 직접 입력/수정하는 "지금 실제로 파는 가격". 등록 시점엔
    // 비워두고, 자동계산된 추천가(targetPrice)는 목록 화면에서 플레이스홀더로만 보여준다.
    listPrice: data.listPrice ?? null,
    // 사용자가 판매가를 직접 고친 적이 있는지 - 아직 없으면(추천가 그대로면) 화면에
    // 흐릿하게 표시해서 "이건 추천값이다"를 알려준다.
    listPriceEdited: data.listPriceEdited ?? false,
    actualPrice: null,
    // 새로 등록된 물건은 아직 한국에 안 왔으니 "배송전"부터 시작한다.
    // 배송전 -> 업로드전 -> 판매중 -> 판매완료 순으로 사용자가 직접 단계를 바꾼다.
    status: "배송전",
    createdAt: new Date().toISOString(),
    // 현재 상태로 바뀐 시각 - 목록에서 "이 상태로 며칠째인지" 표시하는 데 쓴다.
    statusChangedAt: new Date().toISOString(),
    // 판매중으로 바뀐(업로드완료) 시각 - 나중에 판매완료가 되면 "업로드 후 며칠만에
    // 팔렸는지" 계산하는 데 쓴다. statusChangedAt은 그때 다시 덮어써지므로 따로 둔다.
    listedAt: null,
    // 판매중으로 바뀐 시점의 판매가 - 할인율은 추천가가 아니라 이 값 대비로 계산한다.
    listedPrice: null,
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

function deleteItem(filePath, id) {
  const items = loadItems(filePath);
  const next = items.filter((i) => i.id !== id);
  const deleted = next.length !== items.length;
  if (deleted) saveItems(filePath, next);
  return deleted;
}

module.exports = { loadItems, saveItems, addItem, updateItem, listItems, deleteItem };
