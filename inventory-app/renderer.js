// inventory-app/renderer.js
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "list") renderList();
    if (btn.dataset.tab === "dashboard") renderDashboard();
  });
});

document.getElementById("loginBtn").addEventListener("click", () => {
  window.api.openLogin();
});

document.getElementById("fetchBtn").addEventListener("click", async () => {
  const url = document.getElementById("urlInput").value.trim();
  if (!url) return;
  const resultDiv = document.getElementById("fetchResult");
  let result;
  try {
    result = await window.api.fetchItem(url);
  } catch (err) {
    resultDiv.textContent = `링크를 불러오지 못했어요 (${err.message}). 아래 값을 직접 입력해주세요.`;
    document.getElementById("saveForm").hidden = false;
    return;
  }
  if (result.jpyPrice == null) {
    resultDiv.textContent = result.needsLogin
      ? "로그인이 안 되어 있는 것 같아요. 상단의 '켄즈포스트 로그인'을 먼저 눌러주세요."
      : "가격을 자동으로 못 읽었어요. 아래 값을 직접 입력해주세요.";
  } else {
    resultDiv.textContent = "";
  }
  document.getElementById("saveForm").hidden = false;
  document.getElementById("titleField").value = result.title || "";
  document.getElementById("jpyField").value = result.jpyPrice || "";
  document.getElementById("fxField").value = result.fxRate || 950;
  document.getElementById("dutyField").value = ((result.dutyRate ?? 0.23) * 100);
  document.getElementById("costField").value = result.costKrw || "";
  document.getElementById("minPriceField").value = result.minPrice || "";
  document.getElementById("targetField").value = result.minPrice || "";
});

function recomputeFromFields() {
  const jpy = Number(document.getElementById("jpyField").value) || 0;
  const fx = Number(document.getElementById("fxField").value) || 0;
  const dutyPct = Number(document.getElementById("dutyField").value) || 0;
  const cost = Math.round(((jpy * fx) / 100) * (1 + dutyPct / 100));
  document.getElementById("costField").value = cost;
  document.getElementById("minPriceField").value = Math.round(cost / 0.6);
}

["jpyField", "fxField", "dutyField"].forEach((id) => {
  document.getElementById(id).addEventListener("input", recomputeFromFields);
});

document.getElementById("saveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await window.api.saveItem({
    title: document.getElementById("titleField").value,
    sourceUrl: document.getElementById("urlInput").value.trim(),
    jpyPrice: Number(document.getElementById("jpyField").value),
    fxRate: Number(document.getElementById("fxField").value),
    dutyRate: Number(document.getElementById("dutyField").value) / 100,
    costKrw: Number(document.getElementById("costField").value),
    targetPrice: Number(document.getElementById("targetField").value),
  });
  e.target.reset();
  e.target.hidden = true;
  document.getElementById("fetchResult").textContent = "등록 완료!";
  document.getElementById("urlInput").value = "";
});

document.getElementById("statusFilter").addEventListener("change", renderList);

async function renderList() {
  const status = document.getElementById("statusFilter").value;
  const items = await window.api.listItems(status ? { status } : undefined);
  const tbody = document.querySelector("#itemTable tbody");
  tbody.innerHTML = "";
  for (const item of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.title}</td>
      <td>${item.costKrw.toLocaleString()}</td>
      <td>${item.targetPrice.toLocaleString()}</td>
      <td>${item.status}</td>
      <td>${item.actualPrice ? item.actualPrice.toLocaleString() : "-"}</td>
      <td></td>
    `;
    const actionTd = tr.querySelector("td:last-child");
    if (item.status === "재고") {
      const priceInput = document.createElement("input");
      priceInput.type = "number";
      priceInput.value = item.targetPrice;
      priceInput.style.width = "90px";
      actionTd.appendChild(priceInput);

      const dateInput = document.createElement("input");
      dateInput.type = "date";
      dateInput.value = new Date().toISOString().slice(0, 10);
      actionTd.appendChild(dateInput);

      const sellBtn = document.createElement("button");
      sellBtn.textContent = "판매완료 처리";
      sellBtn.addEventListener("click", async () => {
        const actual = Number(priceInput.value);
        if (!actual || !dateInput.value) return;
        await window.api.updateItem(item.id, {
          status: "판매완료",
          actualPrice: actual,
          soldAt: new Date(dateInput.value).toISOString(),
        });
        renderList();
      });
      actionTd.appendChild(sellBtn);

      const personalBtn = document.createElement("button");
      personalBtn.textContent = "개인구매로 표시";
      personalBtn.addEventListener("click", async () => {
        await window.api.updateItem(item.id, { status: "개인구매" });
        renderList();
      });
      actionTd.appendChild(personalBtn);
    }
    tbody.appendChild(tr);
  }
}

async function renderDashboard() {
  const d = await window.api.getDashboard();
  document.getElementById("dashboardBody").innerHTML = `
    <p>재고 총원가: ${d.stockCostTotal.toLocaleString()}원 (상한선 대비 ${d.capProgressPct}%)</p>
    <p>이번달 매출원가: ${d.monthCogs.toLocaleString()}원</p>
    <p>이번달 매출: ${d.monthRevenue.toLocaleString()}원</p>
    <p>이번달 순이익: ${d.monthProfit.toLocaleString()}원 (목표 대비 ${d.targetProgressPct}%)</p>
  `;
}
