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
const { ledgerGet, ledgerSet, importLedgerBackup, exportLedgerBackup } = require("./ledger-store");
const { parseWishlistLink, loadManual, addManual, removeManual, loadDrops, loadHidden, hideItem } = require("./wishlist-files");
const { loadBrandNames, matchBrand, validateFilters } = require("./filters");
const { computeBrandMix } = require("./brands");
const { createSigner, searchMercari, loadFacets, searchBrands, menCategoryTree } = require("./mercari-search");
const { readRemoteFilters, saveFilters } = require("./filters-git");
const uploadFiles = require("./upload-files");
const photoSort = require("./photo-sort");
const photoshop = require("./photoshop");
const listingUpload = require("./listing-upload");
const { runClaude } = require("./claude-runner");
const { execFile } = require("node:child_process");

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
    // 최소 크기도 항상 이 배율로 바꿔서 건다 - 창 크기(포인트)와 페이지 크기(CSS px)가 달라서,
    // 그대로 걸면 실제 페이지는 최소값보다 작아져서 요소가 잘렸다.
    try {
      const actualWidth = await mainWindow.webContents.executeJavaScript("window.innerWidth");
      if (actualWidth > 0) {
        const [contentW] = mainWindow.getContentSize();
        const scale = contentW / actualWidth; // 페이지 1px당 창 포인트
        if (actualWidth < TARGET_WIDTH) {
          mainWindow.setContentSize(Math.round(TARGET_WIDTH * scale), Math.round(TARGET_HEIGHT * scale));
        }
        mainWindow.setMinimumSize(Math.ceil(MIN_CONTENT_WIDTH * scale) + 2, Math.ceil(MIN_CONTENT_HEIGHT * scale) + 2);
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

ipcMain.handle("update-item", (event, id, patch) => {
  const updated = updateItem(DB_FILE, id, patch);
  // 상태가 업로드전으로 바뀌면 파일 관리 창에 탭이 생겨야 하니 다시 그리게 한다.
  notifyFilesWindow();
  return updated;
});

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
// 찜 가격 확인(launchd로 30분마다 도는 wishlist-watch.js)이 결과 파일을 쓰면 화면에 알려서 바로 새로 그리게 한다.
let wishlistNotifyTimer = null;
fs.watchFile(WISHLIST_STATE_FILE, { interval: 5000 }, (cur, prev) => {
  if (cur.mtimeMs === prev.mtimeMs) return;
  clearTimeout(wishlistNotifyTimer);
  wishlistNotifyTimer = setTimeout(() => mainWindow && mainWindow.webContents.send("wishlist-updated"), 500);
});
const WISHLIST_MANUAL_FILE = path.join(DATA_DIR, "wishlist-manual.json");
const WISHLIST_DROPS_FILE = path.join(DATA_DIR, "wishlist-drops.json");
const WISHLIST_HIDDEN_FILE = path.join(DATA_DIR, "wishlist-hidden.json");
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

ipcMain.handle("get-shop-stats", () => ({
  ...computeShopStats(listItems(DB_FILE)),
  stockTargetKrw: loadSettings(SETTINGS_FILE).stockTargetKrw,
}));
ipcMain.handle("get-brand-mix", () => {
  const items = listItems(DB_FILE);
  return { count: computeBrandMix(items), cost: computeBrandMix(items, { by: "cost" }) };
});
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
  const manualList = loadManual(WISHLIST_MANUAL_FILE);
  const manual = new Set(manualList.map((m) => m.id));
  const manualImage = new Map(manualList.filter((m) => m.imageUrl).map((m) => [m.id, m.imageUrl]));
  const hidden = new Set(loadHidden(WISHLIST_HIDDEN_FILE));
  const rows = Object.entries(state.items)
    .filter(([id]) => !hidden.has(id))
    .map(([id, it]) => ({ id, ...it, imageUrl: it.imageUrl || manualImage.get(id) || null, manual: manual.has(id) }));
  // 직접 추가했지만 감시 스크립트가 아직 한 번도 안 돈 상품도 보여준다.
  for (const id of manual) {
    if (!state.items[id] && !hidden.has(id)) rows.push({ id, title: id, lastPrice: null, soldOut: false, checkedAt: null, imageUrl: manualImage.get(id) || null, manual: true });
  }
  return { items: rows, lastRunAt: state.lastRunAt || null, lastListSyncAt: state.lastListSyncAt || null };
});
ipcMain.handle("add-wishlist-link", (event, url, imageUrl) => {
  const id = parseWishlistLink(url);
  if (!id) return { ok: false, error: "메루카리 상품 링크가 아니에요(켄즈포스트 메루카리 링크나 jp.mercari.com 링크를 넣어주세요)" };
  addManual(WISHLIST_MANUAL_FILE, id, { imageUrl });
  // 예전에 삭제했던 상품을 다시 추가하면 숨김을 푼다
  const hiddenList = loadHidden(WISHLIST_HIDDEN_FILE).filter((h) => h !== id);
  fs.writeFileSync(WISHLIST_HIDDEN_FILE, JSON.stringify(hiddenList, null, 2));
  // 30분 주기를 기다리지 않고 가격 확인을 바로 한 번 돌린다 - 새로 넣은 상품의 가격·사진(Shops 상품은
  // 사진 주소를 확인해야 알 수 있다)이 1분 안에 채워지고, 끝나면 찜 화면이 알아서 새로 그려진다.
  require("child_process").execFile("launchctl", ["kickstart", `gui/${process.getuid()}/com.collectroom.wishlist-watch`], () => {});
  return { ok: true, id };
});
// 찜 삭제: 직접 추가한 건 목록에서 빼고, 켄즈포스트에서 온 건 다시 동기화돼도 안 보이게 숨긴다.
ipcMain.handle("remove-wishlist-link", (event, id) => {
  removeManual(WISHLIST_MANUAL_FILE, id);
  hideItem(WISHLIST_HIDDEN_FILE, id);
});

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

