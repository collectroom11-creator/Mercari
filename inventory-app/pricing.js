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

module.exports = { computeCostKrw, computeMinPrice, parseItemHtml };
