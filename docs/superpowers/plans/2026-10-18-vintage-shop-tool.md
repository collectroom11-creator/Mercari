# 빈티지샵 운영 툴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 재고관리 Electron 앱에 가계부 탭, 대시보드, 할인/찜 알림 팝업, 찜 목록, 메루카리 필터 편집을 더해 하나의 샵 운영 툴로 만든다.

**Architecture:** 계산과 파일 처리는 작은 순수 모듈(`stats.js`, `discounts.js`, `ledger-store.js`, `wishlist-files.js`, `filters.js`, `filters-git.js`)로 만들고 `node --test`로 검증한다. `main.js`가 IPC로 노출하고 `renderer.js`/`index.html`이 화면을 그린다. 가계부는 기존 HTML을 iframe으로 띄우고, preload가 iframe에도 `window.storage`를 넣어 앱 데이터 폴더의 `ledger.json`에 저장한다. 메루카리 필터는 저장소 루트 `filters.json`으로 분리하고 `config.py`가 이를 읽는다.

**Tech Stack:** Electron 33, Node `node:test`, Python 3 (알림 봇), git CLI.

**Spec:** `docs/superpowers/specs/2026-10-18-vintage-shop-tool-design.md`

## Global Constraints

- 앱 폴더: `inventory-app/`, 데이터 폴더: `app.getPath("userData")` (= `~/Library/Application Support/inventory-app/`). 새 데이터 파일도 전부 여기에 둔다: `ledger.json`, `alerts-state.json`, `wishlist-manual.json`, `wishlist-drops.json`.
- 저장소 루트 = `path.join(__dirname, "..")` (inventory-app의 상위 폴더 `~/Documents/fashionstudy`).
- 기존 기능을 깨지 않는다: 켄즈포스트 링크 추가, 상태 변경, 월별 정리(`computeMonthlyBreakdown`), 수동 일괄 할인(5/10/20%), `daily-quota.js`, `wishlist-watch.js`의 디스코드 전송.
- 기존 `npm test` 43개는 계속 통과해야 한다.
- 할인 단계: 14일 → 5%, 28일 → 10%, 56일 → 15%, 112일 → 20%. 기준가 `listedPrice`, 새 가격 `Math.round(listedPrice × (1 − pct/100))`.
- 순이익 = `actualPrice − costKrw`. 수수료/택배비 없음.
- 회전율 = 이번 달 판매 원가 ÷ (이번 달 판매 원가 + 판매중 원가) × 100, 반올림 정수.
- "이번 달"은 로컬 시간(한국) 기준 월. 기존 `startOfMonth`와 같은 방식.
- `status === "개인구매"` 상품은 모든 통계에서 뺀다(기존 규칙과 동일).
- 필요한 필드가 없는 상품(판매완료인데 `actualPrice`/`soldAt` 없음, 판매중인데 `listedPrice`/`listedAt` 없음)은 해당 계산에서 빼고 0으로 치지 않는다.
- 필터 저장은 `filters.json` 한 파일만 커밋, 메시지 `Update Mercari filters (app)`. push 전 `git pull --rebase --autostash origin main`, 최대 4회 재시도.
- 가계부 백업 파일 형식: `{version: 1, exportedAt, transactions, recentDesc, categories, categoryKeywords}`. 실제 파일: `~/Downloads/가계부_백업_2026-10-18.json` (거래 228건).
- 가계부 저장 키: `ledger:transactions`, `ledger:recentDesc`, `ledger:categories`, `ledger:categoryKeywords`, `ledger:seed_jan_jun_2026`. 값은 문자열(JSON.stringify된 것). `get`은 `{value}`를 돌려주고 키가 없으면 throw.
- UI 문구는 한국어.

## Review Focus

