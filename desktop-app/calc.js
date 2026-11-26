const calcIds = ["calcCost", "calcFee", "calcDomestic", "calcIntl", "calcRate", "calcMargin", "calcDuty", "calcVat"];
const calcEls = Object.fromEntries(calcIds.map((id) => [id, document.getElementById(id)]));
const calcSellEl = document.getElementById("calcSell");

function updateCalcResult() {
  const cost = parseFloat(calcEls.calcCost.value) || 0;
  const fee = parseFloat(calcEls.calcFee.value) || 0;
  const domestic = parseFloat(calcEls.calcDomestic.value) || 0;
  const intl = parseFloat(calcEls.calcIntl.value) || 0;
  const rate100 = parseFloat(calcEls.calcRate.value) || 0;
  const marginPct = parseFloat(calcEls.calcMargin.value) || 0;
  const dutyPct = parseFloat(calcEls.calcDuty.value) || 0;
  const vatPct = parseFloat(calcEls.calcVat.value) || 0;

  const yenTotal = cost + fee + domestic + intl;
  const krw = yenTotal * (rate100 / 100);
  const afterDuty = krw * (1 + dutyPct / 100);
  const afterVat = afterDuty * (1 + vatPct / 100);
  const marginFrac = Math.min(Math.max(marginPct, 0), 99) / 100;
  const sell = afterVat / (1 - marginFrac);

  calcSellEl.textContent = Math.round(sell).toLocaleString("ko-KR") + "원";
}

calcIds.forEach((id) => calcEls[id].addEventListener("input", updateCalcResult));

// 매입가 위 -10% 버튼: 지금 입력된 매입가에서 10%를 뺀 값(엔, 반올림)으로 바꾼다
document.getElementById("calcCostDiscount").addEventListener("click", () => {
  const cost = parseFloat(calcEls.calcCost.value) || 0;
  calcEls.calcCost.value = Math.round(cost * 0.9);
  updateCalcResult();
});
updateCalcResult();
