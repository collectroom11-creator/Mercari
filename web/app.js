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
  body.innerHTML = `
    <a class="platform" href="${escapeAttr(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.platform)}</a>
    <a class="brand" href="${escapeAttr(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.brand)}</a>
    <div class="price">${escapeHtml(a.priceText)}</div>
  `;
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