1. **불러오기 전에 가계부를 먼저 연 경우:** 가계부는 키가 없으면 1~6월 예시 데이터를 시드한다. 이후 백업을 불러오면 예시 데이터가 남지 않고 228건만 있어야 한다. → Task 3 테스트.
2. **찜 목록에서 직접 넣은 링크:** 켄즈포스트 목록 동기화가 상태 파일에서 목록에 없는 상품을 지우는데, 직접 넣은 링크는 지워지면 안 된다. → Task 4 테스트.
3. **필터 브랜드명이 메루카리 태그와 다를 때:** 대소문자만 다른 이름(예: `DIRK BIKKEMBERGS` vs `Dirk Bikkembergs`)은 중복으로 막고, 없는 이름은 저장 불가. → Task 6 테스트.
4. **이미 그 단계 이상 할인된 상품 / X로 닫은 상품:** 다시 뜨면 안 되고, 다음 단계가 되면 떠야 한다. → Task 2 테스트.
5. **필터 저장 중 원격이 앞서 있을 때(봇이 1분마다 커밋):** push가 거절돼도 rebase 후 재시도해서 성공해야 하고, `filters.json` 외 파일은 커밋되지 않아야 한다. → Task 6 테스트.

---

### Task 0: 기존 미커밋 작업 기준점 만들기

`inventory-app/`에 사용자가 커밋하지 않은 변경이 많다. 사용자의 허락을 받은 뒤에만 진행한다.

- [ ] **Step 1:** `git -C inventory-app status --short`로 목록을 보여주고 사용자에게 "기존 작업을 먼저 커밋해도 되는지" 확인한다.
- [ ] **Step 2:** 허락하면 `inventory-app/` 변경과 미추적 파일(`daily-quota.js`, `settings.js`, `icon.png`, `tests/settings.test.js`, 실행 `.command`)만 add해서 `chore: snapshot inventory-app before shop-tool work`로 커밋한다. `desktop-app/` 변경은 건드리지 않는다.
- [ ] **Step 3:** `cd inventory-app && npm test` → 43 pass.

### Task 1: 대시보드 계산 (`stats.js`)

**Files:** Create `inventory-app/stats.js`, Test `inventory-app/tests/stats.test.js`

**Interfaces:**
- Produces: `computeShopStats(items, { now }) -> { monthRevenue, monthProfit, turnoverPct, listedCost }`, `computeMonthlySales(items, { now }) -> [{ month: "YYYY-MM", revenue, profit }]` (오래된 달 → 최신 달 순서, 첫 판매월부터 이번 달까지 빈 달은 0).

- [ ] **Step 1: 실패하는 테스트**

```js
// now = new Date(2026, 9, 18)
// items: 10월 판매 3개(cost 145898/actual 225000, 70120/102000, 139527/257000),
//        9월 판매 1개(cost 100000/actual 150000, soldAt 2026-09-20),
//        판매중 2개(cost 50000, 60000), 업로드전 1개(cost 999999), 개인구매 1개(판매완료),
//        판매완료인데 actualPrice null 1개(cost 77777, soldAt 10월)
test("computeShopStats: 10월 매출/순이익/회전율/판매중 원가", () => {
  const s = computeShopStats(items, { now });
  assert.equal(s.monthRevenue, 584000);
  assert.equal(s.monthProfit, 584000 - 355545);
  assert.equal(s.listedCost, 110000);
  assert.equal(s.turnoverPct, Math.round(355545 / (355545 + 110000) * 100)); // 76
});
test("computeMonthlySales: 9월~10월, 순서와 값", () => {
  assert.deepEqual(computeMonthlySales(items, { now }), [
    { month: "2026-09", revenue: 150000, profit: 50000 },
    { month: "2026-10", revenue: 584000, profit: 228455 },
  ]);
});
test("판매 기록이 없으면 회전율 0, 월별 빈 배열", ...);
```

- [ ] **Step 2:** `node --test tests/stats.test.js` → FAIL (module not found).
- [ ] **Step 3:** `stats.js` 구현. 기존 `pricing.js`의 `startOfMonth`와 같은 로컬 시간 월 계산.
- [ ] **Step 4:** `npm test` → 전부 PASS.
- [ ] **Step 5:** Commit `feat(inventory): add shop stats for dashboard`.

### Task 2: 할인 필요 판정 (`discounts.js`)

