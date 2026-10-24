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
const STATUS_COLORS = { 배송전: "var(--tertiary)", 업로드전: "var(--warning)", 판매중: "var(--accent)" };
let brandMixData = null;
let brandMixMode = "count";

async function renderDashboard() {
  const [s, months, mix] = await Promise.all([window.api.getShopStats(), window.api.getMonthlySales(), window.api.getBrandMix()]);
  const cur = months[months.length - 1] || { revenue: 0, profit: 0 };
  const prev = months[months.length - 2];
  // 지난달 대비: 화살표 + 차이. 지난달이 0이면 비교하지 않는다.
  const vsPrev = (key) => {
    if (!prev) return "";
    const diff = cur[key] - prev[key];
    if (diff === 0) return " · 지난달과 같음";
    return ` · 지난달보다 <span class="${diff > 0 ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${shortWon(Math.abs(diff))}</span>`;
  };
  const marginPct = s.monthRevenue > 0 ? Math.round((s.monthProfit / s.monthRevenue) * 100) : null;

  document.getElementById("revenueHero").innerHTML = bigNum(s.monthRevenue, "원");
  document.getElementById("revenueSub").innerHTML = `판매 <b>${s.monthSoldCount}건</b>${vsPrev("revenue")}`;
  const profitHero = document.getElementById("profitHero");
  profitHero.innerHTML = bigNum(s.monthProfit, "원");
  profitHero.classList.toggle("negative", s.monthProfit < 0);
  document.getElementById("profitSub").innerHTML = `${marginPct == null ? "" : `순이익률 <b>${marginPct}%</b>`}${vsPrev("profit")}`;

  renderKpis(s);
  brandMixData = mix;
  renderBrandMix();

  dashMonths = months;
  drawDashCharts();
}

// 창 크기가 바뀌면 그래프 칸 크기에 맞춰 다시 그린다
let dashMonths = null;
function drawDashCharts() {
  if (!dashMonths) return;
  renderLineChart(document.getElementById("revenueChart"), dashMonths, "revenue", cssVar("--accent"));
  renderLineChart(document.getElementById("profitChart"), dashMonths, "profit", cssVar("--positive"));
}
new ResizeObserver(drawDashCharts).observe(document.getElementById("revenueChart"));

// 재고 지표 3개. 재고원가는 목표(설정 stockTargetKrw, 기본 500만) 대비 모자람/넘침과 단계별 구성을 같이 보여준다.
function renderKpis(s) {
  const target = s.stockTargetKrw;
  const gap = s.stockCost - target;
  const scale = Math.max(target, s.stockCost) || 1;
  const segs = s.stockByStatus.map((g) => `<span style="width:${(g.cost / scale) * 100}%;background:${STATUS_COLORS[g.status]}"></span>`).join("");
  const targetLine = s.stockCost > target ? `<i class="target-line" style="left:${(target / scale) * 100}%"></i>` : "";
  const margin = s.avgMarginPct == null ? "-" : bigNum(s.avgMarginPct, "%");
  document.getElementById("dashKpis").innerHTML = `
    <div class="kpi">
      <div class="kpi-head"><span class="kpi-label">재고원가 · 목표 ${shortWon(target)}</span>
        <span class="kpi-target ${gap < 0 ? "short" : "over"}">${gap < 0 ? `${shortWon(-gap)} 부족` : gap === 0 ? "목표 달성" : `${shortWon(gap)} 초과`}</span></div>
      <div class="kpi-value">${bigNum(s.stockCost, "원")}</div>
      <div class="target-bar">${segs}${targetLine}</div>
      <div class="mix-legend">${s.stockByStatus.map((g) => `
        <span><span class="mix-dot" style="background:${STATUS_COLORS[g.status]}"></span>${g.status}<b>${g.count}개 · ${shortWon(g.cost)}</b></span>`).join("")}
      </div>
    </div>
    <div class="kpi simple">
      <div class="kpi-label">평균 마진율</div>
      <div class="kpi-value">${margin}</div>
      <div class="kpi-sub">판매 <b>${s.soldAvgMarginPct ?? "-"}%</b> · 재고 <b>${s.stockAvgMarginPct ?? "-"}%</b></div>
    </div>
    <div class="kpi simple">
      <div class="kpi-label">회전율 · 이번 달</div>
      <div class="kpi-value">${bigNum(s.turnoverPct, "%")}</div>
      <div class="kpi-sub">판매중 원가 <b>${shortWon(s.listedCost)}</b></div>
    </div>`;
}

