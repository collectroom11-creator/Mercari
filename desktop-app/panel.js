const list = document.getElementById("list");
const PLATFORM_LOGOS = {
  "메루카리": "https://mercari-pi.vercel.app/logos/mercari.png",
  "야후옥션": "https://mercari-pi.vercel.app/logos/yahoo.png",
};

function render(alerts) {
  // body는 height를 따로 지정하지 않아서 실제 스크롤은 #list가 아니라
  // 문서(window) 기준으로 일어난다 - list.scrollTop을 쓰면 항상 0이라
  // 매번 다시 그릴 때마다 스크롤이 맨 위로 튕기는 버그가 있었다.
  const scrollY = window.scrollY;
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
    item.addEventListener("click", () => window.api.notifyLinkOpened());

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
  window.scrollTo(0, scrollY);
}

window.api.onAlerts(render);
