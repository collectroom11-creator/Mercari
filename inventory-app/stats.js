// 대시보드용 매출/순이익/회전율 계산. pricing.js의 computeDashboard는 재고 회계
// (월초재고+매입-월말재고) 방식이라 월별 정리 화면에 그대로 두고, 여기서는 사용자가
// 정한 단순한 정의를 쓴다: 순이익 = 실제 판매가 - 원가, 회전율 = 최근 30일 판매 원가 /
// 최근 30일 평균 진열 재고 원가(rollingTurnover 참고). 필요한 값이 없는 상품은 0으로 치지 않고 뺀다.

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function soldRecords(items) {
  return items
    .filter((i) => i.status === "판매완료" && i.soldAt && i.actualPrice != null)
    .map((i) => ({ month: monthKey(new Date(i.soldAt)), revenue: i.actualPrice, cost: i.costKrw }));
}

// 상품별 마진율(%) 목록. 판매완료는 실제 판매가, 나머지는 판매가(listPrice, 없으면 추천가) 기준.
// 판매가 0원(폐기)은 price > 0 조건에서 빠져 평균 마진율에 들어가지 않는다.
function marginRates(items) {
  return items
    .filter((i) => i.status !== "개인구매" && i.costKrw)
    .map((i) => ({ sold: i.status === "판매완료", price: i.status === "판매완료" ? i.actualPrice : i.listPrice ?? i.targetPrice, cost: i.costKrw }))
    .filter((m) => m.price > 0)
    .map((m) => ({ sold: m.sold, pct: ((m.price - m.cost) / m.price) * 100 }));
}

const DAY = 24 * 60 * 60 * 1000;
const TURNOVER_DAYS = 30;
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// 최근 30일 회전율 = 그 기간 판매 원가 / 그 기간 하루하루 진열 재고 원가의 평균.
// 업로드를 몰아서 하든 나눠서 하든 덜 흔들리게 "그날 판매중이던 재고" 평균으로 나눈다.
// 그날 끝에 판매중이면 진열로 친다(listedAt ≤ 그날, 아직 안 팔렸거나 그날 이후 판매).
// 올린 당일 팔린 건 진열 재고에 거의 안 잡히는데, 실제로 재고로 머문 시간이 없으니 맞다.
// listedAt이 없는 옛 기록은 기간 시작 전부터 올라가 있던 걸로 본다.
// 0원 판매(폐기)는 판매 원가에는 안 넣지만, 폐기 전까지는 진열 재고였으니 평균에는 들어간다.
function rollingTurnover(items, now) {
  const today = dayStart(now);
  const days = Array.from({ length: TURNOVER_DAYS }, (_, k) => today - (TURNOVER_DAYS - 1 - k) * DAY);
  const daily = new Array(TURNOVER_DAYS).fill(0);
  let soldCost = 0;
  for (const i of items) {
    const status = i.status === "재고" ? "판매중" : i.status;
    if (status !== "판매중" && status !== "판매완료") continue;
    const cost = i.costKrw || 0;
    const listed = i.listedAt ? dayStart(new Date(i.listedAt)) : -Infinity;
    const sold = status === "판매완료" && i.soldAt ? dayStart(new Date(i.soldAt)) : Infinity;
    if (status === "판매완료" && i.actualPrice > 0 && sold >= days[0] && sold <= today) soldCost += cost;
    days.forEach((d, k) => {
      if (listed <= d && sold > d) daily[k] += cost;
    });
  }
  const avgListedCost = Math.round(daily.reduce((s, c) => s + c, 0) / TURNOVER_DAYS);
  return {
    turnoverPct: soldCost > 0 && avgListedCost > 0 ? Math.round((soldCost / avgListedCost) * 100) : 0,
    turnoverSoldCost: soldCost,
    avgListedCost,
  };
}

const avgPct = (rates) => (rates.length ? Math.round(rates.reduce((s, r) => s + r.pct, 0) / rates.length) : null);

function computeShopStats(items, { now = new Date() } = {}) {
  const thisMonth = monthKey(now);
  const monthSold = soldRecords(items).filter((r) => r.month === thisMonth);
  const monthRevenue = monthSold.reduce((s, r) => s + r.revenue, 0);
  const monthSoldCost = monthSold.reduce((s, r) => s + r.cost, 0);
  const listedCost = items.filter((i) => i.status === "판매중").reduce((s, i) => s + i.costKrw, 0);
  // 아직 안 팔린 재고 전부(배송전/업로드전/판매중) - 개인구매는 사업 재고가 아니라 뺀다.
  const stockCost = items
    .filter((i) => i.status !== "판매완료" && i.status !== "개인구매")
    .reduce((s, i) => s + i.costKrw, 0);
  // "재고"는 단계 구분이 생기기 전 상태값이라 판매중으로 친다.
  const stockByStatus = ["배송전", "업로드전", "판매중"].map((status) => {
    const list = items.filter((i) => (i.status === "재고" ? "판매중" : i.status) === status);
    return { status, count: list.length, cost: list.reduce((s, i) => s + i.costKrw, 0) };
  });
  const rates = marginRates(items);
  return {
    monthRevenue,
    monthProfit: monthRevenue - monthSoldCost,
    ...rollingTurnover(items, now),
    listedCost,
    stockCost,
    // 0원 판매(폐기)는 손실로만 잡고 판매 건수에는 넣지 않는다.
    monthSoldCount: monthSold.filter((r) => r.revenue > 0).length,
    avgMarginPct: avgPct(rates),
    soldAvgMarginPct: avgPct(rates.filter((r) => r.sold)),
    stockAvgMarginPct: avgPct(rates.filter((r) => !r.sold)),
    stockByStatus,
  };
}

// lastMonths를 주면 판매 기록과 상관없이 이번 달까지 최근 N개월(빈 달은 0)을,
// 안 주면 첫 판매월부터 이번 달까지를 돌려준다.
function computeMonthlySales(items, { now = new Date(), lastMonths = null } = {}) {
  const records = soldRecords(items);
  if (records.length === 0 && !lastMonths) return [];
  const byMonth = new Map();
  for (const r of records) {
    const m = byMonth.get(r.month) || { revenue: 0, profit: 0 };
    m.revenue += r.revenue;
    m.profit += r.revenue - r.cost;
    byMonth.set(r.month, m);
  }
  const start = lastMonths
    ? new Date(now.getFullYear(), now.getMonth() - (lastMonths - 1), 1)
    : (([y, mo]) => new Date(y, mo - 1, 1))([...byMonth.keys()].sort()[0].split("-").map(Number));
  const result = [];
  for (let d = start; monthKey(d) <= monthKey(now); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const key = monthKey(d);
    const m = byMonth.get(key) || { revenue: 0, profit: 0 };
    result.push({ month: key, revenue: m.revenue, profit: m.profit });
  }
  return result;
}

module.exports = { computeShopStats, computeMonthlySales };
