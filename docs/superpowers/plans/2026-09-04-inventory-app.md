# 재고 관리 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 켄즈포스트 상품 링크를 붙여넣으면 원가/최소판매가를 자동 계산해주고, 재고 상태(재고/판매완료/개인구매)를 추적해서 "이번 달 실제 순이익"을 보여주는 독립 Electron 데스크톱 앱을 만든다.

**Architecture:** Electron 앱. 메인 프로세스가 로그인 세션(쿠키)을 유지하는 숨김 `BrowserWindow`로 켄즈포스트 상품 페이지를 로드해 HTML을 추출하고, 순수 함수(`pricing.js`)로 원가/최소판매가/월별 손익을 계산한다. 데이터는 SQLite 대신 로컬 JSON 파일(`store.js`)에 저장한다 — Electron에서 네이티브 모듈(better-sqlite3) 재빌드 없이 바로 동작하고, 데이터량(수백 건)에 충분하다.

**Tech Stack:** Electron 33 (desktop-app과 동일 버전), Node 내장 `node:test`/`node:assert` (jest 등 추가 의존성 없음), 순수 JS. 외부 npm 패키지 추가 없음.

**Spec:** [docs/superpowers/specs/2026-09-04-inventory-app-design.md](../specs/2026-09-04-inventory-app-design.md)

## Global Constraints

- 비밀번호를 앱이 저장하거나 대신 입력하지 않는다 — 실제 켄즈포스트 로그인 페이지를 그대로 띄우고, Electron 세션 파티션(`persist:kenzpost`)으로 쿠키만 재사용한다.
- 데이터는 로컬 파일에만 저장한다 (클라우드 동기화 없음).
- 최소판매가 공식: `원가 / (1 - 0.4)` (판매가 기준 마진율 40%).
- 원가 공식: `엔화가격 × 환율 / 100 × (1 + 예상관세율)`, 예상관세율 기본값 0.23.
- 재고 상한선 기본값 300만원, 월 목표 순이익 기본값 100만원 (둘 다 대시보드에서 조정 가능해야 함).
- 개인구매(`개인구매`) 상태 항목은 재고 총액·매출원가·순이익 계산에서 항상 완전히 제외한다.

---

## File Structure

```
inventory-app/
  package.json
  main.js          -- Electron 진입점: 창 생성, 세션 파티션, IPC 핸들러
  preload.js        -- contextBridge로 안전하게 IPC 노출
  pricing.js        -- 순수 계산 함수 (원가/최소판매가/HTML 파싱/월별 대시보드)
  store.js          -- JSON 파일 기반 CRUD
  index.html         -- UI (등록/재고목록/대시보드 3개 탭)
  renderer.js         -- UI 로직, window.api 호출
  style.css
  tests/
    pricing.test.js
    store.test.js
```

---

### Task 1: 프로젝트 스캐폴드

**Files:**
- Create: `inventory-app/package.json`
- Create: `inventory-app/.gitignore`
- Create: `inventory-app/main.js` (빈 창만 띄우는 최소 버전)

**Interfaces:**
- Produces: `npm start`로 실행되는 Electron 앱 진입점

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "inventory-app",
  "version": "1.0.0",
  "private": true,
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test tests/"
  },
  "devDependencies": {
    "electron": "^33.0.0"
  }
}
```

- [ ] **Step 2: .gitignore 작성**

```
node_modules
inventory.json
```

- [ ] **Step 3: 최소 main.js 작성 (빈 창)**

```js
const { app, BrowserWindow } = require("electron");

function createMainWindow() {
  const win = new BrowserWindow({ width: 900, height: 700 });
  win.loadFile("index.html");
}

