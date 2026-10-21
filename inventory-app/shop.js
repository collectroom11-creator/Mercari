// 샵 운영 툴 화면: 왼쪽 사이드바 메뉴, 대시보드, 알림, 찜 목록, 메루카리 필터, 가계부.
// 재고 입력 보드는 renderer.js가 담당한다.

const won = (n) => `${Math.round(n).toLocaleString()}원`;
// 입력칸 숫자도 화면의 다른 숫자처럼 쉼표를 찍어 보여준다(입력칸은 type=text).
const fmtNum = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString());
const parseNum = (s) => Number(String(s).replace(/[^\d]/g, "")) || 0;
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---- 왼쪽 사이드바 메뉴 ----
const pageRenderers = {};

function showPage(pageId) {
  const links = document.querySelectorAll(".side-link[data-page]");
  links.forEach((l) => l.classList.toggle("active", l.dataset.page === pageId));
  document.querySelectorAll(".content-body .page").forEach((p) => p.classList.toggle("active", p.id === pageId));
  const link = [...links].find((l) => l.dataset.page === pageId);
  document.getElementById("pageTitle").textContent = link ? link.textContent.trim() : "";
  if (pageRenderers[pageId]) pageRenderers[pageId]();
}

document.querySelectorAll(".side-link[data-page]").forEach((link) => {
  link.addEventListener("click", () => showPage(link.dataset.page));
});

// 창이 비활성이면 사이드바 선택 표시를 회색으로(맥 기본 앱과 같은 동작)
window.addEventListener("blur", () => document.body.classList.add("inactive"));
window.addEventListener("focus", () => document.body.classList.remove("inactive"));
document.body.classList.toggle("inactive", !document.hasFocus()); // 백그라운드에서 열렸을 때

// 최신 macOS처럼 툴바 아래 구분선은 평소엔 없고, 본문을 스크롤했을 때만 보인다.
const contentBody = document.querySelector(".content-body");
contentBody.addEventListener("scroll", () => {
  document.querySelector(".toolbar").classList.toggle("scrolled", contentBody.scrollTop > 0);
});

// 큰 숫자: 숫자는 크게(semibold), 단위(원, %)는 작은 회색으로 따로 붙인다.
const bigNum = (n, unit) => `${Math.round(n).toLocaleString()}<small>${unit}</small>`;
// 차트 색은 다크 모드에 따라 바뀌는 CSS 변수를 그대로 쓴다.
const cssVar = (name) => `var(${name})`;

// ---- 대시보드 ----
async function renderDashboard() {
  const [s, months] = await Promise.all([window.api.getShopStats(), window.api.getMonthlySales()]);
  const cards = [
    ["이번 달 매출", bigNum(s.monthRevenue, "원"), "", ""],
    ["이번 달 순이익", bigNum(s.monthProfit, "원"), s.monthProfit >= 0 ? "positive" : "negative", ""],
    ["회전율 (업로드 기준)", bigNum(s.turnoverPct, "%"), "", `판매중 재고원가 ${won(s.listedCost)}`],
    ["재고원가 합계", bigNum(s.stockCost, "원"), "", "배송전 · 업로드전 · 판매중"],
  ];
  document.getElementById("statCards").innerHTML = cards
    .map(([label, value, cls, sub]) => `
      <div class="stat-card">
        <div class="stat-label">${label}</div>
        <div class="stat-value ${cls}">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
      </div>`)
    .join("");

  renderLineChart(document.getElementById("revenueChart"), months, "revenue", cssVar("--accent"));
  renderLineChart(document.getElementById("profitChart"), months, "profit", cssVar("--positive"));
}

// 만 원 단위로 짧게: 584000 → "58.4만"
function shortWon(n) {
  const man = n / 10000;
  return `${Math.abs(man) >= 100 ? Math.round(man) : Math.round(man * 10) / 10}만`;
}

