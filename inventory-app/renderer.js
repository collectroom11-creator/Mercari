// inventory-app/renderer.js
// 관세율/부가세율/국제배송비는 고정값이라 설정 화면 없이 여기 상수로만 둔다.
const DUTY_RATE = 0.13;
const VAT_RATE = 0.10;
const INTL_SHIPPING_JPY = 500;
const FEE_JPY = 300;

let currentSettings = null;

function updateFxRateChip() {
  const chip = document.getElementById("fxRateChip");
  if (currentSettings && currentSettings.fxRate) {
    chip.textContent = `100엔 ≈ ${currentSettings.fxRate}원`;
    chip.hidden = false;
  } else {
    chip.hidden = true;
  }
}

async function loadCurrentSettings() {
  currentSettings = await window.api.getSettings();
  updateFxRateChip();
}

// 켄즈포스트 로그인은 더 이상 쓰지 않는다 - 로그인이 없으면 main.js의 fetch-item이
// 메루카리 상품 페이지에서 가격/제목/사진을 대신 읽는다.
const urlInput = document.getElementById("urlInput");
const fetchBtn = document.getElementById("fetchBtn");

async function showManualForm(prefillTitle) {
  if (!currentSettings) await loadCurrentSettings();
  document.getElementById("saveForm").hidden = false;
  document.getElementById("titleField").value = prefillTitle || "";
  document.getElementById("fxField").value = document.getElementById("fxField").value || currentSettings.fxRate;
}

// 사용자가 고른 사진 파일을 썸네일 정도 크기로 줄여서 data URL로 만든다 -
// 원본 그대로 저장하면 inventory.json이 금방 무거워진다.
function resizeImageToDataUrl(file, maxDim = 400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let manualImageDataUrl = null;
const manualImageField = document.getElementById("manualImageField");
const manualImagePreview = document.getElementById("manualImagePreview");

manualImageField.addEventListener("change", async () => {
  const file = manualImageField.files[0];
  if (!file) return;
  manualImageDataUrl = await resizeImageToDataUrl(file);
  manualImagePreview.src = manualImageDataUrl;
  manualImagePreview.hidden = false;
});

async function handleAddFromUrl() {
  const url = urlInput.value.trim();
  if (!url) return;
  const resultDiv = document.getElementById("fetchResult");
  let result;
  try {
    result = await window.api.fetchItem(url);
  } catch (err) {
    resultDiv.textContent = `링크를 불러오지 못했어요 (${err.message}). 아래 값을 직접 입력해주세요.`;
    await showManualForm();
    return;
  }
  if (result.jpyPrice == null) {
    // 메루카리가 아닌 켄즈포스트 링크(야후옥션 등)는 로그인 없이 가격을 읽을 방법이 없다.
    resultDiv.textContent = "가격을 자동으로 못 읽었어요. 아래 값을 직접 입력해주세요.";
    await showManualForm(result.title);
    return;
  }
  const fetchedFields = {
    title: result.title || "제목 없음",
    imageUrl: result.imageUrl,
    sourceUrl: url,
    jpyPrice: result.jpyPrice,
    fxRate: result.fxRate,
    dutyRate: result.dutyRate,
    vatRate: result.vatRate,
    localShippingJpy: result.localShippingJpy,
    intlShippingJpy: result.intlShippingJpy,
    feeJpy: result.feeJpy,
    costKrw: result.costKrw,
    targetPrice: result.minPrice,
  };

  // 같은 링크를 다시 붙여넣으면(예: 처음엔 제목을 못 읽어서 다시 시도하는 경우)
  // 새 항목을 또 만들지 않고, 아직 안 팔린 기존 항목을 찾아서 값만 갱신한다.
  const existingItems = await window.api.listItems();
  const existing = existingItems.find((i) => i.sourceUrl === url && i.status !== "판매완료");

  if (existing) {
    await window.api.updateItem(existing.id, {
      ...fetchedFields,
      // 사용자가 이미 직접 고쳐둔 판매가는 덮어쓰지 않는다. 아직 고친 적 없으면
      // 판매가 칸은 비워두고 추천가는 플레이스홀더로만 보여준다.
      listPrice: existing.listPriceEdited ? existing.listPrice : null,
    });
    // fetch-item은 항상 현지배송비 0 기준으로 원가를 내려주기 때문에, 이미 직접
    // 입력해둔 현지배송비가 있었다면 그게 0으로 덮어써진다 - 새로 받아온
    // 엔화가격/환율 기준으로 그 값을 다시 반영해서 원가를 제대로 재계산한다.
    const preservedLocalShipping = existing.localShippingJpy ?? 0;
    if (preservedLocalShipping) {
      await window.api.updateLocalShipping(existing.id, preservedLocalShipping);
    }
    resultDiv.textContent = "이미 있던 항목을 최신 정보(환율 포함)로 갱신했어요.";
  } else {
    // listPrice를 안 주면 비어있는 채로 등록되고, 추천가(targetPrice)는
    // 판매가 칸에 플레이스홀더로만 보인다.
    await window.api.saveItem(fetchedFields);
    resultDiv.textContent = "재고에 추가했어요!";
  }
  // 이전 시도에서 열려있던 수동입력 폼이 있었다면(자동으로 이번엔 성공했으니) 닫는다.
  document.getElementById("saveForm").hidden = true;
  urlInput.value = "";
  renderList();
}

fetchBtn.addEventListener("click", handleAddFromUrl);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAddFromUrl();
});