**Files:** Create `inventory-app/discounts.js`, Test `inventory-app/tests/discounts.test.js`

**Interfaces:**
- Produces: `DISCOUNT_STAGES = [{days:14,pct:5},{days:28,pct:10},{days:56,pct:15},{days:112,pct:20}]`; `computeDiscountAlerts(items, dismissed, { now }) -> [{ id, title, imageUrl, weeks, listPrice, pct, newPrice }]` (`dismissed`: `{ [itemId]: pct }`); `discountedPrice(listedPrice, pct) -> number`.

- [ ] **Step 1: 실패하는 테스트**

```js
// 판매중, listedPrice 330000, listPrice 330000, listedAt = now - 35일
test("35일 경과 → 10% 단계, newPrice 297000, weeks 5", ...);
test("13일 경과 → 알림 없음", ...);
test("이미 listPrice 297000 이하 → 10% 단계 알림 없음", ...);
test("dismissed {id:10} → 안 뜸, 56일이 되면 15%로 다시 뜸", ...);
test("판매완료/업로드전/listedPrice 없음 → 제외", ...);
test("discountedPrice(330000, 15) === 280500", ...);
```

- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 구현. 경과일 = `floor((now − listedAt) / 86400000)`, weeks = `floor(경과일/7)`. 가장 높은 해당 단계 하나만. 결과는 경과일 많은 순 정렬.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(inventory): compute staged discount alerts`.

### Task 3: 가계부 저장소 (`ledger-store.js`)

**Files:** Create `inventory-app/ledger-store.js`, Test `inventory-app/tests/ledger-store.test.js`

**Interfaces:**
- Produces: `ledgerGet(filePath, key) -> { value: string }` (없으면 `throw new Error("not found")`), `ledgerSet(filePath, key, value: string) -> void`, `importLedgerBackup(filePath, backup) -> { transactionCount }` (형식이 다르면 throw).

- [ ] **Step 1: 실패하는 테스트** (임시 폴더 사용)

```js
test("set 후 get은 같은 문자열을 돌려주고, 없는 키는 throw", ...);
test("시드된 상태에서 import하면 4개 키가 백업 값으로 교체되고 seed 키가 '1'", () => {
  ledgerSet(f, "ledger:transactions", JSON.stringify([{ id: 1, desc: "예시" }]));
  const r = importLedgerBackup(f, { version: 1, transactions: [{id:9},{id:10}], recentDesc:{expense:[],income:[]}, categories:{expense:["배송"],income:[]}, categoryKeywords:{expense:{},income:{}} });
  assert.equal(r.transactionCount, 2);
  assert.deepEqual(JSON.parse(ledgerGet(f, "ledger:transactions").value), [{id:9},{id:10}]);
  assert.equal(ledgerGet(f, "ledger:seed_jan_jun_2026").value, "1");
});
test("version이 1이 아니거나 transactions가 배열이 아니면 throw, 파일은 그대로", ...);
```

- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 구현. 파일은 `{ [key]: string }` JSON. 쓰기는 임시 파일에 쓴 뒤 rename.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(inventory): add file-backed ledger storage with backup import`.

### Task 4: 찜 직접 추가와 가격 인하 기록 (`wishlist-files.js` + `wishlist-watch.js`)

**Files:** Create `inventory-app/wishlist-files.js`, Modify `inventory-app/wishlist-watch.js`, Test `inventory-app/tests/wishlist-files.test.js`

**Interfaces:**
- Produces: `parseWishlistLink(url) -> "m\\d+" | null` (켄즈포스트 `.../https://jp.mercari.com/item/mXXXX` 또는 메루카리 링크); `loadManual(file) -> [{ id, addedAt }]`, `addManual(file, id) -> list` (중복 무시), `removeManual(file, id) -> list`; `appendDrop(file, { id, title, oldPrice, newPrice, imageUrl }) -> void` (`at` ISO와 `dropId = id + "@" + at` 추가); `loadDrops(file) -> [...]`; `mergeWishlist(stateItems, kenzList | null, manualIds) -> stateItems` (켄즈 목록이 있으면 목록에도 없고 manual에도 없는 id만 삭제, manual id 중 상태에 없는 건 `{ title: id, lastPrice: null, soldOut: false }`로 추가).

