// inventory-app/main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const {
  computeCostKrw,
  computeMinPrice,
  parseItemHtml,
  computeDashboard,
} = require("./pricing");
const { addItem, updateItem, listItems } = require("./store");

const DB_FILE = path.join(app.getPath("userData"), "inventory.json");
const DEFAULT_FX_RATE = 950;
const DEFAULT_DUTY_RATE = 0.23;
const DEFAULT_MARGIN_RATE = 0.4;
const DEFAULT_CAP_KRW = 3000000;
const DEFAULT_TARGET_KRW = 1000000;

let mainWindow = null;
let loginWindow = null;

const KENZ_PARTITION = "persist:kenzpost";

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  mainWindow.loadFile("index.html");
}

function openLoginWindow() {
  if (loginWindow) {
    loginWindow.focus();
    return;
  }
  loginWindow = new BrowserWindow({
    width: 480,
    height: 640,
    webPreferences: { partition: KENZ_PARTITION },
  });
  loginWindow.loadURL("https://kenzpost.com/member/login");
  loginWindow.on("closed", () => {
    loginWindow = null;
  });
}

async function fetchHtmlWithSession(url) {
  const { hostname } = new URL(url);
  if (hostname !== "kenzpost.com" && !hostname.endsWith(".kenzpost.com")) {
    throw new Error("켄즈포스트 링크만 가져올 수 있어요.");
  }
  const win = new BrowserWindow({
    show: false,
    webPreferences: { partition: KENZ_PARTITION },
  });
  try {
    await win.loadURL(url);
    return await win.webContents.executeJavaScript(
      "document.documentElement.outerHTML"
    );
  } finally {
    win.destroy();
  }
}

ipcMain.handle("open-login", () => {
  openLoginWindow();
});

ipcMain.handle("fetch-item", async (event, url) => {
  const html = await fetchHtmlWithSession(url);
  const { title, jpyPrice } = parseItemHtml(html);
  if (jpyPrice == null) {
    return { title, jpyPrice: null, costKrw: null, minPrice: null, needsLogin: html.includes("로그인") };
  }
  const costKrw = computeCostKrw(jpyPrice, DEFAULT_FX_RATE, DEFAULT_DUTY_RATE);
  const minPrice = computeMinPrice(costKrw, DEFAULT_MARGIN_RATE);
  return {
    title,
    jpyPrice,
    fxRate: DEFAULT_FX_RATE,
    dutyRate: DEFAULT_DUTY_RATE,
    costKrw,
    minPrice,
    needsLogin: false,
  };
});

ipcMain.handle("save-item", (event, data) => addItem(DB_FILE, data));

ipcMain.handle("update-item", (event, id, patch) => updateItem(DB_FILE, id, patch));

ipcMain.handle("list-items", (event, opts) => listItems(DB_FILE, opts));

ipcMain.handle("get-dashboard", () => {
  const items = listItems(DB_FILE);
  return computeDashboard(items, {
    capKrw: DEFAULT_CAP_KRW,
    monthlyTargetKrw: DEFAULT_TARGET_KRW,
  });
});

app.whenReady().then(createMainWindow);
app.on("window-all-closed", () => app.quit());