app.whenReady().then(createMainWindow);
app.on("window-all-closed", () => app.quit());
```

- [ ] **Step 4: 임시 index.html 작성 (동작 확인용)**

```html
<!doctype html><html><body><h1>재고 관리</h1></body></html>
```

- [ ] **Step 5: 의존성 설치 및 실행 확인**

```bash
cd inventory-app && npm install
```

Run: `cd inventory-app && npm start`
Expected: "재고 관리" 텍스트가 보이는 900x700 창이 뜬다.

- [ ] **Step 6: Commit**

```bash
git add inventory-app/package.json inventory-app/.gitignore inventory-app/main.js inventory-app/index.html
git commit -m "Scaffold standalone inventory-app Electron project"
```

---

### Task 2: 원가/최소판매가 순수 계산 함수 (TDD)

**Files:**
- Create: `inventory-app/pricing.js`
- Test: `inventory-app/tests/pricing.test.js`

**Interfaces:**
- Produces:
  - `computeCostKrw(jpyPrice: number, fxRate: number, dutyRate: number): number` — 정수 원 반환
  - `computeMinPrice(costKrw: number, marginRate: number): number` — 정수 원 반환

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// inventory-app/tests/pricing.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { computeCostKrw, computeMinPrice } = require("../pricing");

test("computeCostKrw: 엔화가격에 환율과 관세율을 반영한다", () => {
  // 12000엔, 환율 950(100엔당), 관세율 23%
  // 12000 * 950 / 100 = 114000, * 1.23 = 140220
  assert.equal(computeCostKrw(12000, 950, 0.23), 140220);
});

test("computeCostKrw: 관세율 0이면 순수 환산가만 나온다", () => {
  assert.equal(computeCostKrw(10000, 900, 0), 90000);
});

test("computeMinPrice: 판매가 기준 마진율 40% 최소판매가", () => {
  // 원가 60000 -> 60000 / 0.6 = 100000
  assert.equal(computeMinPrice(60000, 0.4), 100000);
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd inventory-app && node --test tests/pricing.test.js`
Expected: FAIL — `Cannot find module '../pricing'`

- [ ] **Step 3: pricing.js에 함수 구현**

```js
// inventory-app/pricing.js
function computeCostKrw(jpyPrice, fxRate, dutyRate) {
  const landed = (jpyPrice * fxRate) / 100;
  return Math.round(landed * (1 + dutyRate));
}

function computeMinPrice(costKrw, marginRate) {
  return Math.round(costKrw / (1 - marginRate));
}

module.exports = { computeCostKrw, computeMinPrice };
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd inventory-app && node --test tests/pricing.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add inventory-app/pricing.js inventory-app/tests/pricing.test.js
git commit -m "Add cost/min-price calculation functions with tests"
```

---

### Task 3: 상품 페이지 HTML 파싱 함수 (TDD)

**Files:**
- Modify: `inventory-app/pricing.js`
- Modify: `inventory-app/tests/pricing.test.js`

**Interfaces:**
- Produces: `parseItemHtml(html: string): { title: string|null, jpyPrice: number|null }`

**참고:** 실제 로그인 상태의 켄즈포스트 페이지 HTML을 확보하지 못해 정확한 셀렉터를 알 수 없다. 여기서는 "본문에서 가장 큰 `n,nnn円` 형태 금액을 가격으로, `<h1>` 또는 `<title>` 텍스트를 상품명으로" 잡는 보수적인 방식으로 구현한다. 실제 페이지에서 안 맞으면 등록 화면에서 수동으로 값을 고칠 수 있게 만든다 (Task 8에서 처리).

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// inventory-app/tests/pricing.test.js 에 추가
const { parseItemHtml } = require("../pricing");

test("parseItemHtml: h1과 엔화 금액을 추출한다", () => {
  const html = `
    <html><body>
      <h1>Maison Margiela 10 데님 팬츠</h1>
      <div>가격: 12,000円</div>
      <div>수수료: 1,000円</div>
    </body></html>
  `;
  const result = parseItemHtml(html);
  assert.equal(result.title, "Maison Margiela 10 데님 팬츠");
  assert.equal(result.jpyPrice, 12000);
});

test("parseItemHtml: 금액이 없으면 jpyPrice는 null", () => {
  const result = parseItemHtml("<html><body><h1>제목만</h1></body></html>");
  assert.equal(result.title, "제목만");
  assert.equal(result.jpyPrice, null);
});

