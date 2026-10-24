const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { createSigner, buildSearchBody, mapResults, searchMercari, loadFacets, searchBrands, menCategoryTree } = require("../mercari-search");

test("createSigner: DPoP 토큰은 ES256 서명이고 htu/htm/uuid가 들어있다", () => {
  const signer = createSigner();
  const token = signer.dpop("https://api.mercari.jp/v2/entities:search", "POST", 1_700_000_000_000);
  const [h, p, s] = token.split(".");
  const head = JSON.parse(Buffer.from(h, "base64url"));
  const body = JSON.parse(Buffer.from(p, "base64url"));
  assert.equal(head.typ, "dpop+jwt");
  assert.equal(head.alg, "ES256");
  assert.deepEqual(Object.keys(head.jwk).sort(), ["crv", "kty", "x", "y"]);
  assert.equal(body.htu, "https://api.mercari.jp/v2/entities:search");
  assert.equal(body.htm, "POST");
  assert.equal(body.iat, 1_700_000_000);
  assert.ok(body.uuid && body.jti);
  const ok = crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: signer.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  assert.ok(ok);
});

test("buildSearchBody: 정렬 이름을 API 값으로, 판매중만, 조건을 그대로 넣는다", () => {
  const b = buildSearchBody({ keyword: "ニット", exclude: "レディース", brandIds: [7331], categoryIds: [2], priceMin: 1000, priceMax: 30000, sort: "priceAsc", pageToken: "v1:1" });
  assert.equal(b.pageToken, "v1:1");
  assert.deepEqual(b.searchCondition.status, ["STATUS_ON_SALE"]);
  assert.equal(b.searchCondition.sort, "SORT_PRICE");
  assert.equal(b.searchCondition.order, "ORDER_ASC");
  assert.deepEqual(b.searchCondition.brandId, [7331]);
  assert.deepEqual(b.searchCondition.categoryId, [2]);
  assert.equal(b.searchCondition.priceMax, 30000);
  assert.equal(b.searchCondition.excludeKeyword, "レディース");
  assert.equal(buildSearchBody({}).searchCondition.sort, "SORT_CREATED_TIME");
});

test("mapResults: 화면에 필요한 값만, 가격은 숫자, 시각은 마지막 수정(없으면 등록) 기준 ISO", () => {
  const r = mapResults({ items: [{ id: "m1", name: "a", price: "8000", created: "1600000000", updated: "1700000000", thumbnails: ["t.jpg"] }], meta: { nextPageToken: "v1:1", numFound: "291" } });
  assert.deepEqual(r, { items: [{ id: "m1", name: "a", price: 8000, thumbnail: "t.jpg", shop: false, updatedAt: "2023-11-14T22:13:20.000Z" }], nextPageToken: "v1:1", total: 291 });
  assert.equal(mapResults({ items: [{ id: "2JYa", price: "1", itemType: "ITEM_TYPE_BEYOND" }] }).items[0].shop, true);
  assert.equal(mapResults({ items: [{ id: "m2", price: "1", created: "1700000000" }] }).items[0].updatedAt, "2023-11-14T22:13:20.000Z");
});

test("searchMercari: DPoP 헤더를 붙여 POST하고, 실패 응답이면 에러", async () => {
  const signer = createSigner();
  let sent;
  const fakeFetch = async (url, opts) => {
    sent = { url, opts };
    return { ok: true, json: async () => ({ items: [], meta: { numFound: "0" } }) };
  };
  await searchMercari(signer, { brandIds: [1] }, fakeFetch);
  assert.equal(sent.url, "https://api.mercari.jp/v2/entities:search");
  assert.equal(sent.opts.method, "POST");
  assert.ok(sent.opts.headers.DPoP.split(".").length === 3);
  assert.deepEqual(JSON.parse(sent.opts.body).searchCondition.brandId, [1]);
  await assert.rejects(searchMercari(signer, {}, async () => ({ ok: false, status: 403 })), /403/);
});

test("searchBrands: 같은 이름 → 앞부분 일치 → 짧은 이름 순, 대소문자 무시", () => {
  const brands = [{ id: 3, name: "Dior Homme", sub: "" }, { id: 1, name: "Christian Dior", sub: "" }, { id: 2, name: "DIOR", sub: "ディオール" }];
  assert.deepEqual(searchBrands(brands, "dior").map((b) => b.id), [2, 3, 1]);
  assert.deepEqual(searchBrands(brands, "ディオール").map((b) => b.id), [2]);
  assert.deepEqual(searchBrands(brands, "  "), []);
});

test("loadFacets + menCategoryTree: 실제 facets 파일에서 브랜드와 メンズ 중분류를 읽는다", () => {
  const { brands, categories } = loadFacets(path.join(__dirname, "..", "..", "facets"));
  assert.ok(brands.some((b) => b.name === "Dior Homme"));
  const men = menCategoryTree(categories);
  assert.equal(men.name, "メンズ");
  assert.ok(men.groups.some((g) => g.name === "トップス" && g.leaves.length > 0));
});
