// inventory-app/main.js
const { app, BrowserWindow, ipcMain, shell, session, nativeImage } = require("electron");
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
  const TARGET_WIDTH = 1040;
  const TARGET_HEIGHT = 720;
  const MIN_CONTENT_WIDTH = 1010;
  mainWindow = new BrowserWindow({
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    minWidth: MIN_CONTENT_WIDTH,
    useContentSize: true,
    show: false,
    icon: APP_ICON_PATH,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
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
        mainWindow.setMinimumSize(Math.round(MIN_CONTENT_WIDTH * scale), 400);
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
