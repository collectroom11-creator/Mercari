const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadBrandNames, matchBrand, validateFilters } = require("../filters");

const names = loadBrandNames(path.join(__dirname, "..", "..", "facets", "brands.json"));

test("loadBrandNames: facets에서 브랜드 이름을 읽는다", () => {
  assert.ok(names.includes("DIRK BIKKEMBERGS"));
  assert.ok(names.includes("Hugo Boss"));
});

test("matchBrand: 대소문자 무시 정확 일치는 facets 표기로 돌려준다", () => {
  assert.deepEqual(matchBrand("dirk bikkembergs", names).exact, "DIRK BIKKEMBERGS");
});

test("matchBrand: 정확 일치가 없으면 부분 일치 후보(최대 8개)", () => {
  const r = matchBrand("mcqueen", names);
  assert.equal(r.exact, null);
  assert.ok(r.candidates.includes("ALEXANDER McQUEEN"));
  assert.ok(r.candidates.length <= 8);
});

test("validateFilters: 대소문자만 다른 중복, 없는 브랜드, 잘못된 가격 상한", () => {
  const errors = validateFilters({
    brands: [
      { name: "Dirk Bikkembergs", priceMax: 30000 },
      { name: "DIRK BIKKEMBERGS", priceMax: 30000 },
      { name: "없는브랜드xyz", priceMax: 30000 },
      { name: "Hugo Boss", priceMax: 0 },
    ],
    excludeKeywords: [],
    brandExcludeKeywords: {},
  }, names);
  assert.equal(errors.length, 3);
});

test("validateFilters: 지금 filters.json은 오류 없음", () => {
  const current = require("../../filters.json");
  assert.deepEqual(validateFilters(current, names), []);
});