- [ ] **Step 1: 실패하는 테스트**

```js
test("parseWishlistLink: 켄즈포스트/메루카리 링크에서 id, 그 외 null", ...);
test("mergeWishlist: 켄즈 목록에 없는 manual id는 유지된다", () => {
  const out = mergeWishlist({ m1:{...}, m2:{...} }, [{ id:"m1", title:"a", listedPrice:100 }], ["m2"]);
  assert.ok(out.m2);
});
test("mergeWishlist: 켄즈 목록 null(로그아웃)이면 아무것도 지우지 않는다", ...);
test("appendDrop/loadDrops: 기록이 쌓이고 dropId가 붙는다", ...);
```

- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 구현 후 `wishlist-watch.js`의 `run()`에서 기존 삭제/추가 로직을 `mergeWishlist(state.items, wishlist, loadManual(MANUAL_FILE).map(m=>m.id))`로 바꾸고, 디스코드 전송 성공 직후 `appendDrop(DROPS_FILE, ...)`. 웹훅이 없을 때도 앱 알림용으로 `appendDrop`은 하고 기준가를 갱신한다(디스코드 재시도 동작은 웹훅이 있을 때만 유지).
- [ ] **Step 4:** `npm test` → PASS. `wishlist-watch.js`는 `node -e "require('./wishlist-files')"` 수준으로만 확인(Electron 실행은 Task 9).
- [ ] **Step 5:** Commit `feat(inventory): manual wishlist links and price-drop log`.

### Task 5: 메루카리 필터를 `filters.json`으로 분리

**Files:** Create `filters.json` (저장소 루트), Modify `config.py`, Test `scripts/check_filters_equivalence.py` (일회성, 커밋 안 함)

**Interfaces:**
- Produces: `filters.json` 형식 `{ "brands": [{ "name": str, "priceMax": int }], "excludeKeywords": [str], "brandExcludeKeywords": { name: [str] } }`. 브랜드 순서는 지금 `TARGET_BRANDS` 순서 유지.
- `config.py`는 `TARGET_BRANDS`, `BRAND_PRICE_OVERRIDES`, `EXCLUDE_KEYWORDS`, `BRAND_EXCLUDE_KEYWORDS_OVERRIDES`를 `filters.json`에서 만든다. `PRICE_MAX`, 카테고리 관련 상수, `BRAND_REQUIRE_KEYWORDS_OVERRIDES`는 그대로 파이썬에 둔다.

- [ ] **Step 1:** 현재 `config.py`에서 4개 값을 덤프해 `/tmp`가 아닌 스크래치 파일에 저장(기준값).
- [ ] **Step 2:** `filters.json` 생성 + `config.py` 수정.
- [ ] **Step 3:** 다시 덤프해서 4개 값이 기준값과 완전히 같은지 비교 → 같음. `python3 -c "import main, config; e=main.load_facets(); print(main.resolve_brand_ids(e)[1])"` → `[]`.
- [ ] **Step 4:** Commit `config.py`, `filters.json` → `refactor: move editable Mercari filters to filters.json`, rebase/push 루프로 push. 다음 GitHub Actions 실행이 success인지 `gh run list -L 3`로 확인.

### Task 6: 필터 편집 로직 (`filters.js`, `filters-git.js`)

**Files:** Create `inventory-app/filters.js`, `inventory-app/filters-git.js`, Test `inventory-app/tests/filters.test.js`, `inventory-app/tests/filters-git.test.js`

