// 파일 관리 창 전용 preload. 파인더에서 끌어온 파일의 실제 경로는 webUtils로 얻는다
// (Electron 32부터 File.path가 없어졌다).
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("files", {
  list: () => ipcRenderer.invoke("files-list"),
  thumb: (id, name) => ipcRenderer.invoke("files-thumb", id, name),
  setName: (id, name) => ipcRenderer.invoke("files-set-name", id, name),
  saveListing: (id, edits) => ipcRenderer.invoke("files-save-listing", id, edits),
  reorder: (id, names) => ipcRenderer.invoke("files-reorder", id, names),
  move: (fromId, name, toId) => ipcRenderer.invoke("files-move", fromId, name, toId),
  add: (id, paths) => ipcRenderer.invoke("files-add", id, paths),
  openPhoto: (id, name) => ipcRenderer.invoke("files-open-photo", id, name),
  deletePhoto: (id, name) => ipcRenderer.invoke("files-delete-photo", id, name),
  openFolder: (id) => ipcRenderer.invoke("files-open-folder", id),
  openTxt: (id) => ipcRenderer.invoke("files-open-txt", id),
  makeFruitsThumb: (id) => ipcRenderer.invoke("files-make-fruits-thumb", id),
  addTags: (paths) => ipcRenderer.invoke("files-add-tags", paths),
  readMaterials: (id) => ipcRenderer.invoke("files-read-materials", id),
  addWorn: (id, paths, replace) => ipcRenderer.invoke("files-add-worn", id, paths, replace),
  addMeasure: (id, paths) => ipcRenderer.invoke("files-add-measure", id, paths),
  finish: (id) => ipcRenderer.invoke("files-finish", id),
  addUnsorted: (paths) => ipcRenderer.invoke("files-add-unsorted", paths),
  sort: () => ipcRenderer.invoke("files-sort"),
  suggestNames: () => ipcRenderer.invoke("files-suggest-names"),
  psBackground: () => ipcRenderer.invoke("files-ps-background"),
  psFit: () => ipcRenderer.invoke("files-ps-fit"),
  psSaveAll: () => ipcRenderer.invoke("files-ps-saveall"),
  upload: (ids, platforms) => ipcRenderer.invoke("files-upload", ids, platforms),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onChanged: (cb) => ipcRenderer.on("files-changed", () => cb()),
});
