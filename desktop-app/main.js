// 맥 메뉴바 상주 앱. 웹 대시보드와 같은 백엔드(/api/alerts, /api/toggle)를
// 그대로 재사용한다 - 디스코드를 다시 읽는 로직을 여기 따로 만들 필요가 없다.
// 뱃지 숫자 = "읽지 않은" 알림 개수(서버의 read 상태 기준). 팝업 패널을
// 닫으면(blur) 그 시점에 보여주고 있던 알림들을 전부 읽음 처리한다.
const { app, Tray, BrowserWindow, shell, ipcMain, nativeImage, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const https = require("https");

// Vercel의 Deployment Protection(로그인한 사람만 접속 가능)이 켜져 있어서,
// 브라우저가 아닌 이 앱에서 API를 호출하려면 우회 시크릿이 필요하다.
// .env는 커밋되지 않으므로 여기서 직접 파싱해서 읽는다(외부 패키지 불필요).
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  const env = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) env[match[1]] = match[2].trim();
    }
  }
  return env;
}
const ENV = loadEnv();

const API_BASE = "https://mercari-pi.vercel.app";
const POLL_INTERVAL_MS = 10000;
const WINDOW_WIDTH = 400;
const WINDOW_HEIGHT = 560;
// 트레이 아이콘을 다시 클릭해서 닫으려 할 때, 포커스를 잃어서 자동으로 닫히는
// blur 이벤트와 그 클릭 자체의 click 이벤트가 겹쳐서 "닫혔다가 바로 다시 열리는"
// 문제가 있다. blur로 닫힌 직후 짧은 시간 안에 들어온 클릭은 무시해서 막는다.
const REOPEN_GUARD_MS = 250;

let tray = null;
let win = null;
let badgeWin = null;
let badgeReady = false;
let alerts = [];
let shownUnreadIds = [];
let lastHiddenAt = 0;

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (ENV.VERCEL_BYPASS_SECRET) {
      headers["x-vercel-protection-bypass"] = ENV.VERCEL_BYPASS_SECRET;
    }
    const req = https.request(
      url,
      { method: options.method || "GET", headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function unreadAlerts() {
  return alerts
    .filter((a) => !a.read)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function updateBadge() {
  const count = unreadAlerts().length;
  if (badgeReady && badgeWin) {
    badgeWin.webContents.send("draw-badge", count);
  }
}

async function pollAlerts() {
  try {
    const data = await fetchJson(`${API_BASE}/api/alerts`);
    alerts = data.alerts || [];
    updateBadge();
    if (win && win.isVisible()) {
      win.webContents.send("alerts", unreadAlerts());
    }
  } catch (e) {
    console.error("poll failed", e);
  }
}

async function markManyRead(ids) {
  // 상태가 이제 Redis에 저장돼서(디스코드 반응 아님) 레이트리밋이 없다 -
  // 배치/텀 없이 한 번에 다 보내도 된다.
  await Promise.all(
    ids.map((id) =>
      fetchJson(`${API_BASE}/api/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id, kind: "read", on: true }),
      }).catch(() => {})
    )
  );
}

function createBadgeRenderer() {
  badgeWin = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  badgeWin.loadFile("badge-renderer.html");

  ipcMain.once("badge-ready", () => {
    badgeReady = true;
    updateBadge();
  });

  ipcMain.on("badge-image", (event, dataUrl) => {
    if (tray) tray.setImage(nativeImage.createFromDataURL(dataUrl));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.loadFile("panel.html");

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("blur", () => {
    hideWindow();
  });
}

function positionWindow() {
  const trayBounds = tray.getBounds();
  const windowBounds = win.getBounds();
  // 아이콘 중앙에 맞추면(가운데 정렬) 아이콘이 화면 오른쪽 끝에 가까울 때
  // 창의 오른쪽 절반이 화면 밖으로 잘린다. 대신 창의 오른쪽 끝을 아이콘의
  // 오른쪽 끝에 맞춰서, 창이 아이콘으로부터 왼쪽으로 펼쳐지게 한다.
  let x = Math.round(trayBounds.x + trayBounds.width - windowBounds.width);
  const y = Math.round(trayBounds.y + trayBounds.height);

  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const minX = display.workArea.x + 8;
  const maxX = display.workArea.x + display.workArea.width - windowBounds.width - 8;
  x = Math.min(Math.max(x, minX), maxX);

  win.setPosition(x, y, false);
}

function showWindow() {
  positionWindow();
  shownUnreadIds = unreadAlerts().map((a) => a.messageId);
  win.webContents.send("alerts", unreadAlerts());
  win.show();
  win.focus();
}

async function hideWindow() {
  if (!win.isVisible()) return;
  win.hide();
  lastHiddenAt = Date.now();
  const idsToMark = shownUnreadIds;
  shownUnreadIds = [];
  if (idsToMark.length > 0) {
    await markManyRead(idsToMark);
    await pollAlerts();
  }
}

function toggleWindow() {
  if (Date.now() - lastHiddenAt < REOPEN_GUARD_MS) return;
  if (win.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock.hide();

  tray = new Tray(path.join(__dirname, "iconTemplate.png"));
  tray.setToolTip("알림");
  tray.on("click", toggleWindow);

  createBadgeRenderer();
  createWindow();
  pollAlerts();
  setInterval(pollAlerts, POLL_INTERVAL_MS);
});

app.on("window-all-closed", (e) => {
  e.preventDefault(); // 메뉴바 상주 앱은 창을 닫아도 계속 떠 있어야 한다.
});