// 브랜드 비율 도넛 + 오른쪽 표 (상품 수 / 재고원가 전환). 조각이나 표 줄에 올리면 그 브랜드만 진하게.
document.querySelectorAll("#brandMixMode button").forEach((b) =>
  b.addEventListener("click", () => {
    brandMixMode = b.dataset.mode;
    document.querySelectorAll("#brandMixMode button").forEach((x) => x.classList.toggle("active", x === b));
    renderBrandMix();
  })
);

function renderBrandMix() {
  const box = document.getElementById("brandMix");
  const mix = brandMixData && brandMixData[brandMixMode];
  if (!mix || !mix.total) {
    box.innerHTML = `<div class="empty">재고가 없어요</div>`;
    return;
  }
  const byCost = brandMixMode === "cost";
  const fmt = (v) => (byCost ? shortWon(v) : `${v}개`);
  const color = (s, i) => (s.name === "기타" ? "var(--brand-other)" : `var(--brand-${i + 1})`);
  const pct = (v) => Math.round((v / mix.total) * 100);
  const R = 84, r = 56, C = 84;
  const pt = (rad, a) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
  let a0 = 0;
  const paths = mix.slices.map((s, i) => {
    const a1 = a0 + (s.value / mix.total) * Math.PI * 2;
    const end = a1 - a0 >= Math.PI * 2 ? a1 - 1e-4 : a1;
    const large = end - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, end), [x2, y2] = pt(r, end), [x3, y3] = pt(r, a0);
    const d = `M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r},${r} 0 ${large} 0 ${x3},${y3}Z`;
    a0 = a1;
    return `<path d="${d}" fill="${color(s, i)}" data-i="${i}"></path>`;
  });
  const totalLabel = byCost ? "지금 재고원가" : "지금 재고";
  const center = (num, sub) => `<text x="${C}" y="${C + 2}" text-anchor="middle" class="donut-center-num">${num}</text><text x="${C}" y="${C + 22}" text-anchor="middle" class="donut-center-sub">${sub}</text>`;
  box.innerHTML = `
    <svg class="donut" viewBox="0 0 168 168">${paths.join("")}<g id="donutCenter">${center(fmt(mix.total), totalLabel)}</g></svg>
    <div class="brand-legend">${mix.slices.map((s, i) => `
      <div class="brand-row" data-i="${i}">
        <span class="mix-dot" style="background:${color(s, i)}"></span>
        <span class="brand-name">${escapeHtml(s.name)}</span>
        <span class="brand-count">${fmt(s.value)}</span>
        <span class="brand-pct">${pct(s.value)}%</span>
      </div>`).join("")}
    </div>`;
  const centerEl = box.querySelector("#donutCenter");
  const focus = (i) => {
    box.classList.toggle("focus", i != null);
    box.querySelectorAll("[data-i]").forEach((el) => el.classList.toggle("on", el.dataset.i === String(i)));
    const s = mix.slices[i];
    centerEl.innerHTML = s ? center(`${pct(s.value)}%`, `${escapeHtml(s.name)} ${fmt(s.value)}`) : center(fmt(mix.total), totalLabel);
  };
  box.querySelectorAll("[data-i]").forEach((el) => {
    el.addEventListener("mouseenter", () => focus(Number(el.dataset.i)));
    el.addEventListener("mouseleave", () => focus(null));
  });
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
  const W = Math.round(el.clientWidth) || 420, H = Math.round(el.clientHeight) || 160, padX = 30, padTop = 26, padBottom = 26;
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
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="line-svg" role="img">
      <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:${color};stop-opacity:0.18"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/>
      </linearGradient></defs>
      ${gridYs.map((gy) => `<line x1="${padX}" x2="${W - padX}" y1="${gy}" y2="${gy}" style="stroke:var(--separator)" stroke-width="0.8"/>`).join("")}
      <polygon points="${area}" fill="url(#${gradId})"/>
      <polyline points="${points}" fill="none" style="stroke:${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${values.map((v, i) => `
        <circle cx="${x(i)}" cy="${y(v)}" r="2.8" style="fill:${v < 0 ? "var(--negative)" : color}"/>
        ${v !== 0 ? `<text x="${x(i)}" y="${y(v) - 10}" text-anchor="middle" class="line-value ${v < 0 ? "neg" : ""}">${shortWon(v)}</text>` : ""}
        <text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="line-label${i === months.length - 1 ? " now" : ""}">${Number(months[i].month.slice(5))}월</text>`).join("")}
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

document.getElementById("ledgerExportBtn").addEventListener("click", async () => {
  const result = document.getElementById("ledgerImportResult");
  const r = await window.api.ledgerExport();
  if (r.canceled) return;
  result.textContent = r.ok ? `거래 ${r.transactionCount.toLocaleString()}건을 ${r.fileName}에 저장했어요` : `내보내기 실패: ${r.error}`;
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
// 일반 상품은 /item/m123..., 메루카리 Shops 상품은 /shops/product/영문숫자
const mercariUrl = (id) => (/^m\d+$/.test(id) ? `https://jp.mercari.com/item/${id}` : `https://jp.mercari.com/shops/product/${id}`);
const kenzLink = (id) => `https://kenzpost.com/mercari/bid.s/${mercariUrl(id)}`;

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
        <div class="wphoto" style="background-image:url('${w.imageUrl || mercariPhoto(w.id)}')">
          ${w.soldOut ? '<span class="wtag">품절</span>' : w.manual ? '<span class="wtag">직접 추가</span>' : ""}
          <button class="wremove" data-remove="${w.id}" title="찜 목록에서 삭제">✕</button>
        </div>
        <div class="wprice">${w.lastPrice != null ? yen(w.lastPrice) : "-"}</div>
        <div class="wtime">${fmt(w.checkedAt)}</div>
      </div>`).join("");
  page.innerHTML = `
    <div class="wish-add">
      <div class="add-row">
        <input id="wishLinkInput" placeholder="켄즈포스트 메루카리 링크나 jp.mercari.com 링크를 붙여넣고 Enter">
      </div>
      <div id="wishAddMsg"></div>
      <p class="hint">가격 확인은 30분마다 · 마지막 확인 ${fmt(lastRunAt)}</p>
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
// 가격 확인(별도 프로세스, 30분마다)이 끝나면 메인 프로세스가 알려준다 - 그때 한 번만 새로 그린다.
// (링크를 입력하는 중이면 지우지 않게 건너뛴다)
function refreshWishlistIfIdle() {
  if (!document.getElementById("page-wishlist").classList.contains("active")) return;
  const input = document.getElementById("wishLinkInput");
  if (input && (input.value || document.activeElement === input)) return;
  renderWishlist();
}
window.api.onWishlistUpdated(() => {
  refreshWishlistIfIdle();
  refreshAlerts();
});