// 엔화 제품가 구간별로 최소 마진율을 다르게 적용한다(pricing.js의 getTieredMarginRate와
// 동일한 로직) - 렌더러는 메인 프로세스 모듈을 require할 수 없어서 그대로 복제해둔다.
function getTieredMarginRate(jpyPrice) {
  if (jpyPrice >= 10000) return 0.4;
  if (jpyPrice >= 5000) return 0.5;
  return 0.6;
}

function computeTieredSalePrice(costKrw, jpyPrice) {
  const rate = getTieredMarginRate(jpyPrice);
  return { rate, price: Math.round(costKrw / (1 - rate)) };
}

function recomputeFromFields() {
  const jpy = Number(document.getElementById("jpyField").value) || 0;
  const fx = Number(document.getElementById("fxField").value) || 0;
  const dutiableJpy = jpy + FEE_JPY + INTL_SHIPPING_JPY;
  const landed = (dutiableJpy * fx) / 100;
  const afterDuty = landed * (1 + DUTY_RATE);
  const cost = Math.round(afterDuty * (1 + VAT_RATE));
  document.getElementById("costField").value = cost;
  document.getElementById("targetField").value = computeTieredSalePrice(cost, jpy).price;
}

["jpyField", "fxField"].forEach((id) => {
  document.getElementById(id).addEventListener("input", recomputeFromFields);
});

document.getElementById("saveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await window.api.saveItem({
    title: document.getElementById("titleField").value,
    sourceUrl: document.getElementById("urlInput").value.trim(),
    jpyPrice: Number(document.getElementById("jpyField").value),
    fxRate: Number(document.getElementById("fxField").value),
    dutyRate: DUTY_RATE,
    vatRate: VAT_RATE,
    localShippingJpy: 0,
    intlShippingJpy: INTL_SHIPPING_JPY,
    feeJpy: FEE_JPY,
    costKrw: Number(document.getElementById("costField").value),
    targetPrice: Number(document.getElementById("targetField").value),
    imageUrl: manualImageDataUrl,
  });
  e.target.reset();
  e.target.hidden = true;
  manualImageDataUrl = null;
  manualImagePreview.hidden = true;
  manualImagePreview.src = "";
  document.getElementById("fetchResult").textContent = "재고에 추가했어요!";
  document.getElementById("urlInput").value = "";
  renderList();
});

