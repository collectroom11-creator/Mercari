// 메루카리 알림 필터(저장소 루트 filters.json) 편집용 검증. 브랜드 이름이 메루카리
// 브랜드 태그(facets/brands.json의 name)와 다르면 알림 봇 검색이 조용히 빗나가서,
// 저장 전에 정확한 표기인지 확인한다.
const fs = require("node:fs");

function loadBrandNames(facetsBrandsPath) {
  const names = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if ("id" in node && typeof node.name === "string") names.add(node.name);
      Object.values(node).forEach(walk);
    }
  };
  walk(JSON.parse(fs.readFileSync(facetsBrandsPath, "utf-8")));
  return [...names];
}

function matchBrand(input, names) {
  const q = String(input).trim().toLowerCase();
  if (!q) return { exact: null, candidates: [] };
  const exact = names.find((n) => n.toLowerCase() === q) || null;
  if (exact) return { exact, candidates: [] };
  const candidates = names.filter((n) => n.toLowerCase().includes(q)).sort((a, b) => a.length - b.length).slice(0, 8);
  return { exact: null, candidates };
}

function validateFilters(filters, names) {
  const errors = [];
  // 알림 봇(main.py resolve_brand_ids)이 대소문자를 무시하고 비교하므로 여기서도 똑같이 본다.
  const known = new Set(names.map((n) => n.toLowerCase()));
  const seen = new Set();
  for (const b of filters.brands || []) {
    const key = String(b.name).toLowerCase();
    if (seen.has(key)) errors.push(`중복된 브랜드: ${b.name}`);
    else if (!known.has(key)) errors.push(`메루카리에 없는 브랜드 표기: ${b.name}`);
    seen.add(key);
    if (!Number.isInteger(b.priceMax) || b.priceMax <= 0) errors.push(`가격 상한이 잘못됨: ${b.name}`);
  }
  return errors;
}

module.exports = { loadBrandNames, matchBrand, validateFilters };
