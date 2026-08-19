const list = document.getElementById("list");

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
    info.innerHTML = `
      <div class="platform"></div>
      <div class="brand"></div>
      <div class="price"></div>
    `;
    info.querySelector(".platform").textContent = a.platform || "";
    info.querySelector(".brand").textContent = a.brand || "";
    info.querySelector(".price").textContent = a.priceText || "";
    item.appendChild(info);

    list.appendChild(item);
  }
}

window.api.onAlerts(render);
