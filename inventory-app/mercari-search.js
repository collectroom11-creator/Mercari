// 앱 안의 매입 검색: 메루카리 검색 API(api.mercari.jp/v2/entities:search)를 직접 부른다.
// 알림 봇(main.py)이 쓰는 mercapi 라이브러리와 같은 방식 - 요청마다 ES256으로 서명한
// DPoP 토큰을 붙여야 한다. 브랜드/카테고리 ID는 저장소의 facets/*.json(하루 한 번 갱신)에서 찾는다.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SEARCH_URL = "https://api.mercari.jp/v2/entities:search";
const SORTS = {
  new: { sort: "SORT_CREATED_TIME", order: "ORDER_DESC" },
  priceAsc: { sort: "SORT_PRICE", order: "ORDER_ASC" },
  priceDesc: { sort: "SORT_PRICE", order: "ORDER_DESC" },
};

// 앱이 켜져 있는 동안 같은 키/기기 id를 쓴다(웹 브라우저 한 대처럼 보이게).
function createSigner() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const { crv, kty, x, y } = publicKey.export({ format: "jwk" });
  const deviceUuid = crypto.randomUUID();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return {
    publicKey,
    dpop(url, method, now = Date.now()) {
      const head = b64({ typ: "dpop+jwt", alg: "ES256", jwk: { crv, kty, x, y } });
      const body = b64({ iat: Math.floor(now / 1000), jti: crypto.randomUUID(), htu: url, htm: method, uuid: deviceUuid });
      const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
      return `${head}.${body}.${sig.toString("base64url")}`;
    },
  };
}

function buildSearchBody({ keyword = "", exclude = "", brandIds = [], categoryIds = [], priceMin = 0, priceMax = 0, sort = "new", pageToken = "", pageSize = 60 } = {}) {
  const s = SORTS[sort] || SORTS.new;
  return {
    userId: "",
    pageSize,
    pageToken,
    searchSessionId: crypto.randomUUID().replace(/-/g, ""),
    indexRouting: "INDEX_ROUTING_UNSPECIFIED",
    thumbnailTypes: [],
    searchCondition: {
      keyword,
      sort: s.sort,
      order: s.order,
      status: ["STATUS_ON_SALE"],
      sizeId: [],
      categoryId: categoryIds,
      brandId: brandIds,
      sellerId: [],
      priceMin: priceMin || 0,
      priceMax: priceMax || 0,
      itemConditionId: [],
      shippingPayerId: [],
      shippingFromArea: [],
      shippingMethod: [],
      colorId: [],
      hasCoupon: false,
      attributes: [],
      itemTypes: [],
      skuIds: [],
      excludeKeyword: exclude,
    },
    defaultDatasets: [],
    serviceFrom: "suruga",
  };
}

// API 응답에서 화면에 필요한 것만
function mapResults(json) {
  return {
    items: (json.items || []).map((i) => ({
      id: i.id,
      name: i.name,
      price: Number(i.price),
      thumbnail: (i.thumbnails || [])[0] || null,
      // 메루카리 Shops 상품(약 20%)은 id 모양과 상품 주소가 다르다(/shops/product/ID)
      shop: i.itemType === "ITEM_TYPE_BEYOND",
      // 최신순은 등록이 아니라 마지막 수정(가격 변경·재등록) 기준으로 정렬돼서, 화면에도 그 시각을 쓴다
      updatedAt: i.updated || i.created ? new Date(Number(i.updated || i.created) * 1000).toISOString() : null,
    })),
    nextPageToken: json.meta?.nextPageToken || "",
    // numFound는 첫 페이지 기준 추정치라 실제로 넘겨 보면 더 많다 - 화면엔 쓰지 않는다
    total: Number(json.meta?.numFound || 0),
  };
}

async function searchMercari(signer, conditions, fetchImpl = fetch) {
  const res = await fetchImpl(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Platform": "web",
      DPoP: signer.dpop(SEARCH_URL, "POST"),
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(buildSearchBody(conditions)),
  });
  if (!res.ok) throw new Error(`메루카리 검색 실패 (HTTP ${res.status})`);
  return mapResults(await res.json());
}

// ---- facets: 브랜드 자동완성, 남성 카테고리 목록 ----
function loadFacets(facetsDir) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(facetsDir, f), "utf-8"));
  const brands = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if ("id" in n && typeof n.name === "string") brands.push({ id: n.id, name: n.name, sub: n.sub_name || "" });
      else Object.values(n).forEach(walk);
    }
  };
  walk(read("brands.json").data);
  return { brands, categories: read("categories.json").data };
}

// 이름/영문 표기 어디에든 들어 있으면 후보. 정확히 같은 것 → 앞부분이 같은 것 → 짧은 이름 순.
function searchBrands(brands, query, limit = 10) {
  const q = String(query).trim().toLowerCase();
  if (!q) return [];
  const rank = (b) => {
    const n = b.name.toLowerCase();
    return n === q ? 0 : n.startsWith(q) ? 1 : 2;
  };
  return brands
    .filter((b) => b.name.toLowerCase().includes(q) || b.sub.toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length)
    .slice(0, limit)
    .map(({ id, name }) => ({ id, name }));
}

// メンズ 아래 중분류(トップス 등)와 그 아래 소분류. 화면에서 고르기 쉽게 이 구조 그대로 넘긴다.
function menCategoryTree(categories) {
  const men = categories.find((c) => c.name === "メンズ");
  if (!men) return null;
  return {
    id: men.id,
    name: men.name,
    groups: (men.child || []).map((g) => ({ id: g.id, name: g.name, leaves: (g.child || []).map((l) => ({ id: l.id, name: l.name })) })),
  };
}

module.exports = { createSigner, buildSearchBody, mapResults, searchMercari, loadFacets, searchBrands, menCategoryTree };
