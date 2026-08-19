const POLL_INTERVAL_MS = 10000; // 완전한 실시간 푸시는 서버리스 구조상 불가능해서, 대신 짧은 주기로 계속 확인한다.
const READ_VISIBILITY_THRESHOLD = 0.6; // 카드가 이 비율 이상 화면에 보이면 "읽었다"고 판단

let alerts = [];
let hasLoadedOnce = false;

const grid = document.getElementById("grid");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const platformFilter = document.getElementById("platformFilter");
const brandFilter = document.getElementById("brandFilter");
const hideRead = document.getElementById("hideRead");

// 카드가 뷰포트에 일정 비율 이상 들어오면 자동으로 읽음 처리한다.
const readObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        markRead(entry.target.dataset.messageId);
        readObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: READ_VISIBILITY_THRESHOLD }
);

async function pollAlerts() {
  try {
    const resp = await fetch("/api/alerts");
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "불러오기 실패");
    statusEl.textContent = "";

    const fresh = data.alerts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const existingIds = new Set(alerts.map((a) => a.messageId));
    const newOnes = fresh.filter((a) => !existingIds.has(a.messageId));
    alerts = fresh;

    if (!hasLoadedOnce) {
      hasLoadedOnce = true;
      populateFilters();
      render();
    } else if (newOnes.length > 0) {
      populateFilters();
      // fresh는 최신순으로 정렬돼 있으므로, 오래된 것부터 하나씩 맨 앞에 꽂으면
      // 최종적으로 화면 맨 위가 제일 최신이 된다.
      for (const a of [...newOnes].reverse()) {
        prependAlert(a);
      }
    }
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

function passesFilter(a) {
  const platform = platformFilter.value;
  const brand = brandFilter.value;
  if (platform && a.platform !== platform) return false;
  if (brand && a.brand !== brand) return false;
  if (hideRead.checked && a.read) return false;
  return true;
}

// 필터가 바뀌었을 때만 쓰는 전체 재구성. 폴링으로 새 항목이 왔을 때는
// prependAlert를 써서 기존 카드는 그대로 두고 새 카드만 앞에 추가한다
// (전체를 다시 그리면 스크롤 위치가 튀고 이미지가 깜빡인다).
function render() {
  const filtered = alerts.filter(passesFilter);
  grid.innerHTML = "";
  emptyEl.hidden = filtered.length > 0;
  for (const a of filtered) {
    grid.appendChild(renderCard(a));
  }
}

function prependAlert(a) {
  if (!passesFilter(a)) return;
  emptyEl.hidden = true;
  grid.prepend(renderCard(a));
}

function renderCard(a) {
  const card = document.createElement("div");
  card.className = "card" + (a.read ? " is-read" : "");
  card.dataset.messageId = a.messageId;

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
  actions.appendChild(makeToggleButton("interested", "⭐ 관심", a.interested, a.messageId));
  actions.appendChild(makeToggleButton("read", "✅ 읽음", a.read, a.messageId));
  card.appendChild(actions);

  if (!a.read) {
    readObserver.observe(card);
  }

  return card;
}

function makeToggleButton(kind, label, isActive, messageId) {
  const btn = document.createElement("button");
  btn.dataset.kind = kind;
  btn.textContent = label;
  if (isActive) btn.classList.add("active");

  btn.addEventListener("click", async () => {
    const nextOn = !btn.classList.contains("active");
    btn.disabled = true;
    try {
      await toggleState(messageId, kind, nextOn);
      const item = alerts.find((x) => x.messageId === messageId);
      if (item) item[kind] = nextOn;
      btn.classList.toggle("active", nextOn);
      if (kind === "read") {
        btn.closest(".card").classList.toggle("is-read", nextOn);
      }
    } catch (e) {
      statusEl.textContent = `오류: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  return btn;
}

// 카드가 화면에 보이거나 링크를 열어보면 자동으로 읽음 처리한다. 이미 읽음이면 아무것도 안 한다.
async function markRead(messageId) {
  const item = alerts.find((x) => x.messageId === messageId);
  if (!item || item.read) return;
  item.read = true;
  const card = grid.querySelector(`.card[data-message-id="${CSS.escape(messageId)}"]`);
  if (card) {
    card.classList.add("is-read");
    const readBtn = card.querySelector('button[data-kind="read"]');
    if (readBtn) readBtn.classList.add("active");
  }
  try {
    await toggleState(messageId, "read", true);
  } catch (e) {
    item.read = false;
    if (card) card.classList.remove("is-read");
    statusEl.textContent = `오류: ${e.message}`;
  }
}

async function toggleState(messageId, kind, on) {
  const resp = await fetch("/api/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, kind, on }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "요청 실패");
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

platformFilter.addEventListener("change", render);
brandFilter.addEventListener("change", render);
hideRead.addEventListener("change", render);

pollAlerts();
setInterval(pollAlerts, POLL_INTERVAL_MS);