**Interfaces:**
- Produces (`filters.js`): `loadBrandNames(facetsBrandsPath) -> string[]` (기존 `_flatten`처럼 `{id,name}` 노드 전부); `matchBrand(input, names) -> { exact: string|null, candidates: string[] }` (대소문자 무시 정확 일치 → exact는 facets 표기, 아니면 부분 일치 최대 8개); `validateFilters(filters, names) -> string[]` (오류 메시지 목록: 없는 브랜드, 대소문자 무시 중복, priceMax가 양의 정수 아님).
- Produces (`filters-git.js`): `readRemoteFilters(repoDir) -> object` (`git fetch origin main` 후 `git show origin/main:filters.json`); `saveFilters(repoDir, filters) -> { ok: true, commit } | { ok: false, error }` (파일 쓰기 → `git add filters.json` → commit → pull --rebase --autostash + push 최대 4회).

- [ ] **Step 1: 실패하는 테스트**

```js
test("matchBrand('dirk bikkembergs') → exact 'DIRK BIKKEMBERGS'", ...);
test("matchBrand('mcqueen') → exact null, candidates에 'ALEXANDER McQUEEN' 포함", ...);
test("validateFilters: 대소문자만 다른 중복, 없는 브랜드, priceMax 0 → 오류 3개", ...);
// filters-git: 임시 bare 원격 + 클론 2개. 클론 A에서 다른 파일 커밋·push(원격 앞서게),
// 클론 B에 미커밋 변경(other.txt) 둔 상태로 saveFilters 호출
test("saveFilters: 원격이 앞서도 성공, 커밋에는 filters.json만, other.txt 미커밋 변경은 그대로", ...);
```

- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 구현. git은 `child_process.execFileSync("git", [...], { cwd })`. 커밋 메시지 `Update Mercari filters (app)`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(inventory): Mercari filter validation and git save`.

### Task 7: IPC 연결 (`main.js`, `preload.js`)

**Files:** Modify `inventory-app/main.js`, `inventory-app/preload.js`

**Interfaces (renderer에서 `window.api.*`):**
- `getShopStats() -> computeShopStats 결과`, `getMonthlySales() -> computeMonthlySales 결과`
- `getAlerts() -> { discounts: computeDiscountAlerts(...), drops: [미확인 drop] }`, `applyDiscount(id, pct)` (`listPrice = discountedPrice(listedPrice, pct)`, `listPriceEdited: true`), `dismissDiscount(id, pct)`, `ackDrop(dropId)` — 상태는 `alerts-state.json` `{ dismissedDiscounts: {}, ackedDrops: [] }`
- `getWishlist() -> [{ id, title, lastPrice, soldOut, checkedAt, manual }]`, `addWishlistLink(url) -> { ok, id } | { ok:false, error }`, `removeWishlistLink(id)`
- `getFilters()` (원격 최신), `matchBrand(input)`, `saveFilters(filters) -> { ok, error?, errors? }` (validateFilters 통과해야 git 저장)
- `ledgerImport() -> { ok, transactionCount } | { ok:false, error }` (파일 선택 대화상자, 기본 위치 `~/Downloads`)
- 가계부용: preload가 `window.storage = { get(key), set(key, value) }`를 노출(IPC `ledger-get`/`ledger-set`). `BrowserWindow`에 `webPreferences.nodeIntegrationInSubFrames: true`를 줘서 iframe에도 preload가 돈다.

- [ ] **Step 1:** 구현.
- [ ] **Step 2:** `npm test` → PASS, `npm start`로 앱이 뜨고 콘솔 에러 없음 확인.
- [ ] **Step 3:** Commit `feat(inventory): wire shop-tool IPC`.

### Task 8: 화면 뼈대, 대시보드, 가계부 탭

**Files:** Modify `inventory-app/index.html`, `renderer.js`, `style.css`; Create `inventory-app/ledger/ledger.html` (`~/Documents/가계부.html` 복사본, 내용 수정 없음)

- [ ] **Step 1:** 상단 바에 [재고관리] [가계부] 전환. 재고관리 안에 왼쪽 메뉴(대시보드 / 재고 입력 / 찜 목록 / 메루카리 필터)와 맨 아래 🔔 알림 버튼+개수 뱃지. 기존 `#tab-list` 내용은 "재고 입력"으로. 기존 `overviewBody` 카드 줄은 대시보드로 대체하고 입력 탭에서는 뺀다(월별 정리 버튼은 유지).
- [ ] **Step 2:** 대시보드: 카드 4개(이번 달 매출, 이번 달 순이익, 회전율(업로드 기준) %, 판매중 재고원가)와 월별 매출·순이익 막대그래프(라이브러리 없이 div/SVG). 목업: `.superpowers/brainstorm/42423-1792331715/content/layout.html`.
- [ ] **Step 3:** 가계부 탭: `ledger/ledger.html`을 iframe으로 꽉 차게. 탭 상단에 작은 "백업 불러오기" 버튼 → `ledgerImport()` → 성공 시 "228건을 불러왔어요" 형태로 표시하고 iframe 새로고침.
- [ ] **Step 4:** `npm start`로 확인: 대시보드 숫자가 Task 1 함수 결과와 같음, 기존 입력/상태변경/월별 정리 동작, 가계부가 뜨고 입력한 거래가 앱 재시작 후에도 남음.
- [ ] **Step 5:** Commit `feat(inventory): app shell with dashboard and ledger tab`.

