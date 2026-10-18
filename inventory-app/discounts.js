// 업로드 후 오래 안 팔린 상품의 단계별 할인 알림. 할인은 항상 처음 업로드 가격
// (listedPrice) 기준이라 여러 번 할인해도 복리로 겹치지 않는다. 이미 그 단계 가격
// 이하로 내려가 있으면 알림이 사라지므로, "할인했다"는 상태를 따로 저장하지 않는다.
const DISCOUNT_STAGES = [
  { days: 14, pct: 5 },
  { days: 28, pct: 10 },
  { days: 56, pct: 15 },
  { days: 112, pct: 20 },
];

const DAY_MS = 86400000;

function discountedPrice(listedPrice, pct) {
  return Math.round(listedPrice * (1 - pct / 100));
}

// dismissed: { [itemId]: pct } - X로 닫은 단계. 더 높은 단계가 되면 다시 뜬다.
function computeDiscountAlerts(items, dismissed = {}, { now = new Date() } = {}) {
  const alerts = [];
  for (const item of items) {
    if (item.status !== "판매중" || !item.listedPrice || !item.listedAt) continue;
    const days = Math.floor((now - new Date(item.listedAt)) / DAY_MS);
    const stage = [...DISCOUNT_STAGES].reverse().find((s) => days >= s.days);
    if (!stage) continue;
    if ((dismissed[item.id] || 0) >= stage.pct) continue;
    const newPrice = discountedPrice(item.listedPrice, stage.pct);
    const listPrice = item.listPrice ?? item.listedPrice;
    if (listPrice <= newPrice) continue;
    alerts.push({
      id: item.id,
      title: item.title,
      imageUrl: item.imageUrl || null,
      days,
      weeks: Math.floor(days / 7),
      listPrice,
      pct: stage.pct,
      newPrice,
    });
  }
  return alerts.sort((a, b) => b.days - a.days).map(({ days, ...rest }) => rest);
}

module.exports = { DISCOUNT_STAGES, discountedPrice, computeDiscountAlerts };
