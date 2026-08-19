const INTERESTED_EMOJI = "⭐";
const READ_EMOJI = "✅";

let alerts = [];

const grid = document.getElementById("grid");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const platformFilter = document.getElementById("platformFilter");
const brandFilter = document.getElementById("brandFilter");
const hideRead = document.getElementById("hideRead");
const refreshBtn = document.getElementById("refreshBtn");

async function loadAlerts() {
  statusEl.textContent = "불러오는 중...";
  try {
    const resp = await fetch("/api/alerts");
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "불러오기 실패");
    alerts = data.alerts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    statusEl.textContent = "";
    populateFilters();
    render();
  } catch (e) {
    statusEl.textContent = `오류: ${e.message}`;
  }
}

function populateFilters() {
  const platforms = [...new Set(alerts.map((a) => a.platform).filter(Boolean))];
  const brands = [...new Set(alerts.map((a) => a.brand).filter(Boolean))].sort();

  const currentPlatform = platformFilter.value;
  const currentBrand = brandFilter.value;

  platformFilter.innerHTML =
    '<option value="">전체 플랫폼</option>' +
    platforms.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  brandFilter.innerHTML =
    '<option value="">전체 브랜드</option>' +
    brands.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");

  if (platforms.includes(currentPlatform)) platformFilter.value = currentPlatform;
  if (brands.includes(currentBrand)) brandFilter.value = currentBrand;
}

function render() {
  const platform = platformFilter.value;
  const brand = brandFilter.value;
  const hideReadOn = hideRead.checked;

  const filtered = alerts.filter((a) => {
    if (platform && a.platform !== platform) return false;
    if (brand && a.brand !== brand) return false;
    if (hideReadOn && a.read) return false;
    return true;
  });

  grid.innerHTML = "";
  emptyEl.hidden = filtered.length > 0;

  for (const a of filtered) {
    grid.appendChild(renderCard(a));
  }
}

function renderCard(a) {
  const card = document.createElement("div");
  card.className = "card" + (a.read ? " is-read" : "");

  const img = document.createElement("img");
  img.src = a.image || "";
  img.alt = a.brand;
  img.loading = "lazy";
  card.appendChild(img);

  const body = document.createElement("div");
  body.className = "card-body";

  const platformLink = document.createElement("a");
  platformLink.className = "platform";
  platformLink.href = a.url;
  platformLink.target = "_blank";
  platformLink.rel = "noopener";
  platformLink.textContent = a.platform;
  platformLink.addEventListener("click", () => markRead(a.messageId));

  const brandLink = document.createElement("a");
  brandLink.className = "brand";
  brandLink.href = a.url;
  brandLink.target = "_blank";
  brandLink.rel = "noopener";
  brandLink.textContent = a.brand;
  brandLink.addEventListener("click", () => markRead(a.messageId));

  const priceEl = document.createElement("div");
  priceEl.className = "price";
  priceEl.textContent = a.priceText;

  body.appendChild(platformLink);
  body.appendChild(brandLink);
  body.appendChild(priceEl);
  card.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const interestedBtn = makeToggleButton("interested", "⭐ 관심", a.interested, a.messageId, INTERESTED_EMOJI);
  const readBtn = makeToggleButton("read", "✅ 읽음", a.read, a.messageId, READ_EMOJI);
  actions.appendChild(interestedBtn);
  actions.appendChild(readBtn);
  card.appendChild(actions);

  return card;
}

function makeToggleButton(kind, label, isActive, messageId, emoji) {
  const btn = document.createElement("button");
  btn.dataset.kind = kind;
  btn.textContent = label;
  if (isActive) btn.classList.add("active");

  btn.addEventListener("click", async () => {
    const nextOn = !btn.classList.contains("active");
    btn.disabled = true;
    try {
      await toggleReaction(messageId, emoji, nextOn);
      const item = alerts.find((x) => x.messageId === messageId);
      if (item) item[kind] = nextOn;
      render();
    } catch (e) {
      statusEl.textContent = `오류: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  return btn;
}

// 상품 링크를 열어보면(실제로 읽으면) 자동으로 읽음 처리한다.
// 이미 읽음이면 다시 요청하지 않는다.
async function markRead(messageId) {
  const item = alerts.find((x) => x.messageId === messageId);
  if (!item || item.read) return;
  item.read = true;
  render();
  try {
    await toggleReaction(messageId, READ_EMOJI, true);
  } catch (e) {
    item.read = false;
    render();
    statusEl.textContent = `오류: ${e.message}`;
  }
}

async function toggleReaction(messageId, emoji, on) {
  const resp = await fetch("/api/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, emoji, on }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "요청 실패");
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

platformFilter.addEventListener("change", render);
brandFilter.addEventListener("change", render);
hideRead.addEventListener("change", render);
refreshBtn.addEventListener("click", loadAlerts);

loadAlerts();