### Task 9: 알림 팝업, 찜 목록, 메루카리 필터 화면

**Files:** Modify `inventory-app/index.html`, `renderer.js`, `style.css`

- [ ] **Step 1:** 🔔 팝업: "할인 필요"(상품명, `업로드 N주째`, 현재가, `[N% 할인]` 버튼, X 버튼)와 "찜 상품 가격 인하"(상품명, `¥이전 → ¥새가격`, 보기 링크(켄즈포스트 링크), 확인 버튼). 뱃지 = 두 목록 개수 합. 할인/X/확인 후 즉시 갱신. 앱 포커스될 때와 5분마다 새로고침.
- [ ] **Step 2:** 찜 목록 탭: 표(사진, 제목, 현재가 ¥, 품절, 직접 추가 여부, 마지막 확인 시각, 삭제는 직접 추가 항목만) + 링크 입력칸/추가 버튼(잘못된 링크면 인라인 오류). "가격 확인은 30분마다 자동으로 돌아요" 안내.
- [ ] **Step 3:** 메루카리 필터 탭: 열 때 `getFilters()`. 브랜드 표(이름, 가격 상한 입력, 삭제), 브랜드 추가(입력 시 `matchBrand` 후보 목록 클릭으로 확정, 상한 기본 30000), 공통 제외 키워드 칩 추가/삭제, 브랜드별 제외 키워드. [저장] → 결과 표시(성공: "저장됐어요. 1분 안에 알림에 반영돼요", 실패: 오류 문구).
- [ ] **Step 4:** `npm start`로 확인: 실제 데이터로 할인 알림(판매중 12개 중 2주 이상 된 것들)이 뜨고, 버튼으로 가격이 바뀜. 찜 목록에 `wishlist-watch.json` 상품이 보임. 필터 탭에서 아무 것도 안 바꾸고 저장해도 커밋이 생기지 않거나 빈 커밋 없이 "변경 없음" 표시.
- [ ] **Step 5:** Commit `feat(inventory): alerts popup, wishlist and filter screens`.

### Task 10: 실제 데이터 옮기기와 최종 확인

- [ ] **Step 1:** 앱의 가계부 탭에서 `~/Downloads/가계부_백업_2026-10-18.json` 불러오기 → 228건 표시, 6/25~10/17 내역이 보임.
- [ ] **Step 2:** `inventory.json`을 작업 전 백업과 비교해 의도한 필드(`listPrice`, `listPriceEdited`) 외엔 바뀌지 않았는지 확인.
- [ ] **Step 3:** `launchctl kickstart -k gui/$(id -u)/com.collectroom.wishlist-watch` 후 로그/`wishlist-watch.json` 갱신 확인(에러 없음).
- [ ] **Step 4:** `npm test` 전체 PASS, `gh run list -L 3`의 Mercari brand alert가 success.
- [ ] **Step 5:** 사용자에게 결과와 바뀐 점 요약.
