const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onAlerts: (callback) => ipcRenderer.on("alerts", (event, alerts) => callback(alerts)),
  closeWindow: () => ipcRenderer.send("close-window"),
});
