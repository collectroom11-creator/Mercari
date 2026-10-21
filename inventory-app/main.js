// inventory-app/main.js
const { app, BrowserWindow, ipcMain, shell, session, nativeImage, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const {
  DUTY_RATE,
  VAT_RATE,
  INTL_SHIPPING_JPY,
  FEE_JPY,
  computeCostKrw,
  computeTieredSalePrice,
  parseItemHtml,
  extractMercariItemUrl,
  extractBuyFxRate,
  computeDashboard,
  computeMonthlyBreakdown,
} = require("./pricing");
const { addItem, updateItem, listItems, deleteItem, loadItems } = require("./store");
const { loadSettings, saveSettings } = require("./settings");
const { fetchMercariItem } = require("./mercari-fetch");
const { computeShopStats, computeMonthlySales } = require("./stats");
const { computeDiscountAlerts, discountedPrice } = require("./discounts");
const { ledgerGet, ledgerSet, importLedgerBackup } = require("./ledger-store");
const { parseWishlistLink, loadManual, addManual, removeManual, loadDrops } = require("./wishlist-files");
const { loadBrandNames, matchBrand, validateFilters } = require("./filters");
const { readRemoteFilters, saveFilters } = require("./filters-git");

const DB_FILE = path.join(app.getPath("userData"), "inventory.json");
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const LOGIN_NAV_LOG_FILE = path.join(app.getPath("userData"), "login-nav.log");

let mainWindow = null;
let loginWindow = null;

const KENZ_PARTITION = "persist:kenzpost";
const APP_ICON_PATH = path.join(__dirname, "icon.png");

function createMainWindow() {
  // 이 맥의 디스플레이가 정수가 아닌 배율(예: "확대된" 해상도 설정)을 쓰고 있어서,
  // width를 그대로 주면 실제 페이지가 보는 창 폭(window.innerWidth)이 그보다 더
  // 좁게 나온다(예: 1040을 줬는데 실제로는 949) - 그래서 970px 미만으로 착각해서
  // 대시보드가 위로 올라가는 좁은 레이아웃이 매번 뜨는 문제였다. 배율을 감안해서
  // 실제 렌더링 폭이 넉넉히 970을 넘도록 여유있게 크게 잡는다.
  const TARGET_WIDTH = 1140;
  const TARGET_HEIGHT = 740;
  // 재고 입력 보드(열 4개 × 최소 210px) + 사이드바(210) + 여백(40)이 1,090px라서, 그보다
  // 좁아져서 가로 스크롤바가 생기지 않게 창을 이 이상 못 줄이게 한다.
  const MIN_CONTENT_WIDTH = 1100;
  const MIN_CONTENT_HEIGHT = 730;
  mainWindow = new BrowserWindow({
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    minWidth: MIN_CONTENT_WIDTH,
    // 대시보드(목록 4줄 포함)가 스크롤 없이 다 들어가는 최소 높이
    minHeight: MIN_CONTENT_HEIGHT,
    useContentSize: true,
    show: false,
    icon: APP_ICON_PATH,
    // 맥 기본 앱처럼: 제목줄을 숨기고 신호등 버튼을 사이드바 위에 겹쳐 두고,
    // 사이드바 뒤로 바탕화면이 비치는 반투명 효과(vibrancy)를 쓴다.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    backgroundColor: "#00000000",
    // 가계부(ledger/ledger.html)는 iframe으로 띄우는데, 그 안에서도 preload의
    // window.storage가 필요해서 하위 프레임에도 preload를 돌린다.
    webPreferences: { preload: path.join(__dirname, "preload.js"), nodeIntegrationInSubFrames: true },
  });
  mainWindow.loadFile("index.html");
  mainWindow.once("ready-to-show", async () => {
    // 실제로 렌더링된 폭을 직접 확인해서, 디스플레이 배율 때문에 목표보다
    // 좁게 나왔으면 그 배율만큼 보정해서 다시 맞춘다.
    try {
      const actualWidth = await mainWindow.webContents.executeJavaScript("window.innerWidth");
      if (actualWidth > 0 && actualWidth < TARGET_WIDTH) {
        const scale = TARGET_WIDTH / actualWidth;
        mainWindow.setContentSize(Math.round(TARGET_WIDTH * scale), Math.round(TARGET_HEIGHT * scale));
        mainWindow.setMinimumSize(Math.round(MIN_CONTENT_WIDTH * scale), Math.round(MIN_CONTENT_HEIGHT * scale));
      }
    } catch (e) {
      // 보정 실패해도 기본 크기로는 뜨니 무시한다.
    }
    mainWindow.show();
  });
}

function openLoginWindow() {
  if (loginWindow) {
    loginWindow.focus();
    return;
  }
  loginWindow = new BrowserWindow({
    width: 480,
    height: 640,
    show: true,
    backgroundColor: "#F2F4F6",
    webPreferences: { partition: KENZ_PARTITION },
  });
  // 다른 창(메인 창)에 가려져 있을 수 있으니 강제로 맨 앞으로 가져온다.
  loginWindow.show();
  loginWindow.focus();

  // "/member/login"은 실제로 존재하지 않는(404) 주소였다 - 로그인 창은 홈페이지
  // ("https://kenzpost.com/")를 연다. 로그인에 성공하면 화면에 "로그아웃"이라는
  // 텍스트가 뜬다고 실제로 확인함 - 그 텍스트가 나타났는지로 판단한다(이전 네 번의
  // 시도는 전부 실제로 확인 안 하고 추측한 페이지 구조라 다 틀렸었다).
  const logNav = (label, detail) => {
    try {
      fs.appendFileSync(LOGIN_NAV_LOG_FILE, `${new Date().toISOString()} ${label} ${detail}\n`);
    } catch (e) {
      // 로그 실패는 무시 - 기능에 영향 없음
    }
  };
  // did-finish-load가 한 창 생명주기 동안 여러 번 뜰 수 있어서(리소스 로드 등),
  // 성공 처리는 한 번만 하도록 막는다 - 안 그러면 알림이 여러 번 뜬다.
  let successHandled = false;
  loginWindow.webContents.on("did-navigate", (event, url) => {
    logNav("did-navigate", url);
  });
  loginWindow.webContents.on("did-finish-load", async () => {
    if (!loginWindow || successHandled) return;
    let loggedIn;
    try {
      loggedIn = await loginWindow.webContents.executeJavaScript(
        "document.body.innerText.includes('로그아웃')"
      );
    } catch (e) {
      logNav("did-finish-load", "executeJavaScript failed: " + e.message);
      return;
    }
    if (successHandled) return; // 대기하는 동안 다른 이벤트가 먼저 처리했을 수 있다
    logNav("did-finish-load", "'로그아웃' found = " + loggedIn);
    if (loggedIn && loginWindow) {
      successHandled = true;
      logNav("SUCCESS-DETECTED", loginWindow.webContents.getURL());
      await persistKenzCookies();
      if (mainWindow) mainWindow.webContents.send("login-success");
      loginWindow.close();
    }
  });

  loginWindow.loadURL("https://kenzpost.com/");
  loginWindow.on("closed", () => {
    loginWindow = null;
  });
}

// 켄즈포스트 로그인 쿠키가 만료일 없는 "세션 쿠키"로 내려오면, persist: 파티션을
// 써도 앱을 완전히 종료할 때 크로미움이 그냥 지워버려서 매번 다시 로그인해야
// 한다. 만료일을 직접 붙여서(180일) 다시 저장해두면 재시작해도 로그인이 유지된다.
async function persistKenzCookies() {
  const ses = session.fromPartition(KENZ_PARTITION);
  const cookies = await ses.cookies.get({});
  const expirationDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180;
  for (const cookie of cookies) {
    if (!cookie.session || !cookie.domain.includes("kenzpost")) continue;
    const url = `${cookie.secure ? "https" : "http"}://${cookie.domain.replace(/^\./, "")}${cookie.path}`;
    try {
      await ses.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate,
      });
    } catch (e) {
      // 쿠키 하나 실패해도 나머지는 계속 처리한다.
    }
  }
}

