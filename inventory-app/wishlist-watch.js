// 켄즈포스트 관심상품 할인 감시. launchd가 30분마다 Electron으로 실행한다.
//   electron wishlist-watch.js
//
// 1) 켄즈포스트 관심상품 페이지를 읽어 감시 목록을 갱신한다. 로그인이 자주 풀리는데,
//    풀려 있으면 마지막으로 읽어둔 목록을 그대로 쓴다(새로 담은 상품은 다음 로그인 때 추가).
// 2) 상품마다 메루카리 페이지(로그인 불필요)에서 현재가를 읽어, 마지막으로 본 가격보다
//    1엔이라도 내려갔으면 디스코드 "할인알림" 채널 웹훅으로 보낸다.
//    처음 보는 상품의 기준가는 켄즈포스트에 담을 당시 가격 - 담은 뒤 이미 내려간 것도 알린다.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { parseWishlistHtml } = require("./wishlist");
const { fetchMercariItem } = require("./mercari-fetch");
const { loadManual, appendDrop, mergeWishlist, loadHidden, mercariItemUrl } = require("./wishlist-files");

const DATA_DIR = path.join(app.getPath("appData"), "inventory-app");
const STATE_FILE = path.join(DATA_DIR, "wishlist-watch.json");
const PROFILE_DIR = path.join(DATA_DIR, "wishlist-watch-profile");
const KENZ_PARTITION = "persist:kenzpost";
const WISHLIST_URL = "https://kenzpost.com/user/mypage/one?o=-1";
// 웹훅 주소는 저장소 밖(앱 데이터 폴더)에 둔다: {"discountWebhookUrl": "https://discord.com/api/webhooks/..."}
const CONFIG_FILE = path.join(DATA_DIR, "wishlist-watch-config.json");
// 재고 앱에서 직접 추가한 상품, 앱 알림 팝업용 가격 인하 기록 (wishlist-files.js 참고)
const MANUAL_FILE = path.join(DATA_DIR, "wishlist-manual.json");
const DROPS_FILE = path.join(DATA_DIR, "wishlist-drops.json");
const HIDDEN_FILE = path.join(DATA_DIR, "wishlist-hidden.json"); // 앱에서 삭제한 상품

// 재고관리 앱이 켜져 있을 수 있어서 앱 프로필을 직접 쓰지 않고, 로그인 쿠키가 든
// 켄즈포스트 파티션만 복사해서 쓴다.
fs.rmSync(path.join(PROFILE_DIR, "Partitions", "kenzpost"), { recursive: true, force: true });
fs.cpSync(path.join(DATA_DIR, "Partitions", "kenzpost"), path.join(PROFILE_DIR, "Partitions", "kenzpost"), {
  recursive: true,
});
app.setPath("userData", PROFILE_DIR);
app.dock?.hide();
// 창을 하나씩 열고 닫는데, 기본 동작대로면 마지막 창이 닫힐 때 앱이 꺼져서 다음 로드가 실패한다.
app.on("window-all-closed", () => {});

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { items: {} };
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
}

function loadWebhookUrl() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")).discountWebhookUrl || null;
}

// 기존 메루카리 신규매물 알림(main.py)과 같은 모양의 embed로 보낸다. 레이트리밋(429)이면
// 기다렸다 재시도하고, 끝내 실패하면 false - 그 상품은 기준가를 안 바꿔서 다음 실행 때 다시 보낸다.
async function sendDiscord(webhookUrl, embed) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (resp.ok) return true;
    if (resp.status === 429) {
      const { retry_after = 1 } = await resp.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, (retry_after + 0.3) * 1000));
      continue;
    }
    log(`디스코드 전송 실패(${resp.status}): ${await resp.text()}`);
    return false;
  }
  return false;
}

