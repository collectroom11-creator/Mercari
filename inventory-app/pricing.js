function computeCostKrw(jpyPrice, fxRate, dutyRate) {
  const landed = (jpyPrice * fxRate) / 100;
  return Math.round(landed * (1 + dutyRate));
}

function computeMinPrice(costKrw, marginRate) {
  return Math.round(costKrw / (1 - marginRate));
}

module.exports = { computeCostKrw, computeMinPrice };
