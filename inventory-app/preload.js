// inventory-app/preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  openLogin: () => ipcRenderer.invoke("open-login"),
  fetchItem: (url) => ipcRenderer.invoke("fetch-item", url),
  saveItem: (data) => ipcRenderer.invoke("save-item", data),
  updateItem: (id, patch) => ipcRenderer.invoke("update-item", id, patch),
  listItems: (opts) => ipcRenderer.invoke("list-items", opts),
  getDashboard: () => ipcRenderer.invoke("get-dashboard"),
});