async function checkLoginStatus() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { partition: KENZ_PARTITION },
  });
  try {
    await win.loadURL("https://kenzpost.com/");
    return await win.webContents.executeJavaScript("document.body.innerText.includes('로그아웃')");
  } catch (e) {
    return false;
  } finally {
    win.destroy();
  }
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
    const finalUrl = win.webContents.getURL();
    const html = await win.webContents.executeJavaScript(
      "document.documentElement.outerHTML"
    );
    return { html, finalUrl };
  } finally {
    win.destroy();
  }
}

ipcMain.handle("open-login", () => {
  openLoginWindow();
});

ipcMain.handle("check-login-status", () => checkLoginStatus());

ipcMain.handle("fetch-item", async (event, url) => {
  const settings = loadSettings(SETTINGS_FILE);
  const { html, finalUrl } = await fetchHtmlWithSession(url);
  // 텍스트에 "로그인"이 포함돼있는지가 아니라, 실제로 로그인 페이지로
  // 리다이렉트됐는지(URL)로 판단한다 - 메뉴/푸터 등에 "로그인" 문구가
  // 로그인 여부와 무관하게 항상 들어있어서 텍스트 매칭은 오탐이 잦았다.
  const needsLogin = /\/member\/login/i.test(finalUrl);
  let { title, jpyPrice, imageUrl } = needsLogin
    ? { title: null, jpyPrice: null, imageUrl: null }
    : parseItemHtml(html);
  // 로그인이 풀려 있으면 리다이렉트되거나(needsLogin), 리다이렉트 없이 로그인 폼만
  // 보여서 가격을 못 읽는다. 메루카리 상품이면 메루카리 페이지에서 대신 읽는다.
  let priceSource = "kenzpost";
  if (jpyPrice == null) {
    const mercariUrl = extractMercariItemUrl(url);
    const mercari = mercariUrl ? await fetchMercariItem(mercariUrl).catch(() => null) : null;
    if (!mercari) {
      return { title, jpyPrice: null, costKrw: null, minPrice: null, imageUrl, needsLogin };
    }
    ({ title, jpyPrice, imageUrl } = mercari);
    priceSource = "mercari";
  }
  // 페이지 하단 환율안내 박스의 "살 때" 값을 우선 쓰고, 못 읽으면 마지막으로 알던
  // 환율로 대체한다. 실제로 읽어온 값은 다음번 대체용으로 저장해둔다.
  const extractedFxRate = extractBuyFxRate(html);
  const fxRate = extractedFxRate ?? settings.fxRate;
  if (extractedFxRate != null && extractedFxRate !== settings.fxRate) {
    saveSettings(SETTINGS_FILE, { ...settings, fxRate: extractedFxRate });
  }
  // 현지배송비는 아직 모르니 0으로 시작하고, 재고 목록에서 실제 배송비를 알게 되면
  // 그때 직접 입력해서 원가를 다시 계산한다. 수수료는 등급과 무관하게 고정값.
  const costKrw = computeCostKrw({
    jpyPrice,
    fxRate,
    dutyRate: DUTY_RATE,
    vatRate: VAT_RATE,
    localShippingJpy: 0,
    intlShippingJpy: INTL_SHIPPING_JPY,
    feeJpy: FEE_JPY,
  });
  const { rate: marginRate, price: minPrice } = computeTieredSalePrice(costKrw, jpyPrice);
  return {
    title,
    jpyPrice,
    imageUrl,
    fxRate,
    dutyRate: DUTY_RATE,
    vatRate: VAT_RATE,
    localShippingJpy: 0,
    intlShippingJpy: INTL_SHIPPING_JPY,
    feeJpy: FEE_JPY,
    costKrw,
    minPrice,
    marginRate,
    priceSource,
    needsLogin: false,
  };
});

