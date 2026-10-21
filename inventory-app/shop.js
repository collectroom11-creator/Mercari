// 샵 운영 툴 화면: 왼쪽 사이드바 메뉴, 대시보드, 알림, 찜 목록, 메루카리 필터.
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
  document.querySelectorAll(".page-action").forEach((b) => (b.hidden = b.dataset.for !== pageId));
  if (pageRenderers[pageId]) pageRenderers[pageId]();
}

document.querySelectorAll(".side-link[data-page]").forEach((link) => {
  link.addEventListener("click", () => showPage(link.dataset.page));
});

// 사이드바 숨기기/보이기 (툴바 버튼, ⌘⌃S). 마지막 상태는 이 컴퓨터에 기억한다.
function setSidebarHidden(hidden) {
  document.body.classList.toggle("sidebar-hidden", hidden);
  try { localStorage.setItem("sidebarHidden", hidden ? "1" : "0"); } catch {}
}
try { setSidebarHidden(localStorage.getItem("sidebarHidden") === "1"); } catch {}
document.getElementById("sidebarToggle").addEventListener("click", () =>
  setSidebarHidden(!document.body.classList.contains("sidebar-hidden"))
);
document.addEventListener("keydown", (e) => {
  if (e.metaKey && e.ctrlKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    setSidebarHidden(!document.body.classList.contains("sidebar-hidden"));
  }
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
  // 타일마다 큰 숫자 하나 + 작은 보조 한 줄(재고 카드와 같은 위계). 라벨은 맨 위 작은 회색.
  const marginPct = s.monthRevenue > 0 ? Math.round((s.monthProfit / s.monthRevenue) * 100) : null;
  const cards = [
    ["이번 달 매출", bigNum(s.monthRevenue, "원"), "", `판매 ${s.monthSoldCount}건`],
    ["이번 달 순이익", bigNum(s.monthProfit, "원"), s.monthProfit >= 0 ? "positive" : "negative", marginPct == null ? "" : `순이익률 ${marginPct}%`],
    ["회전율", bigNum(s.turnoverPct, "%"), "", `판매중 재고원가 ${won(s.listedCost)}`],
    ["재고원가 합계", bigNum(s.stockCost, "원"), "", "배송전 · 업로드전 · 판매중"],
  ];
  document.getElementById("statCards").innerHTML = cards
    .map(([label, value, cls, sub]) => `
      <div class="stat-card">
        <div class="stat-label">${label}</div>
        <div class="stat-value ${cls}">${value}</div>
        <div class="stat-sub">${sub || "&nbsp;"}</div>
      </div>`)
    .join("");

  // 차트 제목 오른쪽에 이번 달 값을 작게
  const last = months[months.length - 1];
  document.getElementById("revenueNow").textContent = last ? `이번 달 ${shortWon(last.revenue)}` : "";
  document.getElementById("profitNow").textContent = last ? `이번 달 ${shortWon(last.profit)}` : "";

  renderDashboardLists(await window.api.listItems());

  renderLineChart(document.getElementById("revenueChart"), months, "revenue", cssVar("--accent"));
  renderLineChart(document.getElementById("profitChart"), months, "profit", cssVar("--positive"));
}

// 대시보드 아래쪽: 재고 현황 막대 + 최근 판매 / 오래 머문 상품 목록(재고 보드와 같은 행 스타일)
function renderDashboardLists(items) {
  const DAY = 86400000;
  const days = (from, to = new Date()) => Math.max(0, Math.floor((new Date(to) - new Date(from)) / DAY));

  const groups = [
    { name: "배송전", color: "var(--tertiary)", match: (i) => i.status === "배송전" },
    { name: "업로드전", color: "var(--warning)", match: (i) => i.status === "업로드전" },
    { name: "판매중", color: "var(--accent)", match: (i) => i.status === "판매중" || i.status === "재고" },
  ].map((g) => {
    const list = items.filter(g.match);
    return { ...g, count: list.length, cost: list.reduce((s, i) => s + i.costKrw, 0) };
  });
  const total = groups.reduce((s, g) => s + g.cost, 0) || 1;
  document.getElementById("stockMix").innerHTML = `
    <div class="chart-head"><span class="chart-title">재고 현황</span><span class="chart-now">원가 기준</span></div>
    <div class="mix-bar">${groups.map((g) => `<span style="width:${(g.cost / total) * 100}%;background:${g.color}"></span>`).join("")}</div>
    <div class="mix-legend">${groups.map((g) => `
      <div><span class="mix-dot" style="background:${g.color}"></span>${g.name} <b>${g.count}개</b> <span class="muted">${shortWon(g.cost)}</span></div>`).join("")}
    </div>`;

  const row = (i, right, rightClass = "") => `
    <div class="drow" data-open-url="${escapeHtml(i.sourceUrl || "")}" title="${escapeHtml(i.title)}">
      <div class="dphoto" style="background-image:url('${i.imageUrl || ""}')"></div>
      <div class="dbody">
        <div class="dprice">${Number(i.actualPrice ?? i.listPrice ?? i.targetPrice ?? 0).toLocaleString()}<small>원</small></div>
        <div class="dsub">원가 ${i.costKrw.toLocaleString()}</div>
      </div>
      <div class="dright ${rightClass}">${right}</div>
    </div>`;

  const sold = items
    .filter((i) => i.status === "판매완료" && i.soldAt)
    .sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt))
    .slice(0, 20);
  document.getElementById("recentSold").innerHTML = sold.length
    ? sold.map((i) => row(i, i.listedAt ? (days(i.listedAt, i.soldAt) === 0 ? "당일" : `${days(i.listedAt, i.soldAt)}일`) : "-")).join("")
    : `<div class="empty">아직 판매 기록이 없어요</div>`;

  const stale = items
    .filter((i) => (i.status === "판매중" || i.status === "재고") && i.listedAt)
    .sort((a, b) => new Date(a.listedAt) - new Date(b.listedAt))
    .slice(0, 20);
  document.getElementById("staleListed").innerHTML = stale.length
    ? stale.map((i) => { const d = days(i.listedAt); return row(i, `${d}일째`, d >= 14 ? "warn" : ""); }).join("")
    : `<div class="empty">판매중인 상품이 없어요</div>`;

  document.querySelectorAll(".drow[data-open-url]").forEach((r) =>
    r.addEventListener("click", () => r.dataset.openUrl && window.api.openExternal(r.dataset.openUrl))
  );
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
  const W = 420, H = 160, padX = 30, padTop = 26, padBottom = 26;
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
  const tb = document.getElementById("toolbarAlertsBadge");
  tb.textContent = count;
  tb.hidden = count === 0;

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