function daysBetween(fromStr, toStr) {
  const diffMs = new Date(toStr).getTime() - new Date(fromStr).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function daysSince(dateStr) {
  return daysBetween(dateStr, new Date());
}

function effectiveListPrice(item) {
  // listPrice가 없는(과거) 항목은 추천 판매가를 대신 쓴다.
  return item.listPrice ?? item.targetPrice;
}

// 재고 입력 탭: 상태별 박스 4개를 가로로 놓고 박스 안에서만 스크롤한다.
// "재고"는 단계 구분이 생기기 전에 등록된 항목의 상태값이라 판매중과 같이 취급한다.
// 개인구매는 사업 재고가 아니라서 보드에 올리지 않는다.
const BOARD_COLUMNS = [
  { title: "배송전", statuses: ["배송전"] },
  { title: "업로드전", statuses: ["업로드전"] },
  { title: "판매중", statuses: ["판매중", "재고"] },
  { title: "판매완료", statuses: ["판매완료"] },
];

// › 버튼을 누르면 한 단계씩만 앞으로 진행한다.
async function advanceStatus(item) {
  const now = new Date().toISOString();
  if (item.status === "배송전") {
    await window.api.updateItem(item.id, { status: "업로드전", statusChangedAt: now });
  } else if (item.status === "업로드전") {
    // listedAt은 "업로드 후 며칠째/며칠만에 판매" 계산용, listedPrice는 이후 할인율의 기준가.
    await window.api.updateItem(item.id, {
      status: "판매중",
      statusChangedAt: now,
      listedAt: now,
      listedPrice: effectiveListPrice(item),
    });
  } else if (item.status === "판매중" || item.status === "재고") {
    // 지금 판매가 칸의 값을 그대로 실제판매가로 기록한다.
    const actual = effectiveListPrice(item);
    if (!actual) return;
    await window.api.updateItem(item.id, { status: "판매완료", actualPrice: actual, soldAt: now, statusChangedAt: now });
  }
  renderList();
}

function daysLabel(item) {
  if (item.status === "판매완료") {
    // 좁은 카드에 맞게 짧게 "N일"(업로드 후 며칠 만에 팔렸는지)
    return item.listedAt && item.soldAt ? { text: `${daysBetween(item.listedAt, item.soldAt)}일`, warn: false } : null;
  }
  const since = item.listedAt ?? item.statusChangedAt ?? item.createdAt;
  const days = daysSince(since);
  // 판매중으로 2주 넘게 머물면 눈에 띄게 표시한다.
  return { text: `${days}일째`, warn: !!item.listedAt && days >= 14 };
}

// 재고 카드: 왼쪽 작은 정사각 사진, 오른쪽에 판매가(크게, 바로 수정) / 원가 · 마진(작게).
// 라벨은 반복하지 않는다. 경과일은 오른쪽 위 작은 글씨, 버튼은 마우스를 올렸을 때만.
function buildCard(item) {
  const sold = item.status === "판매완료";
  const card = document.createElement("div");
  card.className = "kcard";
  card.title = item.title;

  const photo = document.createElement("div");
  photo.className = "kphoto";
  if (item.imageUrl) photo.style.backgroundImage = `url("${item.imageUrl}")`;
  if (item.sourceUrl) {
    photo.classList.add("clickable");
    photo.addEventListener("click", () => window.api.openExternal(item.sourceUrl));
  }
  card.appendChild(photo);

  const body = document.createElement("div");
  body.className = "kbody";
  const price = sold ? item.actualPrice : effectiveListPrice(item);
  const marginOf = (p) => (p && item.costKrw ? `${Math.round(((p - item.costKrw) / p) * 100)}%` : "-");
  const setMargin = (p) => {
    margin.textContent = marginOf(p);
    margin.classList.toggle("neg", !!p && p < item.costKrw);
  };

  // 1줄: 판매가(+ 오른쪽 위 경과일)
  const top = document.createElement("div");
  top.className = "ktop";
  const margin = document.createElement("span");
  margin.className = "kmargin";
  setMargin(price);
  if (sold) {
    const p = document.createElement("span");
    p.className = "kprice-text";
    p.textContent = price ? price.toLocaleString() : "-";
    const unit = document.createElement("span");
    unit.className = "kprice-unit";
    unit.textContent = price ? "원" : "";
    const wrap = document.createElement("span");
    wrap.className = "kprice-wrap";
    wrap.append(p, unit);
    top.appendChild(wrap);
  } else {
    const wrap = document.createElement("label");
    wrap.className = "kprice-wrap";
    const input = document.createElement("input");
    // 평소엔 글자처럼 보이고, 마우스를 올리거나 누르면 입력칸이 된다.
    input.type = "text";
    input.inputMode = "numeric";
    input.className = "kprice";
    input.value = fmtNum(item.listPrice);
    // 값을 지워도 추천가가 플레이스홀더로 남는다.
    input.placeholder = fmtNum(item.targetPrice);
    input.title = "판매가 (눌러서 수정)";
    input.addEventListener("input", () => setMargin(parseNum(input.value) || item.targetPrice));
    input.addEventListener("focus", () => input.select());
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    input.addEventListener("change", async () => {
      const value = parseNum(input.value);
      if (!value) return;
      await window.api.updateItem(item.id, { listPrice: value, listPriceEdited: true });
      renderList();
    });
    const unit = document.createElement("span");
    unit.className = "kprice-unit";
    unit.textContent = "원";
    wrap.append(input, unit);
    top.appendChild(wrap);
  }
  const label = daysLabel(item);
  if (label) {
    const days = document.createElement("span");
    days.className = `kdays${label.warn ? " warn" : ""}`;
    days.textContent = label.text;
    top.appendChild(days);
  }
  body.appendChild(top);

  // 2줄: 원가 · 마진
  const sub = document.createElement("div");
  sub.className = "ksub";
  const cost = document.createElement("span");
  cost.className = "kcost";
  cost.textContent = `원가 ${item.costKrw.toLocaleString()}`;
  sub.append(cost, document.createTextNode(" · "), margin);
  body.appendChild(sub);

  if (item.localShippingJpy) {
    const ship = document.createElement("div");
    ship.className = "kship";
    ship.textContent = `현지배송비 ¥${item.localShippingJpy.toLocaleString()} 포함`;
    body.appendChild(ship);
  }
  card.appendChild(body);

  // 마우스를 올렸을 때만 보이는 버튼: 오른쪽 아래 › (다음 단계), 사진 왼쪽 위 ✕ (삭제)
  if (!sold) {
    const adv = document.createElement("button");
    adv.className = "kadv";
    // 글자 "›"는 기준선 때문에 원 안에서 가운데가 안 맞아서 SVG 화살표를 쓴다.
    adv.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    adv.title = "다음 단계로";
    adv.addEventListener("click", (e) => {
      e.stopPropagation();
      advanceStatus(item);
    });
    card.appendChild(adv);
  }
  const del = document.createElement("button");
  del.className = "kdel";
  del.textContent = "✕";
  del.title = "삭제";
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(`"${item.title}" 항목을 삭제할까요?`)) return;
    await window.api.deleteItem(item.id);
    renderList();
  });
  card.appendChild(del);

  // 현지배송비는 드물게만 쓰여서 평소엔 숨기고, 원가를 누르면 입력칸을 연다.
  if (!sold) {
    cost.classList.add("clickable");
    cost.title = "눌러서 현지배송비 입력";
    const pop = document.createElement("div");
    pop.className = "kshippop";
    pop.hidden = true;
    pop.innerHTML = `현지배송비 ¥<input type="text" inputmode="numeric" value="${fmtNum(item.localShippingJpy ?? 0)}">`;
    const shipInput = pop.querySelector("input");
    shipInput.addEventListener("change", async () => {
      await window.api.updateLocalShipping(item.id, parseNum(shipInput.value));
      renderList();
    });
    cost.addEventListener("click", () => {
      pop.hidden = !pop.hidden;
      if (!pop.hidden) shipInput.focus();
    });
    card.appendChild(pop);
  }
  return card;
}