ipcMain.handle("save-item", (event, data) => addItem(DB_FILE, data));

ipcMain.handle("update-item", (event, id, patch) => updateItem(DB_FILE, id, patch));

ipcMain.handle("update-local-shipping", (event, id, localShippingJpy) => {
  const items = loadItems(DB_FILE);
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  const costKrw = computeCostKrw({
    jpyPrice: item.jpyPrice,
    fxRate: item.fxRate,
    dutyRate: DUTY_RATE,
    vatRate: VAT_RATE,
    localShippingJpy,
    intlShippingJpy: INTL_SHIPPING_JPY,
    feeJpy: FEE_JPY,
  });
  const { price: targetPrice } = computeTieredSalePrice(costKrw, item.jpyPrice);
  const patch = { localShippingJpy, costKrw, targetPrice };
  // 사용자가 판매가를 아직 직접 고친 적 없으면(추천가 그대로 쓰고 있으면) 배송비가
  // 바뀔 때 판매가도 새 추천가로 같이 갱신한다. 이미 직접 고쳤다면 건드리지 않는다.
  if (!item.listPriceEdited) {
    patch.listPrice = targetPrice;
  }
  return updateItem(DB_FILE, id, patch);
});

ipcMain.handle("delete-item", (event, id) => deleteItem(DB_FILE, id));

