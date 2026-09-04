function computeCostKrw(jpyPrice, fxRate, dutyRate) {
  const landed = (jpyPrice * fxRate) / 100;
  return Math.round(landed * (1 + dutyRate));
}

function computeMinPrice(costKrw, marginRate) {
  return Math.round(costKrw / (1 - marginRate));
}

function parseItemHtml(html) {
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const title = h1Match ? h1Match[1].trim() : null;

  const priceMatches = [...html.matchAll(/([\d,]{3,})\s*円/g)].map((m) =>
    parseInt(m[1].replace(/,/g, ""), 10)
  );
  const jpyPrice = priceMatches.length ? Math.max(...priceMatches) : null;

  return { title, jpyPrice };
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function inStockAt(item, t) {
  if (item.status === "개인구매") return false;
  const created = new Date(item.createdAt);
  if (created > t) return false;
  if (item.status === "판매완료") {
    const sold = item.soldAt ? new Date(item.soldAt) : null;
    return sold ? sold > t : false;
  }
  return true; // status === '재고'
}

function computeDashboard(items, opts) {
  const now = opts.now || new Date();
  const monthStart = startOfMonth(now);

  const businessItems = items.filter((i) => i.status !== "개인구매");

  const stockCostTotal = items
    .filter((i) => i.status === "재고")
    .reduce((sum, i) => sum + i.costKrw, 0);

  const startOfMonthStock = businessItems
    .filter((i) => inStockAt(i, monthStart))
    .reduce((sum, i) => sum + i.costKrw, 0);

  const monthPurchases = businessItems
    .filter((i) => new Date(i.createdAt) >= monthStart && new Date(i.createdAt) <= now)
    .reduce((sum, i) => sum + i.costKrw, 0);

  const monthCogs = startOfMonthStock + monthPurchases - stockCostTotal;

  const monthRevenue = businessItems
    .filter(
      (i) =>
        i.status === "판매완료" &&
        i.soldAt &&
        new Date(i.soldAt) >= monthStart &&
        new Date(i.soldAt) <= now
    )
    .reduce((sum, i) => sum + (i.actualPrice || 0), 0);

  const monthProfit = monthRevenue - monthCogs;

  return {
    stockCostTotal,
    capProgressPct: Math.round((stockCostTotal / opts.capKrw) * 100),
    monthCogs,
    monthRevenue,
    monthProfit,
    targetProgressPct: Math.round((monthProfit / opts.monthlyTargetKrw) * 100),
  };
}

module.exports = {
  computeCostKrw,
  computeMinPrice,
  parseItemHtml,
  computeDashboard,
};