test("parseItemHtml: h1도 없으면 title은 null", () => {
  const result = parseItemHtml("<html><body>내용 없음</body></html>");
  assert.equal(result.title, null);
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd inventory-app && node --test tests/pricing.test.js`
Expected: FAIL — `parseItemHtml is not a function`

- [ ] **Step 3: pricing.js에 parseItemHtml 구현**

```js
// inventory-app/pricing.js 에 추가
function parseItemHtml(html) {
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const title = h1Match ? h1Match[1].trim() : null;

  const priceMatches = [...html.matchAll(/([\d,]{3,})\s*円/g)].map((m) =>
    parseInt(m[1].replace(/,/g, ""), 10)
  );
  const jpyPrice = priceMatches.length ? Math.max(...priceMatches) : null;

  return { title, jpyPrice };
}

module.exports = { computeCostKrw, computeMinPrice, parseItemHtml };
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd inventory-app && node --test tests/pricing.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add inventory-app/pricing.js inventory-app/tests/pricing.test.js
git commit -m "Add best-effort item page HTML parser with tests"
```

---

### Task 4: JSON 파일 기반 재고 저장소 (TDD)

**Files:**
- Create: `inventory-app/store.js`
- Test: `inventory-app/tests/store.test.js`

**Interfaces:**
- Produces:
  - `loadItems(filePath: string): Item[]`
  - `addItem(filePath: string, data: {title, sourceUrl, jpyPrice, fxRate, dutyRate, costKrw, targetPrice}): Item`
  - `updateItem(filePath: string, id: string, patch: object): Item|null`
  - `listItems(filePath: string, opts?: {status?: string}): Item[]`
- Item shape: `{ id, title, sourceUrl, jpyPrice, fxRate, dutyRate, costKrw, targetPrice, actualPrice, status, createdAt, soldAt, memo }`
  - `status`는 `'재고' | '판매완료' | '개인구매'`, 새 항목의 기본값은 `'재고'`.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// inventory-app/tests/store.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { loadItems, addItem, updateItem, listItems } = require("../store");

function tempFile() {
  return path.join(os.tmpdir(), `inv-test-${Date.now()}-${Math.random()}.json`);
}

test("loadItems: 파일이 없으면 빈 배열", () => {
  const file = tempFile();
  assert.deepEqual(loadItems(file), []);
});

test("addItem: 항목을 추가하고 기본 status는 재고", () => {
  const file = tempFile();
  const item = addItem(file, {
    title: "테스트 아이템",
    sourceUrl: "https://example.com",
    jpyPrice: 10000,
    fxRate: 950,
    dutyRate: 0.23,
    costKrw: 116850,
    targetPrice: 190000,
  });
  assert.equal(item.status, "재고");
  assert.ok(item.id);
  assert.ok(item.createdAt);
  assert.equal(loadItems(file).length, 1);
});

test("updateItem: 상태를 판매완료로 바꾸고 실제 판매가를 기록한다", () => {
  const file = tempFile();
  const item = addItem(file, {
    title: "테스트",
    sourceUrl: "u",
    jpyPrice: 1,
    fxRate: 1,
    dutyRate: 0,
    costKrw: 1000,
    targetPrice: 2000,
  });
  const updated = updateItem(file, item.id, {
    status: "판매완료",
    actualPrice: 2200,
    soldAt: "2026-09-10T00:00:00.000Z",
  });
  assert.equal(updated.status, "판매완료");
  assert.equal(updated.actualPrice, 2200);
});

test("updateItem: 없는 id면 null", () => {
  const file = tempFile();
  assert.equal(updateItem(file, "no-such-id", { status: "판매완료" }), null);
});

test("listItems: status로 필터링", () => {
  const file = tempFile();
  const a = addItem(file, { title: "A", sourceUrl: "u", jpyPrice: 1, fxRate: 1, dutyRate: 0, costKrw: 1, targetPrice: 1 });
  addItem(file, { title: "B", sourceUrl: "u", jpyPrice: 1, fxRate: 1, dutyRate: 0, costKrw: 1, targetPrice: 1 });
  updateItem(file, a.id, { status: "개인구매" });
  const personal = listItems(file, { status: "개인구매" });
  assert.equal(personal.length, 1);
  assert.equal(personal[0].title, "A");
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd inventory-app && node --test tests/store.test.js`
Expected: FAIL — `Cannot find module '../store'`

- [ ] **Step 3: store.js 구현**

```js
// inventory-app/store.js
const fs = require("node:fs");

function loadItems(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) return [];
  return JSON.parse(raw);
}

function saveItems(filePath, items) {
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
}

function addItem(filePath, data) {
  const items = loadItems(filePath);
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: data.title,
    sourceUrl: data.sourceUrl,
    jpyPrice: data.jpyPrice,
    fxRate: data.fxRate,
    dutyRate: data.dutyRate,
    costKrw: data.costKrw,
    targetPrice: data.targetPrice,
    actualPrice: null,
    status: "재고",
    createdAt: new Date().toISOString(),
    soldAt: null,
    memo: data.memo || "",
  };
  items.push(item);
  saveItems(filePath, items);
  return item;
}

function updateItem(filePath, id, patch) {
  const items = loadItems(filePath);
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...patch };
  saveItems(filePath, items);
  return items[idx];
}

function listItems(filePath, opts = {}) {
  const items = loadItems(filePath);
  if (!opts.status) return items;
  return items.filter((i) => i.status === opts.status);
}

module.exports = { loadItems, saveItems, addItem, updateItem, listItems };
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd inventory-app && node --test tests/store.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add inventory-app/store.js inventory-app/tests/store.test.js
git commit -m "Add JSON file-backed inventory store with tests"
```

---

### Task 5: 월별 대시보드 계산 함수 (TDD)

**Files:**
- Modify: `inventory-app/pricing.js`
- Modify: `inventory-app/tests/pricing.test.js`

**Interfaces:**
- Consumes: Task 4의 Item shape
- Produces: `computeDashboard(items: Item[], opts: {capKrw: number, monthlyTargetKrw: number, now?: Date}): { stockCostTotal, capProgressPct, monthCogs, monthRevenue, monthProfit, targetProgressPct }`

계산 방식 (재고자산 회계 원칙 — 월초재고 + 이번달매입 − 월말재고 = 매출원가):
- `개인구매` 상태 항목은 전 계산에서 제외.
- 항목이 시점 `t`에 "재고 중"이었는지: `createdAt <= t` 이고 (아직 안 팔렸거나, `soldAt > t`).
- 월초재고 = 이번 달 1일 0시 기준으로 "재고 중"인 항목들의 `costKrw` 합.
- 월말재고(진행 중인 달이므로 `now` 기준) = 지금 "재고 중"인 항목들의 `costKrw` 합 = `stockCostTotal`.
- 이번달매입 = `createdAt`이 이번 달 안에 있는 (개인구매 제외) 항목들의 `costKrw` 합.
- `monthCogs` = 월초재고 + 이번달매입 − 월말재고.
- `monthRevenue` = `soldAt`이 이번 달 안에 있는 `판매완료` 항목들의 `actualPrice` 합.
- `monthProfit` = `monthRevenue - monthCogs`.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// inventory-app/tests/pricing.test.js 에 추가
const { computeDashboard } = require("../pricing");

function item(overrides) {
  return {
    id: Math.random().toString(),
    title: "x",
    costKrw: 0,
    actualPrice: null,
    status: "재고",
    createdAt: "2026-08-01T00:00:00.000Z",
    soldAt: null,
    ...overrides,
  };
}

test("computeDashboard: 재고 총액과 상한선 대비 진행률", () => {
  const items = [
    item({ costKrw: 100000, status: "재고" }),
    item({ costKrw: 200000, status: "재고" }),
    item({ costKrw: 999999, status: "개인구매" }), // 제외되어야 함
  ];
  const now = new Date("2026-09-15T00:00:00.000Z");
  const result = computeDashboard(items, { capKrw: 300000, monthlyTargetKrw: 1000000, now });
  assert.equal(result.stockCostTotal, 300000);
  assert.equal(result.capProgressPct, 100);
});

test("computeDashboard: 이번달 매출원가 = 월초재고 + 이번달매입 - 월말재고", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");
  const items = [
    // 8월에 사서 아직도 재고(월초에도 재고, 지금도 재고): 월초재고에 포함, 월말재고에도 포함
    item({ costKrw: 500000, status: "재고", createdAt: "2026-08-10T00:00:00.000Z" }),
    // 8월에 사서 9월 5일에 팔림: 월초재고엔 포함(8/1 시점엔 재고였음), 월말재고엔 미포함, 이번달매입 아님
    item({ costKrw: 300000, status: "판매완료", createdAt: "2026-08-20T00:00:00.000Z", soldAt: "2026-09-05T00:00:00.000Z", actualPrice: 500000 }),
    // 9월에 사서 아직 재고: 이번달매입에 포함, 월말재고에도 포함
    item({ costKrw: 200000, status: "재고", createdAt: "2026-09-02T00:00:00.000Z" }),
  ];
  const result = computeDashboard(items, { capKrw: 3000000, monthlyTargetKrw: 1000000, now });
  // 월초재고 = 500000 + 300000 = 800000 (둘 다 9/1 시점엔 재고 상태였음)
  // 이번달매입 = 200000
  // 월말재고(지금) = 500000 + 200000 = 700000
  // 매출원가 = 800000 + 200000 - 700000 = 300000
  assert.equal(result.monthCogs, 300000);
  assert.equal(result.monthRevenue, 500000);
  assert.equal(result.monthProfit, 200000);
  assert.equal(result.targetProgressPct, 20);
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd inventory-app && node --test tests/pricing.test.js`
Expected: FAIL — `computeDashboard is not a function`

- [ ] **Step 3: pricing.js에 computeDashboard 구현**

```js
// inventory-app/pricing.js 에 추가
function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function inStockAt(item, t) {
  if (item.status === "개인구매") return false;
  const created = new Date(item.createdAt);
  if (created > t) return false;
  if (item.status === "판매완료") {
    const sold = item.soldAt ? new Date(item.soldAt) : null;
    return sold ? sold > t : false;
  }
  return true; // status === '재고'
}

function computeDashboard(items, opts) {
  const now = opts.now || new Date();
  const monthStart = startOfMonth(now);

  const businessItems = items.filter((i) => i.status !== "개인구매");

  const stockCostTotal = items
    .filter((i) => i.status === "재고")
    .reduce((sum, i) => sum + i.costKrw, 0);

  const startOfMonthStock = businessItems
    .filter((i) => inStockAt(i, monthStart))
    .reduce((sum, i) => sum + i.costKrw, 0);

  const monthPurchases = businessItems
    .filter((i) => new Date(i.createdAt) >= monthStart && new Date(i.createdAt) <= now)
    .reduce((sum, i) => sum + i.costKrw, 0);

  const monthCogs = startOfMonthStock + monthPurchases - stockCostTotal;

  const monthRevenue = businessItems
    .filter(
      (i) =>
        i.status === "판매완료" &&
        i.soldAt &&
        new Date(i.soldAt) >= monthStart &&
        new Date(i.soldAt) <= now
    )
    .reduce((sum, i) => sum + (i.actualPrice || 0), 0);

  const monthProfit = monthRevenue - monthCogs;

  return {
    stockCostTotal,
    capProgressPct: Math.round((stockCostTotal / opts.capKrw) * 100),
    monthCogs,
    monthRevenue,
    monthProfit,
    targetProgressPct: Math.round((monthProfit / opts.monthlyTargetKrw) * 100),
  };
}

module.exports = {
  computeCostKrw,
  computeMinPrice,
  parseItemHtml,
  computeDashboard,
};
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd inventory-app && node --test tests/pricing.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add inventory-app/pricing.js inventory-app/tests/pricing.test.js
git commit -m "Add periodic-inventory monthly profit dashboard calculation"
```

---

### Task 6: Electron 메인 프로세스 — 로그인 세션 + IPC 핸들러

**Files:**
- Modify: `inventory-app/main.js`

**Interfaces:**
- Consumes: `pricing.js`의 `computeCostKrw`, `computeMinPrice`, `parseItemHtml`, `computeDashboard` / `store.js`의 `addItem`, `updateItem`, `listItems`
- Produces: IPC 채널 `fetch-item`, `save-item`, `update-item`, `list-items`, `get-dashboard`, `open-login`

- [ ] **Step 1: main.js를 아래 내용으로 교체**

```js
// inventory-app/main.js
const { app, BrowserWindow, ipcMain, session } = require("electron");
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
```

- [ ] **Step 2: 수동 확인 — 앱이 여전히 뜨는지**

Run: `cd inventory-app && npm start`
Expected: 이전과 동일하게 메인 창이 뜨고, 콘솔에 에러가 없다 (index.html은 아직 임시 내용이라 UI는 Task 8에서 완성).

- [ ] **Step 3: Commit**

```bash
git add inventory-app/main.js
git commit -m "Wire Electron main process: kenzpost session + IPC handlers"
```

---

### Task 7: preload.js — 안전한 IPC 브릿지

**Files:**
- Create: `inventory-app/preload.js`

**Interfaces:**
- Produces: 렌더러에서 쓸 `window.api = { openLogin, fetchItem, saveItem, updateItem, listItems, getDashboard }`

- [ ] **Step 1: preload.js 작성**

```js
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
```

- [ ] **Step 2: 수동 확인 — preload가 로드되는지**

Run: `cd inventory-app && npm start`, 개발자 도구(Cmd+Option+I)를 열고 콘솔에 `window.api` 입력
Expected: `openLogin`, `fetchItem` 등 함수가 담긴 객체가 출력된다 (에러 없음).

- [ ] **Step 3: Commit**

```bash
git add inventory-app/preload.js
git commit -m "Add preload script exposing safe IPC bridge"
```

---

### Task 8: UI — 등록 / 재고 목록 / 대시보드

**Files:**
- Modify: `inventory-app/index.html`
- Create: `inventory-app/renderer.js`
- Create: `inventory-app/style.css`

**Interfaces:**
- Consumes: `window.api.*` (Task 7)

- [ ] **Step 1: index.html 작성**

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="style.css">
  <title>재고 관리</title>
</head>
<body>
  <nav>
    <button data-tab="register" class="tab active">등록</button>
    <button data-tab="list" class="tab">재고 목록</button>
    <button data-tab="dashboard" class="tab">대시보드</button>
    <button id="loginBtn">켄즈포스트 로그인</button>
  </nav>

  <section id="tab-register" class="panel active">
    <h2>새 상품 등록</h2>
    <input id="urlInput" placeholder="켄즈포스트 상품 링크" size="60">
    <button id="fetchBtn">가져오기</button>
    <div id="fetchResult"></div>
    <form id="saveForm" hidden>
      <label>상품명 <input id="titleField"></label>
      <label>엔화가격 <input id="jpyField" type="number"></label>
      <label>환율(100엔) <input id="fxField" type="number"></label>
      <label>예상관세율(%) <input id="dutyField" type="number" step="0.1"></label>
      <label>원가(원) <input id="costField" type="number"></label>
      <label>최소판매가(원) <input id="minPriceField" type="number" disabled></label>
      <label>목표판매가(원) <input id="targetField" type="number"></label>
      <button type="submit">재고로 등록</button>
    </form>
  </section>

  <section id="tab-list" class="panel">
    <h2>재고 목록</h2>
    <select id="statusFilter">
      <option value="">전체</option>
      <option value="재고">재고</option>
      <option value="판매완료">판매완료</option>
      <option value="개인구매">개인구매</option>
    </select>
    <table id="itemTable">
      <thead><tr><th>상품명</th><th>원가</th><th>목표가</th><th>상태</th><th>실제판매가</th><th>동작</th></tr></thead>
      <tbody></tbody>
    </table>
  </section>

  <section id="tab-dashboard" class="panel">
    <h2>대시보드</h2>
    <div id="dashboardBody"></div>
  </section>

  <script src="renderer.js"></script>
</body>
</html>
```

- [ ] **Step 2: style.css 작성**

```css
body { font-family: -apple-system, sans-serif; margin: 0; padding: 16px; }
nav { display: flex; gap: 8px; margin-bottom: 16px; }
.tab { padding: 6px 12px; cursor: pointer; }
.tab.active { font-weight: bold; border-bottom: 2px solid #333; }
.panel { display: none; }
.panel.active { display: block; }
form label { display: block; margin: 8px 0; }
table { border-collapse: collapse; width: 100%; margin-top: 12px; }
th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
```

- [ ] **Step 3: renderer.js 작성**

```js
// inventory-app/renderer.js
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "list") renderList();
    if (btn.dataset.tab === "dashboard") renderDashboard();
  });
});

document.getElementById("loginBtn").addEventListener("click", () => {
  window.api.openLogin();
});

document.getElementById("fetchBtn").addEventListener("click", async () => {
  const url = document.getElementById("urlInput").value.trim();
  if (!url) return;
  const result = await window.api.fetchItem(url);
  const resultDiv = document.getElementById("fetchResult");
  if (result.jpyPrice == null) {
    resultDiv.textContent = result.needsLogin
      ? "로그인이 안 되어 있는 것 같아요. 상단의 '켄즈포스트 로그인'을 먼저 눌러주세요."
      : "가격을 자동으로 못 읽었어요. 아래 값을 직접 입력해주세요.";
  } else {
    resultDiv.textContent = "";
  }
  document.getElementById("saveForm").hidden = false;
  document.getElementById("titleField").value = result.title || "";
  document.getElementById("jpyField").value = result.jpyPrice || "";
  document.getElementById("fxField").value = result.fxRate || 950;
  document.getElementById("dutyField").value = ((result.dutyRate ?? 0.23) * 100);
  document.getElementById("costField").value = result.costKrw || "";
  document.getElementById("minPriceField").value = result.minPrice || "";
  document.getElementById("targetField").value = result.minPrice || "";
});

function recomputeFromFields() {
  const jpy = Number(document.getElementById("jpyField").value) || 0;
  const fx = Number(document.getElementById("fxField").value) || 0;
  const dutyPct = Number(document.getElementById("dutyField").value) || 0;
  const cost = Math.round(((jpy * fx) / 100) * (1 + dutyPct / 100));
  document.getElementById("costField").value = cost;
  document.getElementById("minPriceField").value = Math.round(cost / 0.6);
}

["jpyField", "fxField", "dutyField"].forEach((id) => {
  document.getElementById(id).addEventListener("input", recomputeFromFields);
});

document.getElementById("saveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await window.api.saveItem({
    title: document.getElementById("titleField").value,
    sourceUrl: document.getElementById("urlInput").value.trim(),
    jpyPrice: Number(document.getElementById("jpyField").value),
    fxRate: Number(document.getElementById("fxField").value),
    dutyRate: Number(document.getElementById("dutyField").value) / 100,
    costKrw: Number(document.getElementById("costField").value),
    targetPrice: Number(document.getElementById("targetField").value),
  });
  e.target.reset();
  e.target.hidden = true;
  document.getElementById("fetchResult").textContent = "등록 완료!";
  document.getElementById("urlInput").value = "";
});

document.getElementById("statusFilter").addEventListener("change", renderList);

async function renderList() {
  const status = document.getElementById("statusFilter").value;
  const items = await window.api.listItems(status ? { status } : undefined);
  const tbody = document.querySelector("#itemTable tbody");
  tbody.innerHTML = "";
  for (const item of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.title}</td>
      <td>${item.costKrw.toLocaleString()}</td>
      <td>${item.targetPrice.toLocaleString()}</td>
      <td>${item.status}</td>
      <td>${item.actualPrice ? item.actualPrice.toLocaleString() : "-"}</td>
      <td></td>
    `;
    const actionTd = tr.querySelector("td:last-child");
    if (item.status === "재고") {
      const sellBtn = document.createElement("button");
      sellBtn.textContent = "판매완료 처리";
      sellBtn.addEventListener("click", async () => {
        const actual = prompt("실제 판매가(원)를 입력하세요", item.targetPrice);
        if (actual == null) return;
        await window.api.updateItem(item.id, {
          status: "판매완료",
          actualPrice: Number(actual),
          soldAt: new Date().toISOString(),
        });
        renderList();
      });
      actionTd.appendChild(sellBtn);

      const personalBtn = document.createElement("button");
      personalBtn.textContent = "개인구매로 표시";
      personalBtn.addEventListener("click", async () => {
        await window.api.updateItem(item.id, { status: "개인구매" });
        renderList();
      });
      actionTd.appendChild(personalBtn);
    }
    tbody.appendChild(tr);
  }
}

async function renderDashboard() {
  const d = await window.api.getDashboard();
  document.getElementById("dashboardBody").innerHTML = `
    <p>재고 총원가: ${d.stockCostTotal.toLocaleString()}원 (상한선 대비 ${d.capProgressPct}%)</p>
    <p>이번달 매출원가: ${d.monthCogs.toLocaleString()}원</p>
    <p>이번달 매출: ${d.monthRevenue.toLocaleString()}원</p>
    <p>이번달 순이익: ${d.monthProfit.toLocaleString()}원 (목표 대비 ${d.targetProgressPct}%)</p>
  `;
}
```

- [ ] **Step 4: 수동 확인**

Run: `cd inventory-app && npm start`
Expected:
1. "등록" 탭에서 아무 URL이나 넣고 "가져오기"를 누르면 (로그인 전이라) "로그인이 안 되어 있는 것 같아요" 메시지가 뜬다.
2. 값들을 직접 입력하고 "재고로 등록"을 누르면 "등록 완료!"가 뜬다.
3. "재고 목록" 탭에서 방금 등록한 항목이 보인다. "판매완료 처리"를 누르고 가격을 입력하면 상태가 바뀐다.
4. "대시보드" 탭에서 숫자가 표시된다 (에러 없음).

- [ ] **Step 5: Commit**

```bash
git add inventory-app/index.html inventory-app/renderer.js inventory-app/style.css
git commit -m "Build register/list/dashboard UI wired to IPC api"
```

---

### Task 9: 실제 켄즈포스트 로그인 흐름 수동 검증

**Files:** (변경 없음 — 실제 사이트 대상 수동 검증 태스크)

- [ ] **Step 1: 앱 실행 후 "켄즈포스트 로그인" 클릭**

Run: `cd inventory-app && npm start`, 상단의 "켄즈포스트 로그인" 버튼 클릭
Expected: 켄즈포스트 로그인 페이지가 새 창으로 뜬다.

- [ ] **Step 2: 실제 계정으로 로그인**

Expected: 로그인 성공 후 로그인 창을 닫아도 세션이 유지된다 (앱을 완전히 종료했다가 다시 켜도 유지되는지 확인 — `persist:` 파티션은 `userData` 디렉터리에 저장되므로 재시작해도 남아있어야 함).

- [ ] **Step 3: 실제 상품 링크로 가져오기 테스트**

Run: "등록" 탭에서 실제 켄즈포스트 상품 링크(예: `https://kenzpost.com/mercari/bid.s/https://jp.mercari.com/item/...`)를 붙여넣고 "가져오기"
Expected: 로그인된 상태이므로 로그인 페이지가 아니라 실제 상품 페이지 HTML을 받아온다. `title`/`jpyPrice`가 제대로 파싱되는지 확인한다.

- [ ] **Step 4: 파싱이 안 맞을 경우 기록**

파싱된 상품명이나 가격이 실제와 다르면, 개발자 도구에서 `document.documentElement.outerHTML`을 복사해 실제 마크업 구조를 확인하고 `parseItemHtml`의 정규식을 그 구조에 맞게 수정한다 (Task 3의 테스트도 그 실제 마크업을 기반으로 한 fixture로 교체).

이 태스크는 실제 사이트 상태에 의존하므로 자동화된 커밋 대상이 없다 — Step 4에서 수정이 발생하면 그 수정 자체를 별도 커밋으로 남긴다.
