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

// 링크 없이 바로 수동 입력 폼을 열고 싶을 때(로그인 여부와 무관하게 항상 가능).
document.getElementById("manualAddBtn").addEventListener("click", () => {
  showManualForm();
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

document.getElementById("statusFilter").addEventListener("change", renderList);

// 접힌 상태 구간 목록 - 다시 그려져도(항목 추가/수정 등) 접은 상태가 유지되도록
// 모듈 전역에 둔다.
const collapsedStatuses = new Set();

// 체크박스로 재고를 여러 개 골라서 한 번에 판매가를 % 할인할 수 있게 한다.
// 판매완료된 항목은 다시 가격 매길 필요가 없으니 선택 대상에서 뺀다.
const selectedIds = new Set();
const selectAllCheckbox = document.getElementById("selectAllCheckbox");
const selectedCountEl = document.getElementById("selectedCount");
const discount5Btn = document.getElementById("discount5Btn");
const discount10Btn = document.getElementById("discount10Btn");
const discount20Btn = document.getElementById("discount20Btn");

function updateSelectionUi() {
  selectedCountEl.textContent = `${selectedIds.size}개 선택됨`;
  discount5Btn.disabled = selectedIds.size === 0;
  discount10Btn.disabled = selectedIds.size === 0;
  discount20Btn.disabled = selectedIds.size === 0;
}

selectAllCheckbox.addEventListener("change", () => {
  document.querySelectorAll(".row-select").forEach((cb) => {
    cb.checked = selectAllCheckbox.checked;
    if (selectAllCheckbox.checked) selectedIds.add(cb.dataset.id);
    else selectedIds.delete(cb.dataset.id);
  });
  updateSelectionUi();
});

async function applyBulkDiscount(pct) {
  if (selectedIds.size === 0) return;
  const items = await window.api.listItems();
  const targets = items.filter((i) => selectedIds.has(i.id) && i.status !== "판매완료");
  for (const item of targets) {
    const base = effectiveListPrice(item);
    if (!base) continue;
    const newPrice = Math.round(base * (1 - pct));
    await window.api.updateItem(item.id, { listPrice: newPrice, listPriceEdited: true });
  }
  selectedIds.clear();
  renderList();
}

discount5Btn.addEventListener("click", () => applyBulkDiscount(0.05));
discount10Btn.addEventListener("click", () => applyBulkDiscount(0.10));
discount20Btn.addEventListener("click", () => applyBulkDiscount(0.20));

function statusBadgeClass(status) {
  if (status === "판매완료") return "badge badge-done";
  if (status === "개인구매") return "badge badge-personal";
  if (status === "판매중") return "badge badge-selling";
  if (status === "업로드전") return "badge badge-touploaded";
  return "badge badge-stock"; // 배송전(과거 '재고' 포함)
}

function daysBetween(fromStr, toStr) {
  const diffMs = new Date(toStr).getTime() - new Date(fromStr).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function daysSince(dateStr) {
  return daysBetween(dateStr, new Date());
}

// <input type="date">에 넣을 "YYYY-MM-DD" - UTC 기준으로 변환하면 시간대에 따라
// 하루 밀려 보일 수 있어서 로컬 날짜 그대로 뽑는다.
function toDateInputValue(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function effectiveListPrice(item) {
  // listPrice가 없는(과거) 항목은 추천 판매가를 대신 쓴다.
  return item.listPrice ?? item.targetPrice;
}

const STATUS_ORDER = { "배송전": 0, "재고": 0, "업로드전": 1, "판매중": 2, "개인구매": 3, "판매완료": 4 };

async function renderList() {
  // 상단 환율 표시는 목록을 다시 그릴 때마다 새로고침한다(링크를 불러오면 캐시된 환율이 바뀐다).
  loadCurrentSettings();
  refreshShopPanels();
  const status = document.getElementById("statusFilter").value;
  const items = await window.api.listItems(status ? { status } : undefined);
  // 먼저 상태별로 묶고(배송전 -> 업로드전 -> 판매중 -> 판매완료), 같은 상태 안에서는
  // 최신 등록순(방금 추가한 게 위로).
  items.sort((a, b) => {
    const statusDiff = (STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5);
    if (statusDiff !== 0) return statusDiff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const tbody = document.getElementById("itemTableBody");
  tbody.innerHTML = "";

  if (items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.className = "empty";
    td.textContent = "아직 등록된 항목이 없어요. 위에 링크를 붙여넣어 보세요.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  // 다시 그리면서 화면에서 사라지는 항목(필터로 걸러지거나 삭제된 것)의 선택은 지운다.
  const visibleIds = new Set(items.map((i) => i.id));
  for (const id of selectedIds) {
    if (!visibleIds.has(id)) selectedIds.delete(id);
  }

  function buildItemRow(item) {
    const tr = document.createElement("tr");

    const checkTd = document.createElement("td");
    checkTd.className = "col-check";
    if (item.status !== "판매완료") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "row-select";
      checkbox.dataset.id = item.id;
      checkbox.checked = selectedIds.has(item.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedIds.add(item.id);
        else selectedIds.delete(item.id);
        selectAllCheckbox.checked =
          document.querySelectorAll(".row-select").length > 0 &&
          document.querySelectorAll(".row-select:checked").length === document.querySelectorAll(".row-select").length;
        updateSelectionUi();
      });
      checkTd.appendChild(checkbox);
    }
    tr.appendChild(checkTd);

    const thumbTd = document.createElement("td");
    if (item.imageUrl) {
      const thumb = document.createElement("img");
      thumb.className = "item-thumb";
      thumb.src = item.imageUrl;
      thumb.alt = item.title;
      thumb.title = item.title; // 상품명 칼럼이 없어진 대신 마우스 올리면 이름을 볼 수 있게
      if (item.sourceUrl) {
        thumb.classList.add("item-thumb-clickable");
        thumb.addEventListener("click", () => window.api.openExternal(item.sourceUrl));
      }
      thumbTd.appendChild(thumb);
    }
    tr.appendChild(thumbTd);

    const titleTd = document.createElement("td");
    titleTd.className = "col-title";
    titleTd.textContent = item.title;
    titleTd.title = item.title;
    tr.appendChild(titleTd);

    const costTd = document.createElement("td");
    costTd.className = "col-num";
    costTd.textContent = `${item.costKrw.toLocaleString()}₩`;
    tr.appendChild(costTd);

    const localShipTd = document.createElement("td");
    localShipTd.className = "col-num";
    if (item.status !== "판매완료") {
      const localShipInput = document.createElement("input");
      localShipInput.type = "number";
      localShipInput.className = "input-sm input-num";
      localShipInput.value = item.localShippingJpy ?? 0;
      localShipInput.addEventListener("change", async () => {
        const value = Number(localShipInput.value) || 0;
        await window.api.updateLocalShipping(item.id, value);
        renderList();
      });
      localShipTd.appendChild(localShipInput);
    } else {
      localShipTd.textContent = (item.localShippingJpy ?? 0).toLocaleString();
    }
    tr.appendChild(localShipTd);

    const marginTd = document.createElement("td");
    marginTd.className = "col-num";
    function renderMarginFor(price) {
      const margin = price && item.costKrw
        ? Math.round(((price - item.costKrw) / price) * 100)
        : null;
      marginTd.textContent = margin == null ? "-" : `${margin}%`;
    }

    const listPriceTd = document.createElement("td");
    listPriceTd.className = "col-num";
    // 지금 판매가가 "판매중으로 바뀐 시점의 판매가"보다 얼마나 낮은지를 할인율로
    // 보여준다 - 아직 판매중이 된 적 없으면(listedPrice 없음) 기준이 없으니 안 보여준다.
    function renderDiscountFor(price, discountEl) {
      const baseline = item.listedPrice;
      if (baseline && price && price < baseline) {
        const pct = Math.round((1 - price / baseline) * 100);
        discountEl.textContent = `-${pct}%`;
        discountEl.hidden = false;
      } else {
        discountEl.hidden = true;
      }
    }
    if (item.status !== "판매완료") {
      const listPriceInput = document.createElement("input");
      listPriceInput.type = "number";
      listPriceInput.className = "input-sm input-num";
      listPriceInput.value = item.listPrice ?? "";
      // 값을 지워도 추천가가 플레이스홀더로 뒤에 남아있게 한다.
      listPriceInput.placeholder = item.targetPrice ?? "";
      const discountEl = document.createElement("div");
      discountEl.className = "discount-badge";
      // 지운 채로 두면(입력값 없음) 플레이스홀더로 보이는 추천가 기준으로 마진율을 보여준다.
      listPriceInput.addEventListener("input", () => {
        const typed = Number(listPriceInput.value);
        renderMarginFor(typed || item.targetPrice);
        renderDiscountFor(typed || null, discountEl);
      });
      listPriceInput.addEventListener("change", async () => {
        const value = Number(listPriceInput.value);
        if (!value) return;
        await window.api.updateItem(item.id, { listPrice: value, listPriceEdited: true });
        renderList();
      });
      listPriceTd.appendChild(listPriceInput);
      renderDiscountFor(item.listPrice, discountEl);
      listPriceTd.appendChild(discountEl);
    } else {
      listPriceTd.textContent = effectiveListPrice(item)
        ? effectiveListPrice(item).toLocaleString()
        : "-";
    }
    tr.appendChild(listPriceTd);

    renderMarginFor(effectiveListPrice(item));
    tr.appendChild(marginTd);

    const statusTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = statusBadgeClass(item.status);
    badge.textContent = item.status;
    statusTd.appendChild(badge);
    // 업로드(판매중 전환) 전에는 업로드일 칸이 비어있으니, 그 상태로 며칠째인지는
    // 여기(상태) 밑에 대신 보여준다.
    if (!item.listedAt) {
      const days = daysSince(item.statusChangedAt ?? item.createdAt);
      const daysEl = document.createElement("div");
      daysEl.className = "status-days";
      daysEl.textContent = `${days}일째`;
      statusTd.appendChild(daysEl);
    }
    tr.appendChild(statusTd);

    // 업로드일: 아직 업로드(판매중 전환) 전이면 기입할 값이 없으니 아예 비워둔다 -
    // "업로드완료" 버튼을 누르는 순간 자동으로 채워지고, 그 뒤로는 여기서 직접
    // 고칠 수 있다.
    const listedAtTd = document.createElement("td");
    listedAtTd.className = "col-num";
    if (item.listedAt) {
      const listedAtInput = document.createElement("input");
      listedAtInput.type = "date";
      listedAtInput.className = "input-sm input-date";
      listedAtInput.value = toDateInputValue(item.listedAt);
      listedAtInput.addEventListener("change", async () => {
        const [y, m, d] = listedAtInput.value.split("-").map(Number);
        if (!y || !m || !d) return;
        // 정오로 저장해서 시간대 경계 때문에 하루 밀리거나 당겨지는 걸 피한다.
        await window.api.updateItem(item.id, { listedAt: new Date(y, m - 1, d, 12, 0, 0).toISOString() });
        renderList();
      });
      listedAtTd.appendChild(listedAtInput);

      const daysEl = document.createElement("div");
      daysEl.className = "status-days";
      if (item.status === "판매완료") {
        if (item.soldAt) {
          const days = daysBetween(item.listedAt, item.soldAt);
          daysEl.textContent = `업로드 후 ${days}일만에 판매`;
          listedAtTd.appendChild(daysEl);
        }
      } else {
        const days = daysSince(item.listedAt);
        // 판매중으로 오래 머물수록(14/30/60일) 눈에 띄게 경고색을 올린다.
        if (days >= 60) daysEl.classList.add("tier-critical");
        else if (days >= 30) daysEl.classList.add("tier-danger");
        else if (days >= 14) daysEl.classList.add("tier-warn");
        daysEl.textContent = `${days}일째`;
        listedAtTd.appendChild(daysEl);
      }
    } else {
      listedAtTd.textContent = "-";
    }
    tr.appendChild(listedAtTd);

    // 상태는 자유롭게 고르는 게 아니라, 배송전 -> 업로드전 -> 판매중 -> 판매완료
    // 순서대로 버튼 하나씩 눌러서 한 단계씩만 앞으로 진행한다.
    const actionsTd = document.createElement("td");
    actionsTd.className = "col-actions";
    const advanceBtn = document.createElement("button");
    advanceBtn.className = "btn-primary btn-sm";
    if (item.status === "배송전") {
      advanceBtn.textContent = "입고완료";
      advanceBtn.addEventListener("click", async () => {
        await window.api.updateItem(item.id, { status: "업로드전", statusChangedAt: new Date().toISOString() });
        renderList();
      });
      actionsTd.appendChild(advanceBtn);
    } else if (item.status === "업로드전") {
      advanceBtn.textContent = "업로드완료";
      advanceBtn.addEventListener("click", async () => {
        const now = new Date().toISOString();
        // listedAt은 나중에 판매완료됐을 때 "업로드 후 며칠만에 팔렸는지" 계산용.
        // listedPrice는 이 시점의 판매가를 기록해서, 이후 할인율은 추천가가 아니라
        // 이 값 대비로 계산한다.
        await window.api.updateItem(item.id, {
          status: "판매중",
          statusChangedAt: now,
          listedAt: now,
          listedPrice: effectiveListPrice(item),
        });
        renderList();
      });
      actionsTd.appendChild(advanceBtn);
    } else if (item.status === "판매중" || item.status === "재고") {
      // "재고"는 이 단계 구분이 생기기 전(과거)에 등록된 항목의 상태값 - 판매중과
      // 동일하게 취급해서 판매완료 버튼을 보여준다.
      advanceBtn.textContent = "판매완료";
      advanceBtn.addEventListener("click", async () => {
        // 지금 "판매가" 칸에 있는 값을 그대로 실제판매가로 기록한다 -
        // 이미 실시간으로 관리되는 값이라 판매 처리할 때 다시 물어볼 필요가 없다.
        const actual = effectiveListPrice(item);
        if (!actual) return;
        await window.api.updateItem(item.id, {
          status: "판매완료",
          actualPrice: actual,
          soldAt: new Date().toISOString(),
          statusChangedAt: new Date().toISOString(),
        });
        renderList();
      });
      actionsTd.appendChild(advanceBtn);
    }
    tr.appendChild(actionsTd);

    const delTd = document.createElement("td");
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-delete";
    deleteBtn.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 15 15" fill="none">' +
      '<path d="M2.5 4H12.5M5.5 4V2.5C5.5 2.22386 5.72386 2 6 2H9C9.27614 2 9.5 2.22386 9.5 2.5V4M6.5 7V10.5M8.5 7V10.5M3.5 4L4 12C4 12.5523 4.44772 13 5 13H10C10.5523 13 11 12.5523 11 12L11.5 4" ' +
      'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    deleteBtn.title = "삭제";
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`"${item.title}" 항목을 삭제할까요?`)) return;
      await window.api.deleteItem(item.id);
      renderList();
    });
    delTd.appendChild(deleteBtn);
    tr.appendChild(delTd);

    return tr;
  }

  // 상태별로 묶어서 접었다 펼 수 있는 구간으로 보여준다. items가 이미 상태순으로
  // 정렬돼 있어서, 순서대로 훑으며 상태가 바뀔 때마다 새 그룹을 시작하면 된다.
  const groups = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.status === item.status) {
      last.items.push(item);
    } else {
      groups.push({ status: item.status, items: [item] });
    }
  }

  for (const group of groups) {
    const isCollapsed = collapsedStatuses.has(group.status);

    const headerTr = document.createElement("tr");
    headerTr.className = "group-header-row";
    const headerTd = document.createElement("td");
    headerTd.colSpan = 11;
    headerTd.className = "group-header";
    headerTd.innerHTML = `
      <div class="group-header-inner">
        <svg class="group-chevron${isCollapsed ? " collapsed" : ""}" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>${group.status}</span>
        <span class="group-count">${group.items.length}</span>
      </div>
    `;
    headerTd.addEventListener("click", () => {
      if (collapsedStatuses.has(group.status)) collapsedStatuses.delete(group.status);
      else collapsedStatuses.add(group.status);
      renderList();
    });
    headerTr.appendChild(headerTd);
    tbody.appendChild(headerTr);

    if (!isCollapsed) {
      for (const item of group.items) {
        tbody.appendChild(buildItemRow(item));
      }
    }
  }

  selectAllCheckbox.checked =
    document.querySelectorAll(".row-select").length > 0 &&
    document.querySelectorAll(".row-select:checked").length === document.querySelectorAll(".row-select").length;
  updateSelectionUi();
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
