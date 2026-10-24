// inventory-app/preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  openLogin: () => ipcRenderer.invoke("open-login"),
  checkLoginStatus: () => ipcRenderer.invoke("check-login-status"),
  fetchItem: (url) => ipcRenderer.invoke("fetch-item", url),
  saveItem: (data) => ipcRenderer.invoke("save-item", data),
  updateItem: (id, patch) => ipcRenderer.invoke("update-item", id, patch),
  updateLocalShipping: (id, localShippingJpy) =>
    ipcRenderer.invoke("update-local-shipping", id, localShippingJpy),
  deleteItem: (id) => ipcRenderer.invoke("delete-item", id),
  listItems: (opts) => ipcRenderer.invoke("list-items", opts),
  getDashboard: () => ipcRenderer.invoke("get-dashboard"),
  getMonthlyBreakdown: () => ipcRenderer.invoke("get-monthly-breakdown"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onLoginSuccess: (callback) => ipcRenderer.on("login-success", () => callback()),
  onWishlistUpdated: (callback) => ipcRenderer.on("wishlist-updated", () => callback()),
  getShopStats: () => ipcRenderer.invoke("get-shop-stats"),
  getBrandMix: () => ipcRenderer.invoke("get-brand-mix"),
  getMonthlySales: () => ipcRenderer.invoke("get-monthly-sales"),
  getAlerts: () => ipcRenderer.invoke("get-alerts"),
  applyDiscount: (id, pct) => ipcRenderer.invoke("apply-discount", id, pct),
  dismissDiscount: (id, pct) => ipcRenderer.invoke("dismiss-discount", id, pct),
  ackDrop: (dropId) => ipcRenderer.invoke("ack-drop", dropId),
  getWishlist: () => ipcRenderer.invoke("get-wishlist"),
  addWishlistLink: (url) => ipcRenderer.invoke("add-wishlist-link", url),
  removeWishlistLink: (id) => ipcRenderer.invoke("remove-wishlist-link", id),
  getFilters: () => ipcRenderer.invoke("get-filters"),
  matchBrand: (input) => ipcRenderer.invoke("match-brand", input),
  saveFilters: (filters) => ipcRenderer.invoke("save-filters", filters),
  mercariSearch: (conditions) => ipcRenderer.invoke("mercari-search", conditions),
  searchBrands: (query) => ipcRenderer.invoke("search-brands", query),
  resolveBrands: (names) => ipcRenderer.invoke("resolve-brands", names),
  menCategories: () => ipcRenderer.invoke("men-categories"),
  ledgerImport: () => ipcRenderer.invoke("ledger-import"),
  ledgerExport: () => ipcRenderer.invoke("ledger-export"),
});

// 가계부(iframe) 저장소 - Claude.ai의 window.storage와 같은 모양: get은 {value}를
// 돌려주고 키가 없으면 throw, set(key, value).
// contextBridge로 노출한 속성은 수정 불가(non-configurable)라서 이름을 window.storage로
// 하면 가계부의 최상위 `const storage` 선언이 SyntaxError로 통째로 실패한다. 그래서 다른
// 이름으로 노출하고, ledger.html 맨 앞의 짧은 스크립트가 window.storage로 연결한다.
contextBridge.exposeInMainWorld("__ledgerStorage", {
  get: async (key) => {
    const r = ipcRenderer.sendSync("ledger-get", key);
    if (!r.ok) throw new Error(r.error);
    return r.result;
  },
  set: async (key, value) => {
    ipcRenderer.sendSync("ledger-set", key, value);
  },
});