function log(msg) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function loadKenzPage(url) {
  const win = new BrowserWindow({ show: false, webPreferences: { partition: KENZ_PARTITION } });
  try {
    await win.loadURL(url);
    const html = await win.webContents.executeJavaScript("document.documentElement.outerHTML");
    const loggedIn = await win.webContents.executeJavaScript("document.body.innerText.includes('로그아웃')");
    return { html, loggedIn };
  } finally {
    win.destroy();
  }
}

// 로그인돼 있으면 관심상품 전체(여러 페이지면 전부)를 읽고, 아니면 null.
async function readWishlist() {
  const first = await loadKenzPage(WISHLIST_URL);
  if (!first.loggedIn) return null;
  const parsed = parseWishlistHtml(first.html);
  const items = [...parsed.items];
  for (const link of parsed.pageLinks) {
    const page = await loadKenzPage(new URL(link, WISHLIST_URL).href);
    items.push(...parseWishlistHtml(page.html).items);
  }
  return items;
}

async function run() {
  const state = loadState();
  const webhookUrl = loadWebhookUrl();

  const wishlist = await readWishlist().catch((e) => {
    log(`관심상품 읽기 실패: ${e.message}`);
    return null;
  });
  // 관심상품에서 뺀 건 감시 중단, 단 앱에서 직접 추가한 상품은 유지
  state.items = mergeWishlist(state.items, wishlist, loadManual(MANUAL_FILE).map((m) => m.id), loadHidden(HIDDEN_FILE));
  if (wishlist) {
    state.lastListSyncAt = new Date().toISOString();
    log(`관심상품 ${wishlist.length}개 동기화`);
  } else {
    log(`켄즈포스트 로그인 안 됨 - 저장된 목록 ${Object.keys(state.items).length}개로 확인`);
  }

  for (const [id, item] of Object.entries(state.items)) {
    if (item.soldOut) continue;
    const mercari = await fetchMercariItem(mercariItemUrl(id)).catch((e) => {
      log(`확인 오류: ${id} ${e.message}`);
      return null;
    });
    if (!mercari) {
      log(`확인 실패(제목/가격을 못 읽음): ${id}`);
      continue;
    }
    item.title = mercari.title;
    // 찜 화면 사진용(Shops 상품은 사진 주소를 id로 만들 수 없어서 읽어 온 걸 저장한다)
    if (mercari.imageUrl) item.imageUrl = mercari.imageUrl;
    if (mercari.soldOut) {
      item.soldOut = true;
      log(`품절: ${id} ${mercari.title}`);
      continue;
    }
    const price = mercari.jpyPrice;
    if (item.lastPrice != null && price < item.lastPrice) {
      const pct = Math.round(((item.lastPrice - price) / item.lastPrice) * 100);
      const embed = {
        author: { name: "관심상품 할인" },
        title: mercari.title,
        url: `https://kenzpost.com/mercari/bid.s/${mercariItemUrl(id)}`,
        description: `💴 ~~${item.lastPrice.toLocaleString()}円~~ → **${price.toLocaleString()}円** (-${pct}%)`,
        color: 0xe74c3c,
      };
      if (mercari.imageUrl) embed.image = { url: mercari.imageUrl };
      // 웹훅이 있는데 전송이 실패했을 때만 기준가를 그대로 둬서 다음 실행 때 다시 보낸다.
      // 웹훅이 없으면 앱 알림만 남기고 넘어간다.
      if (webhookUrl && !(await sendDiscord(webhookUrl, embed))) continue;
      appendDrop(DROPS_FILE, { id, title: mercari.title, oldPrice: item.lastPrice, newPrice: price, imageUrl: mercari.imageUrl });
      log(`알림: ${mercari.title} ¥${item.lastPrice}→¥${price}`);
    }
    item.lastPrice = price;
    item.checkedAt = new Date().toISOString();
  }

  state.lastRunAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

app.whenReady().then(async () => {
  try {
    await run();
  } catch (e) {
    log(`오류: ${e.stack || e.message}`);
  }
  app.exit(0);
});