ipcMain.handle("list-items", (event, opts) => listItems(DB_FILE, opts));

ipcMain.handle("get-dashboard", () => {
  const items = listItems(DB_FILE);
  return computeDashboard(items, {});
});

ipcMain.handle("get-monthly-breakdown", () => {
  const items = listItems(DB_FILE);
  return computeMonthlyBreakdown(items, {});
});

ipcMain.handle("get-settings", () => loadSettings(SETTINGS_FILE));

ipcMain.handle("open-external", (event, url) => shell.openExternal(url));

// ---- 샵 운영 툴: 대시보드 / 알림 / 찜 / 메루카리 필터 / 가계부 ----
const DATA_DIR = app.getPath("userData");
const LEDGER_FILE = path.join(DATA_DIR, "ledger.json");
const ALERTS_STATE_FILE = path.join(DATA_DIR, "alerts-state.json");
const WISHLIST_STATE_FILE = path.join(DATA_DIR, "wishlist-watch.json");
const WISHLIST_MANUAL_FILE = path.join(DATA_DIR, "wishlist-manual.json");
const WISHLIST_DROPS_FILE = path.join(DATA_DIR, "wishlist-drops.json");
const REPO_DIR = path.join(__dirname, "..");
const FACETS_BRANDS_FILE = path.join(REPO_DIR, "facets", "brands.json");

function loadAlertsState() {
  const empty = { dismissedDiscounts: {}, ackedDrops: [] };
  if (!fs.existsSync(ALERTS_STATE_FILE)) return empty;
  return { ...empty, ...JSON.parse(fs.readFileSync(ALERTS_STATE_FILE, "utf-8")) };
}
function saveAlertsState(state) {
  fs.writeFileSync(ALERTS_STATE_FILE, JSON.stringify(state, null, 2));
}

ipcMain.handle("get-shop-stats", () => computeShopStats(listItems(DB_FILE)));
// 대시보드 그래프는 최근 6개월 고정
ipcMain.handle("get-monthly-sales", () => computeMonthlySales(listItems(DB_FILE), { lastMonths: 6 }));

ipcMain.handle("get-alerts", () => {
  const state = loadAlertsState();
  const acked = new Set(state.ackedDrops);
  return {
    discounts: computeDiscountAlerts(listItems(DB_FILE), state.dismissedDiscounts),
    drops: loadDrops(WISHLIST_DROPS_FILE).filter((d) => !acked.has(d.dropId)).reverse(),
  };
});
ipcMain.handle("apply-discount", (event, id, pct) => {
  const item = listItems(DB_FILE).find((i) => i.id === id);
  if (!item || !item.listedPrice) return null;
  return updateItem(DB_FILE, id, { listPrice: discountedPrice(item.listedPrice, pct), listPriceEdited: true });
});
ipcMain.handle("dismiss-discount", (event, id, pct) => {
  const state = loadAlertsState();
  state.dismissedDiscounts[id] = pct;
  saveAlertsState(state);
});
ipcMain.handle("ack-drop", (event, dropId) => {
  const state = loadAlertsState();
  if (!state.ackedDrops.includes(dropId)) state.ackedDrops.push(dropId);
  saveAlertsState(state);
});

