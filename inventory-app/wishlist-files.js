// 찜 감시용 파일들. 재고 앱(링크 직접 추가/알림 확인)과 wishlist-watch.js(30분마다
// launchd 실행)가 같은 파일을 동시에 쓰지 않도록 역할별로 나눈다:
//   wishlist-manual.json - 앱이 쓰고 감시 스크립트가 읽는 "직접 추가한 상품" 목록
//   wishlist-drops.json  - 감시 스크립트가 쓰고 앱이 읽는 "가격 인하 기록"
//   wishlist-hidden.json - 앱에서 삭제한 상품 id. 켄즈포스트 동기화가 다시 넣어도 빠진다.
const fs = require("node:fs");
const path = require("node:path");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, "utf-8");
  return raw.trim() ? JSON.parse(raw) : fallback;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// 일반 상품은 /item/m123..., 메루카리 Shops 상품은 /shops/product/영문숫자 - 둘 다 id만 저장한다.
function parseWishlistLink(url) {
  const m = String(url).match(/jp\.mercari\.com\/(?:item\/(m\d+)|shops\/product\/([A-Za-z0-9]+))/);
  return m ? m[1] || m[2] : null;
}

function mercariItemUrl(id) {
  return /^m\d+$/.test(id) ? `https://jp.mercari.com/item/${id}` : `https://jp.mercari.com/shops/product/${id}`;
}

function loadManual(file) {
  return readJson(file, []);
}

// imageUrl: 검색 화면에서 찜할 때 넘겨주는 사진 주소. 가격 확인이 돌기 전에도(특히 사진 주소를
// id로 만들 수 없는 Shops 상품) 찜 화면에 사진이 보이게 한다.
function addManual(file, id, { imageUrl } = {}) {
  const list = loadManual(file);
  const found = list.find((m) => m.id === id);
  if (!found) list.push({ id, addedAt: new Date().toISOString(), ...(imageUrl ? { imageUrl } : {}) });
  else if (imageUrl && !found.imageUrl) found.imageUrl = imageUrl;
  writeJson(file, list);
  return list;
}

function removeManual(file, id) {
  const list = loadManual(file).filter((m) => m.id !== id);
  writeJson(file, list);
  return list;
}

function loadHidden(file) {
  return readJson(file, []);
}

function hideItem(file, id) {
  const list = loadHidden(file);
  if (!list.includes(id)) list.push(id);
  writeJson(file, list);
  return list;
}

function loadDrops(file) {
  return readJson(file, []);
}

function appendDrop(file, { id, title, oldPrice, newPrice, imageUrl }) {
  const drops = loadDrops(file);
  const at = new Date().toISOString();
  drops.push({ dropId: `${id}@${at}`, id, title, oldPrice, newPrice, imageUrl: imageUrl || null, at });
  writeJson(file, drops);
}

// kenzList가 null이면(켄즈포스트 로그아웃) 기존 목록을 그대로 쓴다. 켄즈 목록이 있으면
// 거기서 빠진 상품은 감시를 멈추되, 직접 추가한 상품은 남긴다.
function mergeWishlist(stateItems, kenzList, manualIds, hiddenIds = []) {
  const items = { ...stateItems };
  const hidden = new Set(hiddenIds);
  const manual = new Set(manualIds.filter((id) => !hidden.has(id)));
  if (kenzList) {
    const kenzIds = new Set(kenzList.map((w) => w.id));
    for (const id of Object.keys(items)) {
      if (!kenzIds.has(id) && !manual.has(id)) delete items[id];
    }
    for (const w of kenzList.filter((k) => !hidden.has(k.id))) {
      // 담을 당시 가격이 0으로 기록된 상품도 있어서, 그땐 첫 확인 가격을 기준으로 삼는다.
      if (!items[w.id]) items[w.id] = { title: w.title, lastPrice: w.listedPrice || null, soldOut: false };
    }
  }
  for (const id of manual) {
    if (!items[id]) items[id] = { title: id, lastPrice: null, soldOut: false };
  }
  for (const id of hidden) delete items[id];
  return items;
}

module.exports = {
  mercariItemUrl, parseWishlistLink, loadManual, addManual, removeManual, appendDrop, loadDrops, mergeWishlist, loadHidden, hideItem };