// ---- 매입 검색 (메루카리 검색 API를 앱에서 직접) ----
let searchSigner = null;
let searchFacets = null;
const facets = () => (searchFacets ||= loadFacets(path.join(REPO_DIR, "facets")));
ipcMain.handle("mercari-search", async (event, conditions) => {
  searchSigner ||= createSigner();
  try {
    return { ok: true, ...(await searchMercari(searchSigner, conditions)) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle("search-brands", (event, query) => searchBrands(facets().brands, query));
// 알림 필터의 브랜드 이름들을 한 번에 메루카리 브랜드(id)로
ipcMain.handle("resolve-brands", (event, names) => {
  const byName = new Map(facets().brands.map((b) => [b.name.toLowerCase(), b]));
  return names.map((n) => byName.get(String(n).toLowerCase())).filter(Boolean).map(({ id, name }) => ({ id, name }));
});
ipcMain.handle("men-categories", () => menCategoryTree(facets().categories));
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

ipcMain.handle("ledger-export", async () => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "가계부 백업 내보내기",
    defaultPath: path.join(app.getPath("downloads"), `가계부_백업_${today}.json`),
    filters: [{ name: "가계부 백업", extensions: ["json"] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    const backup = exportLedgerBackup(LEDGER_FILE);
    fs.writeFileSync(filePath, JSON.stringify(backup, null, 2));
    return { ok: true, transactionCount: backup.transactions.length, fileName: path.basename(filePath) };
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
// ───────── 파일 관리 창 ─────────
// 업로드전 상품마다 탭 하나. 탭 = ~/Desktop/업로드 파일/<제품명>/ 폴더(item.uploadFolder).
// 넘기기(item.uploadFinishedAt)를 하면 폴더는 업로드 완료로 가고 탭이 사라진다.
const UPLOAD_ROOT = path.join(app.getPath("desktop"), "업로드 파일");
const UPLOAD_DONE_ROOT = path.join(app.getPath("desktop"), "업로드 완료");
let filesWindow = null;
const thumbCache = new Map();

function notifyFilesWindow() {
  if (filesWindow && !filesWindow.isDestroyed()) filesWindow.webContents.send("files-changed");
}

function openFilesWindow() {
  if (filesWindow && !filesWindow.isDestroyed()) {
    filesWindow.show();
    filesWindow.focus();
    return;
  }
  filesWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    title: "파일 관리",
    icon: APP_ICON_PATH,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#F5F5F4",
    webPreferences: { preload: path.join(__dirname, "files-preload.js") },
  });
  filesWindow.loadFile("files.html");
  filesWindow.on("closed", () => {
    filesWindow = null;
  });
}

function isTabItem(i) {
  return !i.uploadFinishedAt && (i.status === "업로드전" || i.uploadTabOpen);
}

function folderDir(item) {
  return item.uploadFolder ? path.join(UPLOAD_ROOT, item.uploadFolder) : null;
}

function tabItem(id) {
  const item = loadItems(DB_FILE).find((i) => i.id === id);
  if (!item) throw new Error("상품을 찾을 수 없어요.");
  return item;
}

// 한꺼번에 넣은 사진이 Claude 분류를 기다리거나, 분류 못 한 채 남는 보관함.
// 바탕화면을 어지럽히지 않게 앱 데이터 폴더에 둔다.
const UNSORTED_ID = "unsorted";
const UNSORTED_DIR = path.join(app.getPath("userData"), "unsorted");

// 태그 사진 보관함: 오른쪽 칸에 쌓아 두고, 사용자가 제품 탭으로 끌어다 배정한다(Claude가 찾지 않음).
const TAGS_ID = "tags";
const TAGS_DIR = path.join(app.getPath("userData"), "tags");

function photoDir(id) {
  if (id === UNSORTED_ID) {
    fs.mkdirSync(UNSORTED_DIR, { recursive: true });
    return UNSORTED_DIR;
  }
  if (id === TAGS_ID) {
    fs.mkdirSync(TAGS_DIR, { recursive: true });
    return TAGS_DIR;
  }
  return tabDir(id);
}

function tabDir(id) {
  const dir = folderDir(tabItem(id));
  if (!dir) throw new Error("먼저 제품명을 입력해서 폴더를 만들어주세요.");
  return dir;
}

function cleanName(name) {
  const n = String(name || "").normalize("NFC").replace(/[\/:]/g, " ").replace(/\s+/g, " ").trim();
  if (!n || n.startsWith(".")) throw new Error("제품명을 입력해주세요.");
  return n;
}

ipcMain.handle("open-files-window", () => openFilesWindow());

ipcMain.handle("files-list", () => {
  const items = loadItems(DB_FILE);
  const tabs = items
    .filter(isTabItem)
    .sort((a, b) => (a.statusChangedAt || a.createdAt).localeCompare(b.statusChangedAt || b.createdAt))
    .map((i) => {
      const dir = folderDir(i);
      const exists = !!dir && fs.existsSync(dir);
      const listing = exists ? uploadFiles.readListing(dir, i.uploadFolder) : { hasTxt: false, size: "", defects: [] };
      return {
        id: i.id,
        mercariTitle: i.title,
        imageUrl: i.imageUrl,
        sourceUrl: i.sourceUrl,
        status: i.status,
        folder: i.uploadFolder || null,
        folderExists: exists,
        photos: exists ? uploadFiles.listPhotos(dir) : { thumbs: [], numbered: [], others: [] },
        hasTxt: listing.hasTxt,
        size: listing.hasTxt ? listing.size : i.uploadSize || "",
        defects: listing.hasTxt ? listing.defects : i.uploadDefects || [],
        materials: listing.hasTxt ? listing.materials : i.uploadMaterials || [],
        fruitsUploadedAt: i.fruitsUploadedAt || null,
        instaUploadedAt: i.instaUploadedAt || null,
        nameTried: !!i.uploadNameTriedAt,
      };
    });
  const linked = new Set(items.filter((i) => !i.uploadFinishedAt).map((i) => i.uploadFolder).filter(Boolean));
  const freeFolders = fs.existsSync(UPLOAD_ROOT)
    ? fs
        .readdirSync(UPLOAD_ROOT, { withFileTypes: true })
        .map((d) => ({ dir: d.isDirectory(), name: d.name.normalize("NFC") }))
        .filter((d) => d.dir && !d.name.startsWith(".") && !linked.has(d.name))
        .map((d) => d.name)
    : [];
  const unsorted = fs.existsSync(UNSORTED_DIR) ? fs.readdirSync(UNSORTED_DIR).filter(uploadFiles.isImage).sort() : [];
  const tags = fs.existsSync(TAGS_DIR) ? fs.readdirSync(TAGS_DIR).filter(uploadFiles.isImage).sort() : [];
  return { tabs, freeFolders, unsorted, tags, job: sortJob };
});

// 원본 사진이 2~12MB라 그대로 띄우면 무겁다 - 맥 미리보기(QuickLook) 썸네일을 만들어 쓴다.
ipcMain.handle("files-thumb", async (event, id, name) => {
  const p = path.join(photoDir(id), path.basename(name));
  const stat = fs.statSync(p);
  const key = `${p}|${stat.mtimeMs}|${stat.size}`;
  if (!thumbCache.has(key)) {
    // 미리보기(QuickLook) 썸네일은 정사각 틀에 여백을 채워서 나와 원래 비율이 안 보인다.
    // 원본을 직접 열어서 높이 400으로 줄인다(처음 한 번만 무겁고 이후엔 캐시).
    let img = nativeImage.createFromPath(p);
    if (img.isEmpty()) img = await nativeImage.createThumbnailFromPath(p, { width: 400, height: 400 });
    else img = img.resize({ height: 400, quality: "good" });
    thumbCache.set(key, img.toJPEG(82).length ? "data:image/jpeg;base64," + img.toJPEG(82).toString("base64") : img.toDataURL());
  }
  return thumbCache.get(key);
});

ipcMain.handle("files-set-name", (event, id, rawName) => assignName(id, rawName));

function assignName(id, rawName) {
  const name = cleanName(rawName);
  const item = tabItem(id);
  const taken = loadItems(DB_FILE).some((i) => i.id !== id && i.uploadFolder === name && !i.uploadFinishedAt);
  if (taken) throw new Error(`"${name}" 폴더는 다른 상품이 쓰고 있어요.`);
  const target = path.join(UPLOAD_ROOT, name);
  const current = folderDir(item);
  if (current && fs.existsSync(current) && item.uploadFolder !== name) {
    uploadFiles.renameProduct(UPLOAD_ROOT, item.uploadFolder, name);
  } else if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  updateItem(DB_FILE, id, { uploadFolder: name });
  return name;
}

ipcMain.handle("files-save-listing", (event, id, edits) => {
  // 사용자가 소재 칸을 직접 고치면 이후 자동 읽기가 덮어쓰지 않게 표시한다.
  if (edits.materials != null) updateItem(DB_FILE, id, { uploadMaterialsAuto: false });
  return saveListing(id, edits);
});

// 실측/소재/하자 저장. 앱에도 저장하고, 폴더가 있으면 txt에 반영한다. txt가 아직 없으면
// 지금까지 입력된 값으로 사용자 양식의 txt를 새로 만든다(가격은 재고앱 판매가).
function saveListing(id, edits) {
  const patch = {};
  if (edits.size != null) patch.uploadSize = edits.size;
  if (edits.defects != null) patch.uploadDefects = edits.defects;
  if (edits.materials != null) patch.uploadMaterials = edits.materials;
  const item = updateItem(DB_FILE, id, patch);
  const dir = folderDir(item);
  if (!dir || !fs.existsSync(dir)) return true;
  if (!uploadFiles.writeListing(dir, item.uploadFolder, edits)) ensureListing(item);
  return true;
}

function ensureListing(item) {
  const dir = folderDir(item);
  if (!dir || !fs.existsSync(dir)) return false;
  if (uploadFiles.readListing(dir, item.uploadFolder).hasTxt) return false;
  const text = uploadFiles.buildListing({
    productName: item.uploadFolder,
    size: item.uploadSize || "",
    materials: item.uploadMaterials || [],
    defects: item.uploadDefects || [],
    price: item.listPrice ?? item.targetPrice ?? null,
    isShoes: photoshop.fitKind(item.uploadFolder) === "shoes",
  });
  fs.writeFileSync(path.join(dir, `${item.uploadFolder}.txt`), text);
  return true;
}

ipcMain.handle("files-open-txt", (event, id) => {
  const item = tabItem(id);
  const dir = tabDir(id);
  ensureListing(item);
  return shell.openPath(uploadFiles.txtPath(dir, item.uploadFolder));
});

ipcMain.handle("files-reorder", (event, id, names) => {
  uploadFiles.reorderPhotos(tabDir(id), names.map((n) => path.basename(n)));
  return true;
});

ipcMain.handle("files-move", (event, fromId, name, toId) => {
  // 태그 보관함 → 제품 탭: 소재 라벨로 저장하고, 그 제품의 소재를 읽는다.
  if (fromId === TAGS_ID && toId !== TAGS_ID && toId !== UNSORTED_ID) {
    const saved = uploadFiles.placePhoto(tabDir(toId), path.join(TAGS_DIR, path.basename(name)), "소재");
    let reading = true;
    try {
      startMaterialRead(toId);
    } catch (e) {
      reading = false; // 다른 작업 중 - 탭의 '태그에서 소재 읽기'로 다시 할 수 있다
    }
    return { saved, reading };
  }
  // 미분류에서 꺼낸 사진은 원래 파일 이름(IMG_1234 등)이라 받는 쪽 다음 번호로 붙인다.
  if (fromId === UNSORTED_ID) return uploadFiles.placePhoto(tabDir(toId), path.join(UNSORTED_DIR, path.basename(name)));
  return uploadFiles.movePhoto(tabDir(fromId), path.basename(name), photoDir(toId));
});

ipcMain.handle("files-add", (event, id, paths) => uploadFiles.addPhotos(tabDir(id), paths));

// 사진 블럭의 ✕: 바로 지우지 않고 휴지통으로 보낸다(되살릴 수 있게). 번호 사진이면 남은 번호를 다시 매긴다.
ipcMain.handle("files-delete-photo", async (event, id, name) => {
  const dir = photoDir(id);
  const p = path.join(dir, path.basename(name));
  if (!fs.existsSync(p)) return false;
  await shell.trashItem(p);
  if (id !== UNSORTED_ID && id !== TAGS_ID && /^\d+\.[^.]+$/.test(path.basename(name))) uploadFiles.compactNumbers(dir);
  return true;
});

ipcMain.handle("files-open-photo", (event, id, name) => shell.openPath(path.join(photoDir(id), path.basename(name))));

ipcMain.handle("files-open-folder", (event, id) => shell.openPath(tabDir(id)));

ipcMain.handle("files-finish", (event, id) => {
  const item = tabItem(id);
  if (item.uploadFolder) uploadFiles.finishProduct(UPLOAD_ROOT, UPLOAD_DONE_ROOT, item.uploadFolder);
  updateItem(DB_FILE, id, { uploadFinishedAt: new Date().toISOString() });
  return true;
});

// ───────── 2단계: Claude가 사진 분류 / 실측 읽기 / 제품명 제안 ─────────
let sortJob = null; // { running, kind, message, startedAt, finishedAt, error }

function setJob(patch) {
  sortJob = { ...(sortJob || {}), ...patch };
  notifyFilesWindow();
}

function sips(src, out, max) {
  return new Promise((resolve, reject) =>
    execFile("/usr/bin/sips", ["-Z", String(max), "-s", "format", "jpeg", src, "--out", out], (e) => (e ? reject(e) : resolve()))
  );
}

async function download(url, out) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
}

// 실착(3:4) 사진을 흰 정사각형 가운데에 넣어 후루츠 썸네일(1:1)을 만든다 - 기존 후루츠 썸네일과 같은 방식
// (예: 3024×4032 → 4032×4032, 좌우 흰 여백). HEIC는 sips로 JPEG로 바꾼 뒤, 사진 방향(EXIF)은
// 브라우저 엔진이 바로잡게 숨은 창의 캔버스에서 그린다.
async function makeSquareThumb(src, out) {
  const tmp = path.join(app.getPath("temp"), `sq-${Date.now()}.jpg`);
  await new Promise((resolve, reject) =>
    execFile("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "100", src, "--out", tmp], (e) => (e ? reject(e) : resolve()))
  );
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL("data:text/html,<html></html>");
    const dataUrl = "data:image/jpeg;base64," + fs.readFileSync(tmp).toString("base64");
    const result = await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.max(img.naturalWidth, img.naturalHeight);
        const c = document.createElement("canvas"); c.width = s; c.height = s;
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, s, s);
        g.drawImage(img, (s - img.naturalWidth) / 2, (s - img.naturalHeight) / 2);
        ok(c.toDataURL("image/jpeg", 0.95));
      };
      img.onerror = () => fail(new Error("사진을 읽지 못했어요"));
      img.src = ${JSON.stringify(dataUrl)};
    })`);
    fs.writeFileSync(out, Buffer.from(result.split(",")[1], "base64"));
  } finally {
    win.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

// 실착 사진이 들어오면: 인스타 썸네일이 아직 없으면 그 사진을 인스타 썸네일(JPEG)로 두고,
// 후루츠 썸네일(1:1)도 같이 만든다. 이미 썸네일이 있으면 그냥 "착용.jpg"로 둔다.
async function placeWornPhoto(dir, src) {
  const has = (name) => uploadFiles.listPhotos(dir).thumbs.some((n) => n.replace(/\.[^.]+$/, "").normalize("NFC") === name);
  if (has("인스타 썸네일")) return uploadFiles.placePhoto(dir, src, "착용");
  const insta = path.join(dir, "인스타 썸네일.jpg");
  if (/\.jpe?g$/i.test(src)) fs.renameSync(src, insta);
  else {
    await new Promise((resolve, reject) =>
      execFile("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "high", src, "--out", insta], (e) => (e ? reject(e) : resolve()))
    );
    fs.rmSync(src, { force: true });
  }
  if (!has("후루츠 썸네일")) await makeSquareThumb(insta, path.join(dir, "후루츠 썸네일.jpg"));
  return "인스타 썸네일.jpg";
}

// 탭의 '실착' 칸: 그 제품의 실착 사진으로 바로 인스타 썸네일 + 후루츠 썸네일(1:1)을 만든다(Claude 없음).
// replace면 기존 썸네일 두 장은 휴지통으로 보내고 새로 만든다. 두 번째 사진부터는 착용.jpg.
ipcMain.handle("files-add-worn", async (event, id, paths, replace) => {
  const dir = tabDir(id);
  const imgs = paths.filter((p) => uploadFiles.isImage(path.basename(p)));
  if (!imgs.length) throw new Error("사진 파일이 없어요.");
  if (replace) {
    for (const n of uploadFiles.listPhotos(dir).thumbs) await shell.trashItem(path.join(dir, n));
  }
  const tmpDir = fs.mkdtempSync(path.join(app.getPath("temp"), "worn-"));
  try {
    const out = [];
    for (const src of imgs) {
      const copy = path.join(tmpDir, path.basename(src));
      fs.copyFileSync(src, copy);
      out.push(await placeWornPhoto(dir, copy));
    }
    return out;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 탭의 '실측' 칸: 사진을 실측.jpg로 넣고, Claude가 그 사진만 보고 사이즈 줄을 만든다.
const MEASURE_SCHEMA = {
  type: "object",
  properties: { size: { type: ["string", "null"] }, problem: { type: ["string", "null"] } },
  required: ["size", "problem"],
};

ipcMain.handle("files-add-measure", (event, id, paths) => {
  const dir = tabDir(id);
  const imgs = paths.filter((p) => uploadFiles.isImage(path.basename(p)));
  if (!imgs.length) throw new Error("사진 파일이 없어요.");
  const placed = imgs.map((src) => {
    const tmp = path.join(app.getPath("temp"), `m-${Date.now()}-${path.basename(src)}`);
    fs.copyFileSync(src, tmp);
    return uploadFiles.placePhoto(dir, tmp, "실측");
  });
  const item = tabItem(id);
  return startTask(`${item.uploadFolder} 실측 읽는 중…`, async () => {
    const runDir = path.join(app.getPath("userData"), "measure-runs", String(Date.now()));
    fs.mkdirSync(runDir, { recursive: true });
    try {
      const files = [];
      for (const [k, n] of placed.entries()) {
        const f = `m${k + 1}.jpg`;
        await sips(path.join(dir, n), path.join(runDir, f), 2000);
        files.push(f);
      }
      const current = uploadFiles.readListing(dir, item.uploadFolder);
      const prompt = [
        `옷 실측 사진 ${files.join(", ")} 을 Read로 보고(여러 장이면 동시에 열어) 사이즈 줄 하나를 만들어. 결과는 JSON으로만.`,
        "실측 사진은 줄자를 대고 찍었거나 치수를 손글씨/메모로 적은 사진이야. 보이는 숫자만 쓰고, 안 읽히는 건 지어내지 마.",
        "형식: 상의 `M (어깨 46.5 / 가슴 55 / 소매 66.5 / 총장 68)`, 바지 `30 (허리 40.5 / 밑위 24 / 허벅지 27 / 총장 100 / 밑단 17.5)`. 래글런 소매면 `소매 74.5(래글런)`.",
        `맨 앞 사이즈 표기는 사진에 있으면 그걸, 없으면 지금 사이즈 줄(${current.size || "없음"})이나 메루카리 제목(${item.title})에서 가져와. 그래도 없으면 숫자 괄호 부분만.`,
        "숫자를 하나도 못 읽으면 size는 null, problem에 이유.",
      ].join("\n");
      const { output } = await runClaude({ prompt, cwd: runDir, schema: MEASURE_SCHEMA });
      // 숫자가 하나도 없는 답(예: "M"만)은 실측을 못 읽은 것으로 보고 저장하지 않는다.
      if (!output.size || !/\d/.test(output.size.replace(/^\S+\s*/, ""))) {
        return `${item.uploadFolder}: 실측 숫자를 못 읽었어요${output.problem ? ` (${output.problem})` : ""}. 다시 넣어보거나 직접 입력해주세요.`;
      }
      saveListing(id, { size: output.size });
      return `${item.uploadFolder} 실측: ${output.size}`;
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});

ipcMain.handle("files-make-fruits-thumb", async (event, id) => {
  const dir = tabDir(id);
  const insta = uploadFiles.listPhotos(dir).thumbs.find((n) => n.replace(/\.[^.]+$/, "").normalize("NFC") === "인스타 썸네일");
  if (!insta) throw new Error("인스타 썸네일(실착 사진)이 없어요.");
  await makeSquareThumb(path.join(dir, insta), path.join(dir, "후루츠 썸네일.jpg"));
  return true;
});

// 태그 사진 칸에 떨군 사진: 원본은 두고 보관함에 복사만 한다.
ipcMain.handle("files-add-tags", (event, paths) => {
  fs.mkdirSync(TAGS_DIR, { recursive: true });
  let n = 0;
  for (const src of paths) {
    if (!uploadFiles.isImage(path.basename(src))) continue;
    let target = path.join(TAGS_DIR, path.basename(src));
    for (let i = 2; fs.existsSync(target); i++) {
      const { name, ext } = path.parse(src);
      target = path.join(TAGS_DIR, `${name} ${i}${ext}`);
    }
    fs.copyFileSync(src, target);
    n++;
  }
  notifyFilesWindow();
  return n;
});

ipcMain.handle("files-read-materials", (event, id) => startMaterialRead(id));

// 제품 폴더의 소재 라벨 사진(소재.jpg, 소재 2.jpg …)을 Claude가 읽어 소재 칸을 채운다.
// 사용자가 직접 고친 소재(uploadMaterialsAuto가 false)는 덮어쓰지 않는다.
const MATERIAL_SCHEMA = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" } }, problem: { type: ["string", "null"] } },
  required: ["lines", "problem"],
};

function startMaterialRead(id) {
  const item = tabItem(id);
  const dir = tabDir(id);
  const labels = fs.readdirSync(dir).filter((n) => uploadFiles.isImage(n) && n.normalize("NFC").startsWith("소재"));
  if (!labels.length) throw new Error("이 제품에 소재 라벨 사진이 없어요.");
  return startTask(`${item.uploadFolder} 소재 읽는 중…`, async () => {
    const runDir = path.join(app.getPath("userData"), "material-runs", String(Date.now()));
    fs.mkdirSync(runDir, { recursive: true });
    try {
      const files = [];
      for (const [k, n] of labels.entries()) {
        const f = `t${k + 1}.jpg`;
        await sips(path.join(dir, n), path.join(runDir, f), 2000);
        files.push(f);
      }
      const prompt = [
        `옷의 세탁·소재 라벨 사진 ${files.join(", ")} 을 Read로 보고 소재(혼용률) 줄을 만들어. 결과는 JSON으로만.`,
        "lines: 앞의 '·' 없이 한 줄씩. 일본어·영어 소재명은 한국어로(表地=겉감, 裏地=안감, 綿=면, ポリエステル=폴리에스터, ポリウレタン=폴리우레탄, ナイロン=나일론, 毛=울, 牛革=소가죽, レーヨン=레이온, アクリル=아크릴, リブ部分=립, 別生地=배색 등). 부위 이름은 '립', '배색'처럼 짧게(립 부분 X).",
        "부위가 나뉘면(겉감/안감/립/배색 등) 부위마다 한 줄에 성분을 이어서: `겉감 면 97% 폴리우레탄 3%`.",
        "부위가 안 나뉘면 성분마다 한 줄, 부위 이름 없이: `면 97%`, `폴리우레탄 3%`. 성분 이름은 줄이지 마.",
        "소재 표시가 안 보이거나 숫자가 안 읽히면 지어내지 말고 lines는 빈 배열, problem에 이유.",
      ].join("\n");
      const { output } = await runClaude({ prompt, cwd: runDir, schema: MATERIAL_SCHEMA });
      const cleaned = photoSort.cleanMaterials({ materials: [{ productId: id, lines: output.lines || [] }] }, [id]);
      if (!cleaned.length) return `${item.uploadFolder}: 소재를 못 읽었어요${output.problem ? ` (${output.problem})` : ""}.`;
      const fresh = tabItem(id);
      const current = uploadFiles.readListing(dir, fresh.uploadFolder);
      const existing = current.hasTxt ? current.materials : fresh.uploadMaterials || [];
      if (existing.length && fresh.uploadMaterialsAuto === false) {
        return `${fresh.uploadFolder}: 직접 쓴 소재가 있어서 안 바꿨어요. 읽은 값: ${cleaned[0].lines.join(" / ")}`;
      }
      saveListing(id, { materials: cleaned[0].lines });
      updateItem(DB_FILE, id, { uploadMaterialsAuto: true });
      return `${fresh.uploadFolder} 소재: ${cleaned[0].lines.join(" / ")}`;
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
}

// 파인더에서 "한꺼번에 넣기" 칸에 떨군 사진: 원본은 그대로 두고 미분류 보관함에 복사한 뒤 분류를 시작한다.
ipcMain.handle("files-add-unsorted", (event, paths) => {
  fs.mkdirSync(UNSORTED_DIR, { recursive: true });
  let n = 0;
  for (const src of paths) {
    if (!uploadFiles.isImage(path.basename(src))) continue;
    let target = path.join(UNSORTED_DIR, path.basename(src));
    for (let i = 2; fs.existsSync(target); i++) {
      const { name, ext } = path.parse(src);
      target = path.join(UNSORTED_DIR, `${name} ${i}${ext}`);
    }
    fs.copyFileSync(src, target);
    n++;
  }
  notifyFilesWindow();
  if (n) startSortJob();
  return n;
});

ipcMain.handle("files-sort", () => startSortJob());
ipcMain.handle("files-suggest-names", () => startSortJob({ namesOnly: true }));

// Claude/포토샵 작업은 한 번에 하나만. 진행 상황은 파일 관리 창 왼쪽에 뜬다.
function startTask(message, fn) {
  if (sortJob && sortJob.running) throw new Error("다른 작업이 진행 중이에요. 끝나고 다시 눌러주세요.");
  setJob({ running: true, message, startedAt: Date.now(), error: null });
  fn()
    .then((msg) => setJob({ running: false, message: msg, finishedAt: Date.now() }))
    .catch((e) => setJob({ running: false, error: e.message, message: null, finishedAt: Date.now() }));
  return true;
}

function selectedTabs(ids) {
  const items = loadItems(DB_FILE).filter((i) => ids.includes(i.id) && isTabItem(i));
  const noFolder = items.filter((i) => !folderDir(i) || !fs.existsSync(folderDir(i)));
  if (noFolder.length) throw new Error(`제품명(폴더)이 없는 제품이 있어요: ${noFolder.map((i) => i.title).join(", ").slice(0, 60)}`);
  return items;
}

// 포토샵 배경 제작(선택 없음): 지금 포토샵에 열린 사진 전부에 배경 레이어를 깐다.
ipcMain.handle("files-ps-background", () => {
  return startTask("포토샵 사진에 배경 까는 중…", async () => {
    const [made, skipped, errs] = (await photoshop.runJsx(photoshop.backgroundOpenJsx())).split("|");
    if (!Number(made) && !Number(skipped) && !errs) return "포토샵에 열린 사진이 없어요.";
    return `배경 ${made}장 깔았어요${Number(skipped) ? ` (이미 있던 ${skipped}장 건너뜀)` : ""}. 앞·뒤 누끼를 따고 '크기 조정'을 눌러주세요.${errs ? ` 오류: ${errs}` : ""}`;
  });
});

// 일괄 저장: 포토샵에 열린 문서를 전부 JPEG(품질 12)로 저장한다.
//  - 제품 폴더에서 연 사진은 그 폴더에 그대로(N.jpg, 번호 없던 건 다음 번호) 저장
//  - 그 밖의 사진(에어드롭 등)은 미분류에 저장하고 닫은 뒤, Claude가 제품별로 나눈다
ipcMain.handle("files-ps-saveall", async () => {
  const docs = await photoshop.openDocPaths();
  if (!docs.length) throw new Error("포토샵에 열린 사진이 없어요.");
  const items = loadItems(DB_FILE).filter((i) => isTabItem(i) && folderDir(i) && fs.existsSync(folderDir(i)));
  fs.mkdirSync(UNSORTED_DIR, { recursive: true });
  const jobs = [];
  const nextNo = new Map();
  const takenUnsorted = new Set();
  for (const src of docs) {
    const d = path.dirname(src);
    const owner = items.find((i) => d === folderDir(i) || d === path.join(folderDir(i), "원본"));
    if (owner) {
      const dir = folderDir(owner);
      const m = /^(\d+)\.[^.]+$/.exec(path.basename(src));
      let n;
      if (m) n = Number(m[1]);
      else {
        if (!nextNo.has(dir)) {
          const nums = uploadFiles.listPhotos(dir).numbered.map((x) => parseInt(x, 10));
          nextNo.set(dir, (nums.length ? Math.max(...nums) : 0) + 1);
        }
        n = nextNo.get(dir);
        nextNo.set(dir, n + 1);
      }
      jobs.push({ src, out: path.join(dir, `${n}.jpg`), fit: null, dir });
    } else {
      let base = path.parse(src).name;
      let out = path.join(UNSORTED_DIR, `${base}.jpg`);
      for (let k = 2; fs.existsSync(out) || takenUnsorted.has(out); k++) out = path.join(UNSORTED_DIR, `${base} ${k}.jpg`);
      takenUnsorted.add(out);
      jobs.push({ src, out, fit: null, close: true });
    }
  }
  return startTask(`포토샵 사진 ${jobs.length}장 저장하는 중…`, async () => {
    for (const j of jobs) {
      if (j.dir && j.src === j.out) {
        const keep = path.join(j.dir, "원본", path.basename(j.src));
        fs.mkdirSync(path.dirname(keep), { recursive: true });
        if (!fs.existsSync(keep)) fs.copyFileSync(j.src, keep);
      }
    }
    const [saved, errs] = (await photoshop.runJsx(photoshop.fitAndSaveJsx(jobs.map(({ src, out, fit, close }) => ({ src, out, fit, close }))))).split("|");
    for (const j of jobs) {
      if (j.dir && j.src !== j.out && path.dirname(j.src) === j.dir && fs.existsSync(j.out) && fs.existsSync(j.src)) {
        fs.mkdirSync(path.join(j.dir, "원본"), { recursive: true });
        fs.renameSync(j.src, path.join(j.dir, "원본", path.basename(j.src)));
      }
    }
    const inFolder = jobs.filter((j) => j.dir).length;
    const toSort = jobs.filter((j) => !j.dir && fs.existsSync(j.out)).length;
    let msg = `저장 ${saved ? saved.split(",").length : 0}장 (제품 폴더 ${inFolder}, 미분류 ${toSort})${errs ? ` · 오류: ${errs}` : ""}`;
    if (toSort) {
      setJob({ message: `저장 끝. 미분류 ${toSort}장 Claude가 나누는 중…` });
      msg += ` · ${await runSortJob({ namesOnly: false })}`;
    }
    return msg;
  });
});

// 크기 조정(선택 없음): 포토샵에 열린 사진 중 누끼(레이어 마스크)를 딴 것만 종류별 비율로 가운데 맞춘다.
// 종류는 제품 폴더에서 연 사진이면 제품명으로, 아니면 Claude가 사진을 보고 정한다. 저장은 '일괄 저장'.
const KIND_SCHEMA = {
  type: "object",
  properties: {
    kinds: {
      type: "array",
      items: {
        type: "object",
        properties: { file: { type: "string" }, kind: { type: "string", enum: ["jacket", "hooded", "coat", "pants", "shoes"] } },
        required: ["file", "kind"],
      },
    },
  },
  required: ["kinds"],
};

ipcMain.handle("files-ps-fit", () => {
  return startTask("누끼 딴 사진 찾는 중…", async () => {
    const info = await photoshop.runJsx(photoshop.docsInfoJsx());
    const docs = info
      ? info.split("\n").map((l) => {
          const [index, p, mask, name] = l.split("\t");
          return { index: Number(index), path: (p || "").normalize("NFC"), masked: mask === "1", name };
        })
      : [];
    if (!docs.length) return "포토샵에 열린 사진이 없어요.";
    const masked = docs.filter((d) => d.masked);
    if (!masked.length) return "누끼(레이어 마스크)를 딴 사진이 없어요.";

    const items = loadItems(DB_FILE).filter((i) => isTabItem(i) && folderDir(i));
    const unknown = [];
    for (const d of masked) {
      const dir = d.path ? path.dirname(d.path) : "";
      const owner = items.find((i) => dir === folderDir(i) || dir === path.join(folderDir(i), "원본"));
      if (owner) d.kind = photoshop.fitKind(owner.uploadFolder);
      else unknown.push(d);
    }
    if (unknown.length) {
      setJob({ message: `사진 ${unknown.length}장 옷 종류 보는 중…` });
      const runDir = path.join(app.getPath("userData"), "fit-runs", String(Date.now()));
      fs.mkdirSync(runDir, { recursive: true });
      try {
        await photoshop.runJsx(photoshop.previewJsx(unknown.map((d, k) => ({ index: d.index, out: path.join(runDir, `d${k + 1}.jpg`) }))));
        const files = unknown.map((d, k) => `d${k + 1}.jpg`);
        const { output } = await runClaude({
          prompt: `옷 사진 ${files.join(", ")} 을 Read로 보고 각각 종류를 골라. jacket=자켓·블루종·베스트·셔츠 등 상의, hooded=후드 달린 상의, coat=엉덩이 아래로 내려오는 코트·파카·트렌치, pants=바지, shoes=신발. JSON으로만 답해.`,
          cwd: runDir,
          schema: KIND_SCHEMA,
          model: "haiku",
        });
        for (const [k, d] of unknown.entries()) {
          const r = (output.kinds || []).find((x) => x.file === files[k]);
          d.kind = r ? r.kind : "jacket";
        }
      } finally {
        fs.rmSync(runDir, { recursive: true, force: true });
      }
    }
    setJob({ message: `사진 ${masked.length}장 크기 맞추는 중…` });
    const [ok, errs] = (await photoshop.runJsx(photoshop.fitOpenJsx(masked.map((d) => ({ index: d.index, fit: photoshop.FIT[d.kind] }))))).split("|");
    const kinds = masked.map((d) => `${d.name.replace(/\.[^.]+$/, "")}=${photoshop.FIT_LABEL[d.kind]}`).join(", ");
    return `${ok}장 맞췄어요 (${kinds}). 확인하고 '일괄 저장'을 눌러주세요.${errs ? ` 오류: ${errs}` : ""}`;
  });
});

// ───────── 3단계: 후루츠 / 인스타 업로드 ─────────
// platforms: ["fruits"], ["insta"], ["fruits","insta"]. 제품마다 차례로 Claude를 불러 크롬으로 올린다.
// 후루츠에 올라가면 재고앱에서 판매중으로, 두 곳 다 끝나면 폴더를 업로드 완료로 옮기고 탭을 닫는다.
const PLATFORM_LABEL = { fruits: "후루츠", insta: "인스타" };

ipcMain.handle("files-upload", (event, ids, platforms) => {
  const items = selectedTabs(ids);
  for (const i of items) {
    const listing = uploadFiles.readListing(folderDir(i), i.uploadFolder);
    if (!listing.hasTxt) throw new Error(`설명 글(txt)이 없어요: ${i.uploadFolder}`);
  }
  return startTask("업로드 준비 중…", async () => {
    // 작업 목록: 제품마다 고른 플랫폼 순서대로. 이미 올린 건 뺀다.
    const tasks = [];
    const skipped = [];
    let chromeWasRunning = null;
    const runDir = path.join(app.getPath("userData"), "upload-runs", String(Date.now()));
    fs.mkdirSync(runDir, { recursive: true });
    try {
      for (const it of items) {
        const item = tabItem(it.id);
        const dir = folderDir(item);
        const text = fs.readFileSync(path.join(dir, `${item.uploadFolder}.txt`), "utf-8");
        for (const platform of platforms) {
          const label = `${PLATFORM_LABEL[platform]} · ${item.uploadFolder}`;
          if ((platform === "fruits" && item.fruitsUploadedAt) || (platform === "insta" && item.instaUploadedAt)) {
            skipped.push(`${label}(이미 올림)`);
            continue;
          }
          const names = listingUpload.photoOrder(uploadFiles.listPhotos(dir), platform);
          if (!names.length) {
            skipped.push(`${label}(사진 없음)`);
            continue;
          }
          // 크롬 파일 업로드는 한 번에 10MB까지라 긴 변 1920으로 줄인 사본을 올린다(원본은 그대로).
          const taskDir = path.join(runDir, String(tasks.length + 1));
          fs.mkdirSync(taskDir);
          const photoPaths = [];
          for (const [k, n] of names.entries()) {
            const out = path.join(taskDir, `${String(k + 1).padStart(2, "0")}.jpg`);
            await sips(path.join(dir, n), out, 1920);
            photoPaths.push(out);
          }
          tasks.push({ id: item.id, label, platform, productName: item.uploadFolder, text, photoPaths });
        }
      }
      if (!tasks.length) return skipped.join(", ") || "올릴 게 없어요.";

      // 크롬이 꺼져 있으면 Claude가 크롬을 못 쓴다 - 뒤에서 켜두고, 앱이 켠 거면 끝나고 다시 끈다.
      chromeWasRunning = await isChromeRunning();
      if (!chromeWasRunning) await new Promise((r) => execFile("/usr/bin/open", ["-g", "-a", "Google Chrome"], () => setTimeout(r, 5000)));
      // 한 번만 불러서 크롬 창 하나로 전부 처리하고, 끝나면 그 창을 닫게 한다.
      setJob({ message: `${tasks.length}건 올리는 중… (건당 3분 정도)` });
      const { output } = await runClaude({
        prompt: listingUpload.batchPrompt(tasks),
        cwd: runDir,
        schema: listingUpload.BATCH_SCHEMA,
        chrome: true,
        timeoutMs: (10 + tasks.length * 10) * 60 * 1000,
      });

      const done = [];
      const failed = [];
      tasks.forEach((t, k) => {
        const r = (output.results || []).find((x) => x.task === k + 1);
        if (r && r.uploaded) {
          markUploaded(t.id, t.platform, r.url || null);
          done.push(t.label);
        } else {
          failed.push(`${t.label}: ${(r && r.problem) || "결과 없음"}`);
        }
      });
      for (const it of items) finishIfBothDone(it.id);
      notifyMainWindow();
      return [done.length ? `올림: ${done.join(", ")}` : "", failed.length ? `못 올림: ${failed.join(" / ")}` : "", skipped.length ? `건너뜀: ${skipped.join(", ")}` : ""]
        .filter(Boolean)
        .join(" · ");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
      if (chromeWasRunning === false) execFile("/usr/bin/osascript", ["-e", 'tell application "Google Chrome" to quit'], () => {});
    }
  });
});

function isChromeRunning() {
  return new Promise((r) => execFile("/usr/bin/pgrep", ["-x", "Google Chrome"], (err) => r(!err)));
}

function markUploaded(id, platform, url) {
  const item = tabItem(id);
  const now = new Date().toISOString();
  if (platform === "insta") {
    updateItem(DB_FILE, id, { instaUploadedAt: now, instaUrl: url });
    return;
  }
  // 후루츠에 올라가는 순간 판매중. 판매가는 설명 글의 Price.
  const price = listingUpload.parsePrice(fs.readFileSync(path.join(folderDir(item), `${item.uploadFolder}.txt`), "utf-8"));
  const patch = { fruitsUploadedAt: now, fruitsUrl: url, uploadTabOpen: true };
  if (item.status === "업로드전") {
    Object.assign(patch, { status: "판매중", statusChangedAt: now, listedAt: now });
    const listed = price ?? item.listPrice ?? item.targetPrice;
    patch.listedPrice = listed;
    if (price) Object.assign(patch, { listPrice: price, listPriceEdited: true });
  }
  updateItem(DB_FILE, id, patch);
}

function finishIfBothDone(id) {
  const item = tabItem(id);
  if (!item.fruitsUploadedAt || !item.instaUploadedAt || item.uploadFinishedAt) return;
  uploadFiles.finishProduct(UPLOAD_ROOT, UPLOAD_DONE_ROOT, item.uploadFolder);
  updateItem(DB_FILE, id, { uploadFinishedAt: new Date().toISOString() });
}

function notifyMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("items-changed");
}

function startSortJob(opts = {}) {
  if (sortJob && sortJob.running) return false;
  setJob({ running: true, namesOnly: !!opts.namesOnly, message: opts.namesOnly ? "제품명 짓는 중…" : "사진 정리 준비 중…", startedAt: Date.now(), error: null });
  runSortJob(opts)
    .then((message) => setJob({ running: false, message, finishedAt: Date.now() }))
    .catch((e) => setJob({ running: false, error: e.message, message: null, finishedAt: Date.now() }));
  return true;
}

async function runSortJob({ namesOnly }) {
  const items = loadItems(DB_FILE).filter(isTabItem);
  if (!items.length) return "업로드전 상품이 없어요.";
  const unsortedFiles = namesOnly ? [] : (fs.existsSync(UNSORTED_DIR) ? fs.readdirSync(UNSORTED_DIR).filter(uploadFiles.isImage).sort() : []);
  const noName = items.filter((i) => !i.uploadFolder);
  if (namesOnly && !noName.length) return "제품명이 없는 상품이 없어요.";
  if (!namesOnly && !unsortedFiles.length) return "정리할 사진이 없어요.";

  // Claude에게 보여줄 작은 사본들(원본 2~12MB를 그대로 읽히면 느리고 비싸다)
  const runDir = path.join(app.getPath("userData"), "sort-runs", String(Date.now()));
  fs.mkdirSync(path.join(runDir, "merc"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "known"), { recursive: true });
  // 제품명만 지을 땐 이름 없는 상품만 보여준다.
  const shown = namesOnly ? noName : items;
  // 참고 사진(메루카리 사진·이미 정리된 앞면)은 작게 줄여 캐시해 두고 동시에 준비한다 - 매번 받고
  // 줄이느라 걸리던 시간을 없앤다. 메루카리 사진은 안 바뀌고, 앞면은 파일이 바뀌면 다시 만든다.
  const REF = path.join(app.getPath("userData"), "ref-cache");
  fs.mkdirSync(REF, { recursive: true });
  const products = await Promise.all(
    shown.map(async (i) => {
      const p = { id: i.id, mercariTitle: i.title, folder: i.uploadFolder || null, mercImage: "(없음)", knownImage: null };
      const mercCache = path.join(REF, `${i.id}-merc.jpg`);
      try {
        if (!fs.existsSync(mercCache)) {
          const raw = path.join(REF, `${i.id}-merc-raw`);
          await download(i.imageUrl, raw);
          await sips(raw, mercCache, 512);
          fs.rmSync(raw, { force: true });
        }
        fs.copyFileSync(mercCache, path.join(runDir, "merc", `${i.id}.jpg`));
        p.mercImage = `merc/${i.id}.jpg`;
      } catch (e) {}
      const dir = folderDir(i);
      const front = dir && fs.existsSync(dir) ? uploadFiles.listPhotos(dir).numbered[0] : null;
      if (front) {
        const st = fs.statSync(path.join(dir, front));
        const knownCache = path.join(REF, `${i.id}-front-${Math.round(st.mtimeMs)}-${st.size}.jpg`);
        try {
          if (!fs.existsSync(knownCache)) await sips(path.join(dir, front), knownCache, 512);
          fs.copyFileSync(knownCache, path.join(runDir, "known", `${i.id}.jpg`));
          p.knownImage = `known/${i.id}.jpg`;
        } catch (e) {}
      }
      return p;
    })
  );
  setJob({ message: namesOnly ? "제품명 짓는 중…" : `사진 ${unsortedFiles.length}장 보는 중…` });
  const photoMap = new Map(); // p001.jpg -> 원본 파일 이름
  unsortedFiles.forEach((f, idx) => photoMap.set(`p${String(idx + 1).padStart(3, "0")}.jpg`, f));
  await Promise.all([...photoMap].map(([short, f]) => sips(path.join(UNSORTED_DIR, f), path.join(runDir, short), 768)));
  const nameExamples = [
    ...loadItems(DB_FILE).map((i) => i.uploadFolder).filter(Boolean),
    ...(fs.existsSync(UPLOAD_DONE_ROOT) ? fs.readdirSync(UPLOAD_DONE_ROOT).map((n) => n.normalize("NFC")) : []),
  ].filter((n, k, a) => !n.startsWith(".") && a.indexOf(n) === k);

  const prompt = photoSort.buildPrompt({ products, photos: [...photoMap.keys()], nameExamples });
  const { output, costUsd } = await runClaude({ prompt, cwd: runDir, schema: photoSort.SCHEMA });
  // 나중에 잘못 나눈 걸 되짚을 수 있게 Claude 결과를 기록해 둔다.
  try {
    fs.appendFileSync(
      path.join(app.getPath("userData"), "sort-log.jsonl"),
      JSON.stringify({ at: new Date().toISOString(), photos: Object.fromEntries(photoMap), output, costUsd }) + "\n"
    );
  } catch (e) {}

  // 1) 이름 없는 상품에 폴더 만들기(사진을 넣으려면 폴더가 먼저 있어야 한다)
  const names = photoSort.cleanNames(output, noName.map((i) => i.id));
  for (const n of names) {
    try {
      assignName(n.productId, n.name);
    } catch (e) {
      // 이름이 겹치면 건너뛴다 - 사용자가 직접 입력
    }
  }
  for (const i of noName) updateItem(DB_FILE, i.id, { uploadNameTriedAt: new Date().toISOString() });

  // 2) 사진 옮기기
  const { moves } = photoSort.planMoves(output, { validIds: items.map((i) => i.id), photos: [...photoMap.keys()] });
  let moved = 0;
  let toTags = 0;
  for (const m of moves) {
    const item = tabItem(m.productId);
    const dir = folderDir(item);
    if (!dir) continue;
    const src = path.join(UNSORTED_DIR, photoMap.get(m.file));
    if (!fs.existsSync(src)) continue;
    // 소재 라벨은 제품에 자동으로 넣지 않고 오른쪽 태그 사진 칸으로 보낸다 - 사용자가 직접 배정.
    if (m.kind === "care") {
      fs.mkdirSync(TAGS_DIR, { recursive: true });
      let t = path.join(TAGS_DIR, path.basename(src));
      for (let k = 2; fs.existsSync(t); k++) t = path.join(TAGS_DIR, `${path.parse(src).name} ${k}${path.extname(src)}`);
      fs.renameSync(src, t);
      toTags++;
      continue;
    }
    if (m.kind === "worn") await placeWornPhoto(dir, src);
    else uploadFiles.placePhoto(dir, src, photoSort.EXTRA_NAMES[m.kind]);
    moved++;
  }

  // 3) 실측 채우기 (txt가 없으면 이때 양식대로 만들어진다)
  const measured = photoSort.cleanMeasurements(output, items.map((i) => i.id));
  for (const m of measured) saveListing(m.productId, { size: m.size });

  fs.rmSync(runDir, { recursive: true, force: true });

  const left = unsortedFiles.length - moved - toTags;
  const parts = [];
  if (unsortedFiles.length) parts.push(`사진 ${moved}장 정리`);
  if (left > 0) parts.push(`${left}장은 미분류에 남김`);
  if (names.length) parts.push(`제품명 ${names.length}개 제안`);
  if (measured.length) parts.push(`실측 ${measured.length}개 입력`);
  if (toTags) parts.push(`소재 라벨 ${toTags}장은 태그 사진 칸으로`);
  return parts.join(" · ") || "바뀐 게 없어요.";
}

  persistKenzCookies().finally(() => app.exit(0));
});