document.getElementById("toolbarAlertsBtn").addEventListener("click", (e) => alertsBtn.onclickHandler(e));
alertsBtn.onclickHandler = (e) => {
  e.stopPropagation();
  alertsPopup.hidden = !alertsPopup.hidden;
  if (!alertsPopup.hidden) refreshAlerts();
};
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
// 메루카리 상품 대표 사진은 id만 있으면 이 주소로 바로 받을 수 있다.
const mercariPhoto = (id) => `https://static.mercdn.net/item/detail/orig/photos/${id}_1.jpg`;

// 찜 목록: 이름 대신 사진 위주의 격자(사진 앱 느낌). 사진 아래 현재가와 마지막 확인.
async function renderWishlist() {
  const page = document.getElementById("page-wishlist");
  const { items, lastRunAt } = await window.api.getWishlist();
  const fmt = (iso) => (iso ? friendlyTime(iso) : "-");
  const tiles = items
    .sort((a, b) => Number(a.soldOut) - Number(b.soldOut))
    .map((w) => `
      <div class="wtile ${w.soldOut ? "dimmed" : ""}" title="${escapeHtml(w.title)}" data-open="${w.id}">
        <div class="wphoto" style="background-image:url('${mercariPhoto(w.id)}')">
          ${w.soldOut ? '<span class="wtag">품절</span>' : w.manual ? '<span class="wtag">직접 추가</span>' : ""}
          <button class="wremove" data-remove="${w.id}" title="찜 목록에서 삭제">✕</button>
        </div>
        <div class="wprice">${w.lastPrice != null ? yen(w.lastPrice) : "-"}</div>
        <div class="wtime">${fmt(w.checkedAt)}</div>
      </div>`).join("");
  page.innerHTML = `
    <div class="wish-add">
      <div class="add-row">
        <input id="wishLinkInput" placeholder="켄즈포스트 메루카리 링크나 jp.mercari.com 링크로 찜 추가">
        <button id="wishAddBtn" class="round-go" title="추가" aria-label="추가"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </div>
      <div id="wishAddMsg"></div>
      <p class="hint">켄즈포스트 관심상품은 자동으로 들어와요 · 가격 확인은 30분마다 · 마지막 확인 ${fmt(lastRunAt)}</p>
    </div>
    <div class="wgrid">${tiles || `<div class="empty">찜 상품이 없어요</div>`}</div>`;

  const msg = document.getElementById("wishAddMsg");
  const add = async () => {
    const input = document.getElementById("wishLinkInput");
    const r = await window.api.addWishlistLink(input.value.trim());
    if (!r.ok) {
      msg.className = "inline-error";
      msg.textContent = r.error;
      return;
    }
    renderWishlist();
  };
  document.getElementById("wishAddBtn").addEventListener("click", add);
  document.getElementById("wishLinkInput").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  document.getElementById("wishLinkInput").addEventListener("input", () => (msg.textContent = ""));
  page.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("찜 목록에서 삭제할까요? 가격 확인도 멈춰요.")) return;
      await window.api.removeWishlistLink(b.dataset.remove);
      renderWishlist();
    })
  );
  page.querySelectorAll(".wtile[data-open]").forEach((t) =>
    t.addEventListener("click", () => window.api.openExternal(kenzLink(t.dataset.open)))
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
      <div class="bkw"><div class="bkw-name">${escapeHtml(brand)}</div>
        <div>${chipList(words, (i) => `data-del-bkw="${escapeHtml(brand)}" data-idx="${i}"`)}</div>
        <div class="inline-row"><input placeholder="${escapeHtml(brand)} 제외 키워드 추가" data-bkw-input="${escapeHtml(brand)}"><button class="btn-ghost btn-sm" data-add-bkw="${escapeHtml(brand)}">추가</button></div>
      </div>`).join("");
  // 왼쪽: 브랜드(패널 안에서만 스크롤), 오른쪽: 공통 / 브랜드별 제외 키워드. 저장은 툴바 버튼.
  page.innerHTML = `
    <div class="filters-layout">
      <section class="fpanel fbrands">
        <div class="fhead"><h2 class="page-title">브랜드 <span class="muted">${f.brands.length}개</span></h2></div>
        <div id="filterMsg">${message}</div>
        <div class="inline-row fadd">
          <input id="brandInput" placeholder="브랜드 이름 (메루카리 표기로 확인해요)">
          <input id="brandPriceInput" class="price-input" type="text" inputmode="numeric" value="30,000"><span class="unit">엔 이하</span>
          <button id="brandAddBtn" class="btn-ghost">추가</button>
        </div>
        <div id="brandCandidates" class="candidate-list"></div>
        <div class="fscroll"><table class="item-table"><tbody>${brandRows}</tbody></table></div>
      </section>
      <div class="fside">
        <section class="fpanel">
          <h2 class="page-title">공통 제외 키워드</h2>
          <div>${chipList(f.excludeKeywords, (i) => `data-del-kw="${i}"`)}</div>
          <div class="inline-row"><input id="kwInput" placeholder="제목에 이 단어가 있으면 알림 제외"><button id="kwAddBtn" class="btn-ghost btn-sm">추가</button></div>
        </section>
        <section class="fpanel fgrow">
          <h2 class="page-title">브랜드별 제외 키워드</h2>
          <div class="fscroll">${brandKw}</div>
          <div class="inline-row"><select id="bkwBrandSelect">${f.brands.filter((b) => !f.brandExcludeKeywords[b.name]).map((b) => `<option>${escapeHtml(b.name)}</option>`).join("")}</select><button id="bkwBrandAddBtn" class="btn-ghost btn-sm">브랜드 추가</button></div>
        </section>
      </div>
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
}

// 저장 버튼은 툴바에 고정이라 한 번만 연결한다.
document.getElementById("filterSaveBtn").addEventListener("click", async () => {
    if (!filterDraft) return;
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
pageRenderers["page-filters"] = loadFilterPage;

renderDashboard();
refreshAlerts();