function renderLineChart(el, months, key, color) {
  if (months.length === 0) {
    el.innerHTML = `<div class="empty">아직 판매 기록이 없어요</div>`;
    return;
  }
  const W = 420, H = 180, padX = 36, padTop = 28, padBottom = 28;
  const values = months.map((m) => m[key]);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const x = (i) => (months.length === 1 ? W / 2 : padX + (i * (W - padX * 2)) / (months.length - 1));
  const y = (v) => padTop + ((max - v) / range) * (H - padTop - padBottom);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  // 요즘 애플 차트처럼: 옅은 가로 안내선, 선 아래 은은한 채움, 작은 꽉 찬 점
  const base = y(Math.max(min, 0));
  const area = `${x(0)},${base} ${points} ${x(values.length - 1)},${base}`;
  const gridYs = [padTop, (padTop + (H - padBottom)) / 2, H - padBottom];
  const gradId = `fill-${key}`;
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="line-svg" role="img">
      <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:${color};stop-opacity:0.18"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/>
      </linearGradient></defs>
      ${gridYs.map((gy) => `<line x1="${padX}" x2="${W - padX}" y1="${gy}" y2="${gy}" style="stroke:var(--separator)" stroke-width="0.8"/>`).join("")}
      <polygon points="${area}" fill="url(#${gradId})"/>
      <polyline points="${points}" fill="none" style="stroke:${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${values.map((v, i) => `
        <circle cx="${x(i)}" cy="${y(v)}" r="2.8" style="fill:${v < 0 ? "var(--negative)" : color}"/>
        ${v !== 0 ? `<text x="${x(i)}" y="${y(v) - 10}" text-anchor="middle" class="line-value ${v < 0 ? "neg" : ""}">${shortWon(v)}</text>` : ""}
        <text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="line-label">${Number(months[i].month.slice(5))}월</text>`).join("")}
    </svg>`;
}
pageRenderers["page-dashboard"] = renderDashboard;

// 재고가 바뀔 때(renderer.js의 renderList) 대시보드와 알림도 같이 갱신한다.
function refreshShopPanels() {
  if (document.getElementById("page-dashboard").classList.contains("active")) renderDashboard();
  if (typeof refreshAlerts === "function") refreshAlerts();
}

// ---- 가계부 ----
document.getElementById("ledgerImportBtn").addEventListener("click", async () => {
  const result = document.getElementById("ledgerImportResult");
  const r = await window.api.ledgerImport();
  if (r.canceled) return;
  if (!r.ok) {
    result.textContent = `불러오기 실패: ${r.error}`;
    return;
  }
  result.textContent = `거래 ${r.transactionCount.toLocaleString()}건을 불러왔어요`;
  document.getElementById("ledgerFrame").contentWindow.location.reload();
});

// ---- 알림 팝업 (할인 필요 + 찜 가격 인하) ----
const alertsBtn = document.getElementById("alertsBtn");
const alertsPopup = document.getElementById("alertsPopup");
const alertsBadge = document.getElementById("alertsBadge");
const yen = (n) => `¥${Number(n).toLocaleString()}`;
// "오늘 12:51", "어제 23:10", "10월 17일"처럼 사람이 읽기 쉬운 시각
function friendlyTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const hm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dayDiff = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (dayDiff === 0) return `오늘 ${hm}`;
  if (dayDiff === 1) return `어제 ${hm}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
const kenzLink = (id) => `https://kenzpost.com/mercari/bid.s/https://jp.mercari.com/item/${id}`;

async function refreshAlerts() {
  const { discounts, drops } = await window.api.getAlerts();
  const count = discounts.length + drops.length;
  alertsBadge.textContent = count;
  alertsBadge.hidden = count === 0;

  const discountRows = discounts.length
    ? discounts.map((a) => `
        <div class="alert-row">
          <div class="alert-main">
            <div class="alert-title">${escapeHtml(a.title)}</div>
            <div class="alert-sub">업로드 ${a.weeks}주째 · ${won(a.listPrice)} → ${won(a.newPrice)}</div>
          </div>
          <button class="alert-action" data-discount="${a.id}" data-pct="${a.pct}">${a.pct}% 할인</button>
          <button class="alert-close" data-dismiss="${a.id}" data-pct="${a.pct}" title="닫기">✕</button>
        </div>`).join("")
    : `<div class="alerts-empty">할인이 필요한 상품이 없어요</div>`;
  const dropRows = drops.length
    ? drops.map((d) => `
        <div class="alert-row">
          <div class="alert-main">
            <div class="alert-title">${escapeHtml(d.title)}</div>
            <div class="alert-sub">${yen(d.oldPrice)} → <b class="negative">${yen(d.newPrice)}</b></div>
          </div>
          <button class="alert-action" data-open="${d.id}">보기</button>
          <button class="alert-close" data-ack="${escapeHtml(d.dropId)}" title="확인">✕</button>
        </div>`).join("")
    : `<div class="alerts-empty">가격이 내려간 찜 상품이 없어요</div>`;
  alertsPopup.innerHTML = `
    <div class="alerts-section-title">할인 필요</div>${discountRows}
    <div class="alerts-section-title">찜 상품 가격 인하</div>${dropRows}`;
}

alertsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  alertsPopup.hidden = !alertsPopup.hidden;
  if (!alertsPopup.hidden) refreshAlerts();
});
document.addEventListener("click", (e) => {
  if (!alertsPopup.hidden && !alertsPopup.contains(e.target)) alertsPopup.hidden = true;
});
alertsPopup.addEventListener("click", async (e) => {
  e.stopPropagation();
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.discount) {
    await window.api.applyDiscount(b.dataset.discount, Number(b.dataset.pct));
    if (typeof renderList === "function") renderList();
  } else if (b.dataset.dismiss) {
    await window.api.dismissDiscount(b.dataset.dismiss, Number(b.dataset.pct));
  } else if (b.dataset.open) {
    window.api.openExternal(kenzLink(b.dataset.open));
    return;
  } else if (b.dataset.ack) {
    await window.api.ackDrop(b.dataset.ack);
  }
  refreshAlerts();
});
window.addEventListener("focus", refreshAlerts);
setInterval(refreshAlerts, 5 * 60 * 1000);

// ---- 찜 목록 ----
async function renderWishlist() {
  const page = document.getElementById("page-wishlist");
  const { items, lastRunAt } = await window.api.getWishlist();
  const fmt = (iso) => (iso ? friendlyTime(iso) : "-");
  // 품절된 건 흐리게 맨 아래로. 출처는 대부분 켄즈포스트라 "직접 추가"만 작은 뱃지로 표시한다.
  const rows = items
    .sort((a, b) => Number(a.soldOut) - Number(b.soldOut))
    .map((w) => `
      <tr class="${w.soldOut ? "dimmed" : ""}">
        <td class="col-title"><a href="#" data-open="${w.id}">${escapeHtml(w.title)}</a>${w.manual ? ' <span class="badge">직접 추가</span>' : ""}${w.soldOut ? ' <span class="badge">품절</span>' : ""}</td>
        <td class="col-num">${w.lastPrice != null ? yen(w.lastPrice) : "-"}</td>
        <td class="col-num muted">${fmt(w.checkedAt)}</td>
        <td class="col-action">${w.manual ? `<button class="row-remove" data-remove="${w.id}" title="삭제">−</button>` : ""}</td>
      </tr>`).join("");
  page.innerHTML = `
    <div class="page-card">
      <h2 class="page-title">찜 상품 추가</h2>
      <div class="inline-row">
        <input id="wishLinkInput" placeholder="켄즈포스트 메루카리 링크나 jp.mercari.com 링크">
        <button id="wishAddBtn" class="btn-primary">추가</button>
      </div>
      <div id="wishAddMsg"></div>
      <p class="hint">켄즈포스트 관심상품은 자동으로 들어와요. 가격 확인은 30분마다 자동으로 돌아요 · 마지막 확인 ${fmt(lastRunAt)}</p>
    </div>
    <div class="page-card table-wrap">
      <table class="item-table">
        <thead><tr><th class="col-title">상품</th><th class="col-num">현재가</th><th class="col-num">마지막 확인</th><th class="col-action"></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">찜 상품이 없어요</td></tr>`}</tbody>
      </table>
    </div>`;

  const msg = document.getElementById("wishAddMsg");
  document.getElementById("wishAddBtn").addEventListener("click", async () => {
    const input = document.getElementById("wishLinkInput");
    const r = await window.api.addWishlistLink(input.value.trim());
    if (!r.ok) {
      msg.className = "inline-error";
      msg.textContent = r.error;
      return;
    }
    renderWishlist();
  });
  document.getElementById("wishLinkInput").addEventListener("input", () => (msg.textContent = ""));
  page.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", async () => {
      await window.api.removeWishlistLink(b.dataset.remove);
      renderWishlist();
    })
  );
  page.querySelectorAll("[data-open]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      window.api.openExternal(kenzLink(a.dataset.open));
    })
  );
}
pageRenderers["page-wishlist"] = renderWishlist;

// ---- 메루카리 필터 ----
let filterDraft = null;

async function loadFilterPage() {
  const page = document.getElementById("page-filters");
  page.innerHTML = `<div class="page-card">GitHub에서 최신 필터를 불러오는 중...</div>`;
  const r = await window.api.getFilters();
  if (!r.ok) {
    page.innerHTML = `<div class="page-card"><div class="inline-error">필터를 불러오지 못했어요: ${escapeHtml(r.error)}</div></div>`;
    return;
  }
  filterDraft = structuredClone(r.filters);
  renderFilterPage();
}

function chipList(words, makeAttrs) {
  return words.map((w, i) => `<span class="chip">${escapeHtml(w)}<button ${makeAttrs(i)} title="삭제">✕</button></span>`).join("");
}

function renderFilterPage(message = "") {
  const page = document.getElementById("page-filters");
  const f = filterDraft;
  const brandRows = f.brands
    .map((b, i) => `
      <tr>
        <td class="col-title">${escapeHtml(b.name)}</td>
        <td class="col-num"><input class="price-input" type="text" inputmode="numeric" value="${fmtNum(b.priceMax)}" data-price="${i}"><span class="unit">엔 이하</span></td>
        <td class="col-action"><button class="row-remove" data-del-brand="${i}" title="삭제">−</button></td>
      </tr>`).join("");
  const brandKw = Object.entries(f.brandExcludeKeywords)
    .map(([brand, words]) => `
      <div style="margin-bottom:10px"><b>${escapeHtml(brand)}</b>
        <div>${chipList(words, (i) => `data-del-bkw="${escapeHtml(brand)}" data-idx="${i}"`)}</div>
        <div class="inline-row"><input placeholder="${escapeHtml(brand)} 제외 키워드 추가" data-bkw-input="${escapeHtml(brand)}"><button class="btn-ghost btn-sm" data-add-bkw="${escapeHtml(brand)}">추가</button></div>
      </div>`).join("");
  page.innerHTML = `
    <div class="page-card">
      <div class="inline-row" style="justify-content:space-between">
        <h2 class="page-title" style="margin:0">브랜드 (${f.brands.length}개)</h2>
        <button id="filterSaveBtn" class="btn-primary">저장</button>
      </div>
      <div id="filterMsg">${message}</div>
      <div class="inline-row" style="margin-top:12px">
        <input id="brandInput" placeholder="브랜드 이름 (메루카리 표기로 확인해요)">
        <input id="brandPriceInput" class="price-input" type="text" inputmode="numeric" value="30,000"><span class="unit">엔 이하</span>
        <button id="brandAddBtn" class="btn-ghost">추가</button>
      </div>
      <div id="brandCandidates" class="candidate-list"></div>
      <div class="table-wrap" style="margin-top:12px">
        <table class="item-table"><tbody>${brandRows}</tbody></table>
      </div>
    </div>
    <div class="page-card">
      <h2 class="page-title">공통 제외 키워드</h2>
      <div>${chipList(f.excludeKeywords, (i) => `data-del-kw="${i}"`)}</div>
      <div class="inline-row"><input id="kwInput" placeholder="제목에 이 단어가 있으면 알림 제외"><button id="kwAddBtn" class="btn-ghost btn-sm">추가</button></div>
    </div>
    <div class="page-card">
      <h2 class="page-title">브랜드별 제외 키워드</h2>
      ${brandKw}
      <div class="inline-row"><select id="bkwBrandSelect">${f.brands.filter((b) => !f.brandExcludeKeywords[b.name]).map((b) => `<option>${escapeHtml(b.name)}</option>`).join("")}</select><button id="bkwBrandAddBtn" class="btn-ghost btn-sm">브랜드 추가</button></div>
    </div>`;
  bindFilterPage();
}

function setFilterMsg(text, ok) {
  const el = document.getElementById("filterMsg");
  el.className = ok ? "inline-ok" : "inline-error";
  el.textContent = text;
}

function addBrand(name) {
  const price = parseNum(document.getElementById("brandPriceInput").value);
  if (!Number.isInteger(price) || price <= 0) return setFilterMsg("가격 상한을 숫자로 넣어주세요", false);
  if (filterDraft.brands.some((b) => b.name.toLowerCase() === name.toLowerCase())) return setFilterMsg(`${name}은(는) 이미 있어요`, false);
  filterDraft.brands.push({ name, priceMax: price });
  renderFilterPage(`<div class="inline-ok">${escapeHtml(name)} 추가됨 - 저장을 눌러야 반영돼요</div>`);
}

function bindFilterPage() {
  const page = document.getElementById("page-filters");
  page.querySelectorAll("[data-price]").forEach((inp) =>
    inp.addEventListener("change", () => {
      filterDraft.brands[Number(inp.dataset.price)].priceMax = parseNum(inp.value);
      inp.value = fmtNum(parseNum(inp.value));
    })
  );
  page.querySelectorAll("[data-del-brand]").forEach((b) =>
    b.addEventListener("click", () => {
      const [removed] = filterDraft.brands.splice(Number(b.dataset.delBrand), 1);
      delete filterDraft.brandExcludeKeywords[removed.name];
      renderFilterPage();
    })
  );
  document.getElementById("brandAddBtn").addEventListener("click", async () => {
    const input = document.getElementById("brandInput").value.trim();
    if (!input) return;
    const { exact, candidates } = await window.api.matchBrand(input);
    if (exact) return addBrand(exact);
    const box = document.getElementById("brandCandidates");
    if (!candidates.length) {
      box.innerHTML = "";
      return setFilterMsg(`메루카리에 '${input}' 브랜드가 없어요. 표기를 확인해주세요`, false);
    }
    setFilterMsg("정확히 같은 이름이 없어요. 아래에서 골라주세요", false);
    box.innerHTML = candidates.map((c) => `<button class="candidate" data-cand="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("");
    box.querySelectorAll("[data-cand]").forEach((c) => c.addEventListener("click", () => addBrand(c.dataset.cand)));
  });
  page.querySelectorAll("[data-del-kw]").forEach((b) =>
    b.addEventListener("click", () => {
      filterDraft.excludeKeywords.splice(Number(b.dataset.delKw), 1);
      renderFilterPage();
    })
  );
  document.getElementById("kwAddBtn").addEventListener("click", () => {
    const v = document.getElementById("kwInput").value.trim();
    if (v && !filterDraft.excludeKeywords.includes(v)) filterDraft.excludeKeywords.push(v);
    renderFilterPage();
  });
  page.querySelectorAll("[data-del-bkw]").forEach((b) =>
    b.addEventListener("click", () => {
      const brand = b.dataset.delBkw;
      filterDraft.brandExcludeKeywords[brand].splice(Number(b.dataset.idx), 1);
      renderFilterPage();
    })
  );
  page.querySelectorAll("[data-add-bkw]").forEach((b) =>
    b.addEventListener("click", () => {
      const brand = b.dataset.addBkw;
      const v = page.querySelector(`[data-bkw-input="${CSS.escape(brand)}"]`).value.trim();
      if (v && !filterDraft.brandExcludeKeywords[brand].includes(v)) filterDraft.brandExcludeKeywords[brand].push(v);
      renderFilterPage();
    })
  );
  document.getElementById("bkwBrandAddBtn").addEventListener("click", () => {
    const brand = document.getElementById("bkwBrandSelect").value;
    if (brand) filterDraft.brandExcludeKeywords[brand] = [];
    renderFilterPage();
  });
  document.getElementById("filterSaveBtn").addEventListener("click", async () => {
    // 키워드가 하나도 없는 브랜드별 항목은 저장하지 않는다.
    const toSave = structuredClone(filterDraft);
    for (const [brand, words] of Object.entries(toSave.brandExcludeKeywords)) {
      if (!words.length) delete toSave.brandExcludeKeywords[brand];
    }
    setFilterMsg("저장 중...", true);
    const r = await window.api.saveFilters(toSave);
    if (r.ok && r.unchanged) return setFilterMsg("바뀐 내용이 없어요", true);
    if (r.ok) return setFilterMsg("저장됐어요. 1분 안에 알림에 반영돼요", true);
    setFilterMsg(r.errors ? r.errors.join(" / ") : `저장 실패: ${r.error}`, false);
  });
}
pageRenderers["page-filters"] = loadFilterPage;

renderDashboard();
refreshAlerts();
