const list = document.getElementById("list");
const PLATFORM_LOGOS = {
  "메루카리": "https://mercari-pi.vercel.app/logos/mercari.png",
  "야후옥션": "https://mercari-pi.vercel.app/logos/yahoo.png",
};

function render(alerts) {
  list.innerHTML = "";
  if (!alerts || alerts.length === 0) {
    list.innerHTML = '<div class="empty">새 알림이 없습니다.</div>';
    return;
  }
  for (const a of alerts) {
    const item = document.createElement("a");
    item.className = "item";
    item.href = a.url;
    item.target = "_blank";

    const img = document.createElement("img");
    img.src = a.image || "";
    item.appendChild(img);

    const info = document.createElement("div");
    info.className = "info";

    const platformEl = document.createElement("div");
    platformEl.className = "platform";
    const logoUrl = PLATFORM_LOGOS[a.platform];
    if (logoUrl) {
      const logo = document.createElement("img");
      logo.src = logoUrl;
      logo.alt = a.platform || "";
      platformEl.appendChild(logo);
    } else {
      platformEl.textContent = a.platform || "";
    }
    info.appendChild(platformEl);

    const brandEl = document.createElement("div");
    brandEl.className = "brand";
    brandEl.textContent = a.brand || "";
    info.appendChild(brandEl);

    const priceEl = document.createElement("div");
    priceEl.className = "price";
    priceEl.textContent = a.priceText || "";
    info.appendChild(priceEl);

    item.appendChild(info);

    list.appendChild(item);
  }
}

window.api.onAlerts(render);