async function renderList() {
  // 상단 환율 표시는 목록을 다시 그릴 때마다 새로고침한다(링크를 불러오면 캐시된 환율이 바뀐다).
  loadCurrentSettings();
  refreshShopPanels();
  const items = await window.api.listItems();
  const board = document.getElementById("kanban");
  board.innerHTML = "";

  for (const col of BOARD_COLUMNS) {
    const colItems = items
      .filter((i) => col.statuses.includes(i.status))
      // 판매완료는 최근 판매순, 나머지는 최근 등록순
      .sort((a, b) =>
        col.title === "판매완료"
          ? new Date(b.soldAt || 0) - new Date(a.soldAt || 0)
          : new Date(b.createdAt) - new Date(a.createdAt)
      );
    const colEl = document.createElement("section");
    colEl.className = "kcol";
    colEl.innerHTML = `<div class="kcol-head">${col.title}<span class="kcount">${colItems.length}</span></div>`;
    const list = document.createElement("div");
    list.className = "klist";
    if (colItems.length === 0) list.innerHTML = `<div class="kempty">없음</div>`;
    for (const item of colItems) list.appendChild(buildCard(item));
    colEl.appendChild(list);
    board.appendChild(colEl);
  }
}

const monthlyViewBtn = document.getElementById("monthlyViewBtn");
const monthlyModal = document.getElementById("monthlyModal");
const closeMonthlyModal = document.getElementById("closeMonthlyModal");
const monthlyTableBody = document.getElementById("monthlyTableBody");

monthlyViewBtn.addEventListener("click", async () => {
  const months = await window.api.getMonthlyBreakdown();
  monthlyTableBody.innerHTML = months.length === 0
    ? `<tr><td colspan="4" class="empty">아직 정리할 데이터가 없어요.</td></tr>`
    : months
        .map((m) => {
          const profitClass = m.monthProfit >= 0 ? "positive" : "negative";
          return `
            <tr>
              <td>${m.month}</td>
              <td class="col-num ${profitClass}">${m.monthProfit.toLocaleString()}원</td>
              <td class="col-num">${m.monthRevenue.toLocaleString()}원</td>
              <td class="col-num">${m.monthCogs.toLocaleString()}원</td>
            </tr>
          `;
        })
        .join("");
  monthlyModal.classList.add("open");
});

closeMonthlyModal.addEventListener("click", () => {
  monthlyModal.classList.remove("open");
});

// 카드 바깥(어두운 배경) 클릭으로도 닫히게 한다.
monthlyModal.addEventListener("click", (e) => {
  if (e.target === monthlyModal) monthlyModal.classList.remove("open");
});

loadCurrentSettings();
renderList();
