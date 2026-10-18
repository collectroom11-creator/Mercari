// 샵 운영 툴 화면: 상단 재고관리/가계부 전환, 왼쪽 메뉴, 대시보드, 가계부 탭.
// 기존 재고 입력 화면은 renderer.js가 그대로 담당한다.

const won = (n) => `${Math.round(n).toLocaleString()}원`;
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---- 상단 탭 / 왼쪽 메뉴 ----
document.querySelectorAll(".view-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".view-tab").forEach((t) => t.classList.toggle("active", t === tab));
    const ledger = tab.dataset.view === "ledger";
    document.getElementById("view-inventory").hidden = ledger;
    document.getElementById("view-ledger").hidden = !ledger;
  });
});

const pageRenderers = {};

function showPage(pageId) {
  document.querySelectorAll(".side-link").forEach((l) => l.classList.toggle("active", l.dataset.page === pageId));
  document.querySelectorAll("#view-inventory .page").forEach((p) => p.classList.toggle("active", p.id === pageId));
  if (pageRenderers[pageId]) pageRenderers[pageId]();
}

document.querySelectorAll(".side-link").forEach((link) => {
  link.addEventListener("click", () => showPage(link.dataset.page));
});

// ---- 대시보드 ----
async function renderDashboard() {
  const [s, months] = await Promise.all([window.api.getShopStats(), window.api.getMonthlySales()]);
  const cards = [
    ["이번 달 매출", won(s.monthRevenue), ""],
    ["이번 달 순이익", won(s.monthProfit), s.monthProfit >= 0 ? "positive" : "negative"],
    ["회전율 (업로드 기준)", `${s.turnoverPct}%`, ""],
    ["판매중 재고원가", won(s.listedCost), ""],
  ];
  document.getElementById("statCards").innerHTML = cards
    .map(([label, value, cls]) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value ${cls}">${value}</div></div>`)
    .join("");

  const chart = document.getElementById("salesChart");
  if (months.length === 0) {
    chart.innerHTML = `<div class="empty">아직 판매 기록이 없어요</div>`;
    return;
  }
  const max = Math.max(1, ...months.map((m) => Math.max(m.revenue, Math.abs(m.profit))));
  const pct = (v) => `${Math.max(1, Math.round((Math.abs(v) / max) * 100))}%`;
  chart.innerHTML = months
    .map((m) => `
      <div class="chart-month" title="${m.month} 매출 ${won(m.revenue)} / 순이익 ${won(m.profit)}">
        <div class="chart-bars">
          <div class="chart-bar revenue" style="height:${pct(m.revenue)}"></div>
          <div class="chart-bar profit ${m.profit < 0 ? "negative" : ""}" style="height:${pct(m.profit)}"></div>
        </div>
        <div class="chart-label">${Number(m.month.slice(5))}월</div>
      </div>`)
    .join("");
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

renderDashboard();
