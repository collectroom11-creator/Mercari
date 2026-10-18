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
});