// ---- 매입 검색 ----
// 켄즈포스트 검색 대신 메루카리 검색 API를 앱에서 바로 부른다. 결과를 누르면 켄즈포스트 상품 페이지로.
// 버튼 없이: 키워드·가격 칸은 Enter, 브랜드·카테고리·정렬은 바꾸는 즉시 검색. 마지막 조건은 기억한다.
// 메루카리 남성 카테고리 한글 이름(중분류·소분류). 목록에 없는 이름은 일본어 그대로 보인다.
const CATEGORY_KO = {
  トップス: "상의", "ジャケット/アウター": "아우터", パンツ: "바지", 靴: "신발", バッグ: "가방", スーツ: "정장",
  帽子: "모자", アクセサリー: "액세서리", 小物: "잡화", 時計: "시계", 水着: "수영복", レッグウェア: "양말·레깅스",
  アンダーウェア: "속옷", その他: "기타",
  // 상의
  "Tシャツ/カットソー(半袖/袖なし)": "반팔·민소매 티셔츠", "Tシャツ/カットソー(七分/長袖)": "긴팔 티셔츠", シャツ: "셔츠",
  ポロシャツ: "폴로셔츠", タンクトップ: "나시", "ニット/セーター": "니트·스웨터", パーカー: "후드티", カーディガン: "가디건",
  スウェット: "맨투맨", ジャージ: "트레이닝 저지", ベスト: "조끼",
  // 아우터
  テーラードジャケット: "테일러드 재킷(블레이저)", ノーカラージャケット: "노카라 재킷", "Gジャン/デニムジャケット": "데님 재킷",
  レザージャケット: "가죽 재킷", ダウンジャケット: "패딩", ライダースジャケット: "라이더 재킷", ミリタリージャケット: "밀리터리 재킷",
  ナイロンジャケット: "나일론 재킷", フライトジャケット: "항공 점퍼(MA-1)", ダッフルコート: "더플코트", ピーコート: "피코트",
  ステンカラーコート: "발마칸 코트", トレンチコート: "트렌치코트", モッズコート: "야상(모즈코트)", チェスターコート: "체스터 코트",
  スタジャン: "스타디움 점퍼", スカジャン: "스카잔", ブルゾン: "블루종", マウンテンパーカー: "마운틴 파카", ダウンベスト: "패딩 조끼",
  ポンチョ: "판초", カバーオール: "커버올",
  // 바지
  "デニム/ジーンズ": "데님·청바지", "ワークパンツ/カーゴパンツ": "워크·카고 팬츠", スラックス: "슬랙스", チノパン: "치노 팬츠",
  ショートパンツ: "반바지", ペインターパンツ: "페인터 팬츠", サルエルパンツ: "사루엘 팬츠", オーバーオール: "멜빵바지",
  // 신발
  スニーカー: "스니커즈", サンダル: "샌들", ブーツ: "부츠", モカシン: "모카신", "ドレス/ビジネス": "구두", "長靴/レインシューズ": "장화·레인부츠",
  デッキシューズ: "보트 슈즈",
  // 가방
  ショルダーバッグ: "숄더백", トートバッグ: "토트백", ボストンバッグ: "보스턴백", "リュック/バックパック": "백팩", ウエストポーチ: "웨이스트백",
  ボディーバッグ: "슬링백", ドラムバッグ: "드럼백", ビジネスバッグ: "서류가방", トラベルバッグ: "여행가방", メッセンジャーバッグ: "메신저백",
  エコバッグ: "에코백",
  // 정장
  スーツジャケット: "정장 재킷", スーツベスト: "정장 조끼", セットアップ: "셋업",
  // 모자
  キャップ: "캡", ハット: "햇", "ニットキャップ/ビーニー": "비니", "ハンチング/ベレー帽": "헌팅캡·베레모", キャスケット: "캐스케트",
  サンバイザー: "썬캡",
  // 액세서리
  ネックレス: "목걸이", ブレスレット: "팔찌", "バングル/リストバンド": "뱅글·손목밴드", リング: "반지", "ピアス(片耳用)": "귀걸이(한쪽)",
  "ピアス(両耳用)": "귀걸이(양쪽)", アンクレット: "발찌",
  // 잡화
  長財布: "장지갑", 折り財布: "반지갑", マネークリップ: "머니클립", "コインケース/小銭入れ": "동전지갑", "名刺入れ/定期入れ": "명함·카드지갑",
  キーケース: "키케이스", キーホルダー: "키홀더", ネクタイ: "넥타이", 手袋: "장갑", ハンカチ: "손수건", ベルト: "벨트", マフラー: "목도리",
  ストール: "스톨", バンダナ: "반다나", ネックウォーマー: "넥워머", サスペンダー: "멜빵", ウォレットチェーン: "지갑 체인",
  "サングラス/メガネ": "선글라스·안경", "モバイルケース/カバー": "폰케이스", 手帳: "다이어리", ストラップ: "스트랩", ネクタイピン: "넥타이핀",
  カフリンクス: "커프스", イヤマフラー: "귀마개", 傘: "우산", レインコート: "우비", ミラー: "거울", タバコグッズ: "담배용품",
  // 시계
  "腕時計(アナログ)": "아날로그 손목시계", "腕時計(デジタル)": "디지털 손목시계", ラバーベルト: "러버 시곗줄", レザーベルト: "가죽 시곗줄",
  金属ベルト: "메탈 시곗줄",
  // 수영복·양말·속옷
  一般水着: "수영복", スポーツ用: "스포츠용", ソックス: "양말", "レギンス/スパッツ": "레깅스", レッグウォーマー: "레그워머",
  トランクス: "트렁크", ボクサーパンツ: "드로즈",
};
const search = { brands: [], category: "", min: "", max: "", sort: "new", keyword: "", exclude: "", nextPageToken: "", loading: false, fx: null, seq: 0, shown: new Set(), wished: new Set() };
try { Object.assign(search, JSON.parse(localStorage.getItem("searchConditions") || "{}")); } catch {}
const saveSearch = () => {
  const { brands, category, min, max, sort, keyword, exclude } = search;
  try { localStorage.setItem("searchConditions", JSON.stringify({ brands, category, min, max, sort, keyword, exclude })); } catch {}
};
const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  return m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`;
};

let searchReady = false;
async function setupSearchPage() {
  if (searchReady) return;
  searchReady = true;
  const tree = await window.api.menCategories();
  const sel = document.getElementById("sCategory");
  sel.innerHTML = `<option value="">카테고리 전체</option>` + (tree
    ? `<option value="${tree.id}">남성 전체</option>` + tree.groups.map((g) => `
        <optgroup label="${escapeHtml(CATEGORY_KO[g.name] || g.name)}">
          <option value="${g.id}">${escapeHtml(CATEGORY_KO[g.name] || g.name)} 전체</option>
          ${g.leaves.map((l) => `<option value="${l.id}">${escapeHtml(CATEGORY_KO[l.name] || l.name)}</option>`).join("")}
        </optgroup>`).join("")
    : "");
  sel.value = search.category;
  sel.addEventListener("change", () => { search.category = sel.value; runSearch(); });

  document.getElementById("sMin").value = fmtNum(search.min);
  document.getElementById("sMax").value = fmtNum(search.max);
  document.getElementById("sKeyword").value = search.keyword;
  document.getElementById("sExclude").value = search.exclude;
  for (const id of ["sMin", "sMax", "sKeyword", "sExclude"]) {
    document.getElementById(id).addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      search.min = parseNum(document.getElementById("sMin").value) || "";
      search.max = parseNum(document.getElementById("sMax").value) || "";
      search.keyword = document.getElementById("sKeyword").value.trim();
      search.exclude = document.getElementById("sExclude").value.trim();
      document.getElementById("sMin").value = fmtNum(search.min);
      document.getElementById("sMax").value = fmtNum(search.max);
      runSearch();
    });
  }
  document.querySelectorAll("#sSort button").forEach((b) => {
    b.classList.toggle("active", b.dataset.sort === search.sort);
    b.addEventListener("click", () => {
      search.sort = b.dataset.sort;
      document.querySelectorAll("#sSort button").forEach((x) => x.classList.toggle("active", x === b));
      runSearch();
    });
  });

  // 브랜드: 입력하면 메루카리 브랜드 목록에서 후보, 비어 있으면 알림 필터의 브랜드를 바로 고를 수 있게
  const input = document.getElementById("sBrandInput");
  const pop = document.getElementById("sBrandPop");
  let candidates = [];
  let alertBrands = null;
  let popSeq = 0;
  const showCandidates = async () => {
    const q = input.value.trim();
    const seq = ++popSeq;
    let list;
    if (q) list = await window.api.searchBrands(q);
    else {
      if (!alertBrands) {
        const f = await window.api.getFilters();
        alertBrands = await window.api.resolveBrands(f.ok ? f.filters.brands.map((b) => b.name) : []);
      }
      list = alertBrands;
    }
    if (seq !== popSeq) return; // 그 사이 더 입력했으면 이전 결과는 버린다
    candidates = list.filter((c) => !search.brands.some((b) => b.id === c.id));
    pop.innerHTML = candidates.length
      ? (q ? "" : `<div class="spop-title">알림 브랜드</div>`) + candidates.map((c, i) => `<div class="spop-item" data-i="${i}">${escapeHtml(c.name)}</div>`).join("")
      : `<div class="spop-empty">${q ? "맞는 브랜드가 없어요" : "브랜드 이름을 입력하세요"}</div>`;
    pop.hidden = false;
  };
  const pick = (c) => {
    if (!c) return;
    search.brands.push(c);
    input.value = "";
    pop.hidden = true;
    renderBrandChips();
    runSearch();
  };
  input.addEventListener("input", showCandidates);
  input.addEventListener("focus", showCandidates);
  input.addEventListener("blur", () => setTimeout(() => (pop.hidden = true), 150));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) pick(candidates[0]);
    if (e.key === "Backspace" && !input.value && search.brands.length) {
      search.brands.pop();
      renderBrandChips();
      runSearch();
    }
  });
  pop.addEventListener("mousedown", (e) => {
    const it = e.target.closest("[data-i]");
    if (it) { e.preventDefault(); pick(candidates[Number(it.dataset.i)]); }
  });
  renderBrandChips();

  // 결과 끝까지 내리면 다음 페이지
  const grid = document.getElementById("sResults");
  grid.addEventListener("scroll", () => {
    if (grid.scrollTop + grid.clientHeight > grid.scrollHeight - 400) loadMore();
  });
  grid.addEventListener("click", async (e) => {
    // ♡: 누르면 찜에 넣고, 다시 누르면 뺀다
    const wish = e.target.closest("[data-wish]");
    if (wish) {
      e.stopPropagation();
      const tile = wish.closest(".stile");
      const id = wish.dataset.wish;
      if (search.wished.has(id)) {
        await window.api.removeWishlistLink(id);
        search.wished.delete(id);
        tile.classList.remove("wished");
      } else {
        const r = await window.api.addWishlistLink(mercariUrl(id), tile.dataset.thumb || null);
        if (r.ok) {
          search.wished.add(id);
          tile.classList.add("wished");
        }
      }
      return;
    }
    const tile = e.target.closest("[data-open]");
    if (tile) window.api.openExternal(kenzLink(tile.dataset.open));
  });
}

function renderBrandChips() {
  const box = document.getElementById("sBrandChips");
  box.innerHTML = search.brands.map((b, i) => `<span class="chip">${escapeHtml(b.name)}<button data-del-sbrand="${i}" title="빼기">✕</button></span>`).join("");
  box.querySelectorAll("[data-del-sbrand]").forEach((x) => x.addEventListener("click", () => {
    search.brands.splice(Number(x.dataset.delSbrand), 1);
    renderBrandChips();
    runSearch();
  }));
}

function searchConditions(pageToken = "") {
  return {
    brandIds: search.brands.map((b) => b.id),
    categoryIds: search.category ? [Number(search.category)] : [],
    priceMin: Number(search.min) || 0,
    priceMax: Number(search.max) || 0,
    keyword: search.keyword,
    exclude: search.exclude,
    sort: search.sort,
    pageToken,
  };
}

const searchTile = (it) => `
  <div class="stile wtile${search.wished.has(it.id) ? " wished" : ""}" data-open="${it.id}" ${it.shop ? 'data-shop="1"' : ""} data-thumb="${escapeHtml(it.thumbnail || "")}" title="${escapeHtml(it.name)}">
    <div class="wphoto" style="background-image:url('${it.thumbnail || ""}')">
      ${it.updatedAt ? `<span class="wtag">${ago(it.updatedAt)}</span>` : ""}
      ${it.shop ? `<span class="wtag sshop">Shops</span>` : ""}
      <button class="swish" data-wish="${it.id}" title="찜 목록에 추가"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.5S2 10 2 5.8A3 3 0 0 1 8 4.5a3 3 0 0 1 6 1.3C14 10 8 13.5 8 13.5Z"/></svg></button>
    </div>
    <div class="wprice">${yen(it.price)}</div>
    <div class="wtime">${search.fx ? `≈ ${Math.round((it.price * search.fx) / 100).toLocaleString()}원` : ""}</div>
  </div>`;

// 브랜드를 연달아 넣거나 정렬을 몇 번 바꿀 때 매번 요청하지 않도록, 마지막 변경 0.4초 뒤에 한 번만 검색
let searchTimer = null;
function runSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearchNow, 400);
}

async function runSearchNow() {
  saveSearch();
  const meta = document.getElementById("sMeta");
  const grid = document.getElementById("sResults");
  const seq = ++search.seq;
  if (!search.brands.length && !search.keyword && !search.category) {
    meta.textContent = "브랜드나 키워드를 넣으면 메루카리 판매중 상품을 찾아요. 누르면 켄즈포스트로 열려요.";
    grid.innerHTML = "";
    return;
  }
  meta.textContent = "검색 중...";
  search.fx ??= (await window.api.getSettings()).fxRate;
  // 이미 찜한 상품은 ♡가 채워진 채로 보이게
  const [r, wl] = await Promise.all([window.api.mercariSearch(searchConditions()), window.api.getWishlist()]);
  search.wished = new Set(wl.items.map((w) => w.id));
  if (seq !== search.seq) return; // 그 사이 조건이 바뀌었으면 버린다
  if (!r.ok) {
    meta.textContent = r.error;
    return;
  }
  search.nextPageToken = r.nextPageToken;
  search.shown = new Set(r.items.map((i) => i.id));
  grid.scrollTop = 0;
  grid.innerHTML = r.items.map(searchTile).join("") || `<div class="empty">조건에 맞는 상품이 없어요</div>`;
  updateSearchMeta();
}

// 메루카리가 주는 전체 개수는 추정치라(실제로 넘겨 보면 더 나온다) 불러온 개수와 더 있는지만 보여준다
function updateSearchMeta() {
  const n = search.shown.size;
  document.getElementById("sMeta").textContent = n ? `판매중 ${n.toLocaleString()}개 불러옴${search.nextPageToken ? " · 아래로 내리면 더 불러와요" : " · 끝"}` : "";
}

async function loadMore() {
  if (search.loading || !search.nextPageToken) return;
  search.loading = true;
  const seq = search.seq;
  const r = await window.api.mercariSearch(searchConditions(search.nextPageToken));
  search.loading = false;
  if (seq !== search.seq || !r.ok) return;
  search.nextPageToken = r.nextPageToken;
  // 넘기는 사이 새 상품이 올라오면 앞 페이지 상품이 다음 페이지에 또 나온다 - 이미 보인 건 뺀다
  const fresh = r.items.filter((i) => !search.shown.has(i.id));
  fresh.forEach((i) => search.shown.add(i.id));
  document.getElementById("sResults").insertAdjacentHTML("beforeend", fresh.map(searchTile).join(""));
  updateSearchMeta();
}

pageRenderers["page-search"] = async () => {
  await setupSearchPage();
  if (!document.getElementById("sResults").children.length) runSearch();
};

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

// 왼쪽: 브랜드 목록(가격 상한, 제외 키워드 개수). 줄을 누르면 오른쪽에 그 브랜드의 제외 키워드.
// 오른쪽 위는 모든 브랜드에 적용되는 공통 제외 키워드. 저장은 툴바 버튼.
let selectedFilterBrand = null;

function renderFilterPage(message = "") {
  const page = document.getElementById("page-filters");
  const f = filterDraft;
  if (!f.brands.some((b) => b.name === selectedFilterBrand)) selectedFilterBrand = f.brands[0]?.name ?? null;
  const kwCount = (name) => (f.brandExcludeKeywords[name] || []).length;
  const brandRows = f.brands
    .map((b, i) => `
      <tr data-select-brand="${escapeHtml(b.name)}" class="${b.name === selectedFilterBrand ? "selected" : ""}">
        <td class="col-action"><button class="row-remove" data-del-brand="${i}" title="삭제">−</button></td>
        <td class="col-title">${escapeHtml(b.name)}</td>
        <td class="col-kw">${kwCount(b.name) ? `제외 ${kwCount(b.name)}` : ""}</td>
        <td class="col-num"><input class="price-input" type="text" inputmode="numeric" value="${fmtNum(b.priceMax)}" data-price="${i}"><span class="unit">엔 이하</span></td>
      </tr>`).join("");
  const sel = selectedFilterBrand;
  const selWords = sel ? f.brandExcludeKeywords[sel] || [] : [];
  page.innerHTML = `
    <div class="filters-layout">
      <section class="fcol fbrands">
        <div class="fhead"><h2 class="page-title">브랜드 <span class="muted">${f.brands.length}개</span></h2></div>
        <div class="inline-row fadd">
          <input id="brandInput" placeholder="브랜드 이름 (메루카리 표기로 확인해요)">
          <input id="brandPriceInput" class="price-input" type="text" inputmode="numeric" value="30,000"><span class="unit">엔 이하</span>
          <button id="brandAddBtn" class="btn-ghost">추가</button>
        </div>
        <div id="filterMsg">${message}</div>
        <div id="brandCandidates" class="candidate-list"></div>
        <div class="fscroll"><table class="item-table"><tbody>${brandRows}</tbody></table></div>
      </section>
      <div class="fcol fside">
        <section class="fsec">
          <h2 class="page-title">공통 제외 키워드 <span class="muted">모든 브랜드</span></h2>
          <div class="chips">${chipList(f.excludeKeywords, (i) => `data-del-kw="${i}"`)}</div>
          <div class="inline-row"><input id="kwInput" placeholder="제목에 이 단어가 있으면 알림 제외"><button id="kwAddBtn" class="btn-ghost btn-sm">추가</button></div>
        </section>
        <section class="fsec fgrow">
          ${sel ? `
          <h2 class="page-title">${escapeHtml(sel)} 제외 키워드</h2>
          <div class="fscroll chips">${selWords.length ? chipList(selWords, (i) => `data-del-bkw="${escapeHtml(sel)}" data-idx="${i}"`) : `<p class="hint">이 브랜드만 따로 빼고 싶은 단어가 있으면 추가하세요</p>`}</div>
          <div class="inline-row"><input placeholder="${escapeHtml(sel)} 제외 키워드 추가" data-bkw-input="${escapeHtml(sel)}"><button class="btn-ghost btn-sm" data-add-bkw="${escapeHtml(sel)}">추가</button></div>` : `<p class="hint">브랜드를 추가하세요</p>`}
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
      const words = (filterDraft.brandExcludeKeywords[brand] ||= []);
      if (v && !words.includes(v)) words.push(v);
      renderFilterPage();
    })
  );
  // 브랜드 줄을 누르면 오른쪽에 그 브랜드의 제외 키워드 (가격칸·삭제 버튼을 누를 때는 그대로)
  page.querySelectorAll("[data-select-brand]").forEach((tr) =>
    tr.addEventListener("click", (e) => {
      if (e.target.closest("input, button")) return;
      selectedFilterBrand = tr.dataset.selectBrand;
      renderFilterPage();
    })
  );
  // 입력칸에서 Enter = 옆의 추가 버튼
  page.querySelectorAll(".inline-row input").forEach((inp) =>
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") inp.parentElement.querySelector("button")?.click();
    })
  );
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