ipcMain.handle("get-wishlist", () => {
  const state = fs.existsSync(WISHLIST_STATE_FILE)
    ? JSON.parse(fs.readFileSync(WISHLIST_STATE_FILE, "utf-8"))
    : { items: {} };
  const manual = new Set(loadManual(WISHLIST_MANUAL_FILE).map((m) => m.id));
  const rows = Object.entries(state.items).map(([id, it]) => ({ id, ...it, manual: manual.has(id) }));
  // 직접 추가했지만 감시 스크립트가 아직 한 번도 안 돈 상품도 보여준다.
  for (const id of manual) {
    if (!state.items[id]) rows.push({ id, title: id, lastPrice: null, soldOut: false, checkedAt: null, manual: true });
  }
  return { items: rows, lastRunAt: state.lastRunAt || null, lastListSyncAt: state.lastListSyncAt || null };
});
ipcMain.handle("add-wishlist-link", (event, url) => {
  const id = parseWishlistLink(url);
  if (!id) return { ok: false, error: "메루카리 상품 링크가 아니에요(켄즈포스트 메루카리 링크나 jp.mercari.com 링크를 넣어주세요)" };
  addManual(WISHLIST_MANUAL_FILE, id);
  return { ok: true, id };
});
ipcMain.handle("remove-wishlist-link", (event, id) => removeManual(WISHLIST_MANUAL_FILE, id));

let brandNamesCache = null;
function brandNames() {
  if (!brandNamesCache) brandNamesCache = loadBrandNames(FACETS_BRANDS_FILE);
  return brandNamesCache;
}
ipcMain.handle("get-filters", () => {
  try {
    return { ok: true, filters: readRemoteFilters(REPO_DIR) };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message) };
  }
});
ipcMain.handle("match-brand", (event, input) => matchBrand(input, brandNames()));
ipcMain.handle("save-filters", (event, filters) => {
  const errors = validateFilters(filters, brandNames());
  if (errors.length) return { ok: false, errors };
  return saveFilters(REPO_DIR, filters);
});

ipcMain.on("ledger-get", (event, key) => {
  try {
    event.returnValue = { ok: true, result: ledgerGet(LEDGER_FILE, key) };
  } catch (e) {
    event.returnValue = { ok: false, error: e.message };
  }
});
ipcMain.on("ledger-set", (event, key, value) => {
  ledgerSet(LEDGER_FILE, key, value);
  event.returnValue = true;
});
ipcMain.handle("ledger-import", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "가계부 백업 파일 선택",
    defaultPath: app.getPath("downloads"),
    filters: [{ name: "가계부 백업", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths[0]) return { ok: false, canceled: true };
  try {
    const backup = JSON.parse(fs.readFileSync(filePaths[0], "utf-8"));
    return { ok: true, ...importLedgerBackup(LEDGER_FILE, backup) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(() => {
  // 패키징 없이 "electron ."으로 그냥 실행하면 macOS가 Info.plist의 아이콘을 못 읽어서
  // 기본 Electron 아이콘이 Dock에 뜬다 - 개발 중에도 우리 아이콘이 보이게 직접 지정한다.
  if (process.platform === "darwin") {
    app.dock.setIcon(nativeImage.createFromPath(APP_ICON_PATH));
  }
  createMainWindow();
});
app.on("window-all-closed", () => app.quit());

// 로그인 이후 서버가 쿠키를 세션 쿠키로 다시 내려보내는 경우에 대비해서,
// 완전히 꺼지기 직전에도 한 번 더 만료일을 붙여둔다(최종 안전망).
app.on("before-quit", (event) => {
  event.preventDefault();
  persistKenzCookies().finally(() => app.exit(0));
});
