// 2단계: 한꺼번에 넣은 사진을 Claude가 보고 제품 탭별로 나누고, 실측 사진의 숫자를
// 읽고, 제품명이 없는 탭에 제품명을 제안한다. 여기는 Claude에게 줄 글/형식과
// 받은 결과를 "무엇을 어디로 옮길지"로 바꾸는 순수 함수만 둔다(파일 작업은 main.js).

// 번호 사진 순서: 1 앞, 2 뒤, 3 태그, 4+ 디테일 (사용자 규칙)
const NUMBERED_KINDS = ["front", "back", "tag", "detail"];
const EXTRA_NAMES = { measure: "실측", worn: "착용", care: "소재" };

const SCHEMA = {
  type: "object",
  properties: {
    names: {
      type: "array",
      items: {
        type: "object",
        properties: { productId: { type: "string" }, name: { type: "string" } },
        required: ["productId", "name"],
      },
    },
    photos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          productId: { type: ["string", "null"] },
          kind: { type: "string", enum: ["front", "back", "tag", "detail", "measure", "care", "worn", "unknown"] },
        },
        required: ["file", "productId", "kind"],
      },
    },
    measurements: {
      type: "array",
      items: {
        type: "object",
        properties: { productId: { type: "string" }, size: { type: "string" } },
        required: ["productId", "size"],
      },
    },
    materials: {
      type: "array",
      items: {
        type: "object",
        properties: { productId: { type: "string" }, lines: { type: "array", items: { type: "string" } } },
        required: ["productId", "lines"],
      },
    },
  },
  required: ["names", "photos", "measurements", "materials"],
};

// products: [{id, mercariTitle, mercImage, knownImage, folder}] - 이미지는 cwd 기준 경로
// photos: ["p001.jpg", ...], nameExamples: 기존 폴더 이름들
function buildPrompt({ products, photos, nameExamples }) {
  const lines = [];
  lines.push("빈티지 의류 리셀 샵의 상품 사진 정리 작업이야. 결과는 정해진 JSON 형식으로만 답해.");
  lines.push("");
  lines.push("## 상품 목록");
  for (const p of products) {
    const imgs = [`메루카리 사진 ${p.mercImage}`];
    if (p.knownImage) imgs.push(`이미 정리된 앞면 사진 ${p.knownImage}`);
    lines.push(`- productId ${p.id} | 메루카리 제목: ${p.mercariTitle} | 제품명: ${p.folder || "(없음 - 제안 필요)"} | ${imgs.join(", ")}`);
  }
  lines.push("");
  if (photos.length) {
    lines.push("## 분류할 사진");
    lines.push(photos.join(", "));
    lines.push("");
    lines.push("1. 상품 목록의 사진과 분류할 사진을 전부 Read로 열어서 봐. 시간이 오래 걸리니 하나씩 열지 말고, 한 번의 응답에서 Read를 여러 개 동시에(병렬로) 불러서 전부 한꺼번에 열어.");
    lines.push("2. photos: 분류할 사진마다 어느 상품인지(productId, 확실하지 않으면 null)와 종류(kind)를 정해.");
    lines.push("   kind: front=앞면 전체, back=뒷면 전체, tag=목 쪽 브랜드·사이즈 태그(상품 사진으로 올리는 것), detail=부분 확대, measure=실측(줄자를 대거나 치수를 적은 사진), care=안쪽 세탁·소재 라벨을 가까이 찍은 사진(혼용률이 보이는 것, 소재 읽기용), worn=사람이 입은 사진, unknown=모르겠음.");
    lines.push("   같은 상품의 앞면이 여러 장이면 가장 잘 나온 한 장만 front, 나머지는 detail.");
    lines.push("3. measurements: measure 사진이 있는 상품만, 사진에서 읽은 숫자로 사이즈 줄을 만들어. 읽을 수 없는 숫자는 지어내지 말고 빼.");
    lines.push("   형식 예: 상의 `M (어깨 46.5 / 가슴 55 / 소매 66.5 / 총장 68)`, 바지 `30 (허리 40.5 / 밑위 24 / 허벅지 27 / 총장 100 / 밑단 17.5)`.");
    lines.push("   맨 앞 사이즈 표기(M, 30, XL 등)는 태그 사진이나 메루카리 제목에서 찾고, 없으면 숫자 부분만 써.");
    lines.push("4. materials는 빈 배열로 둬. (소재 라벨은 사용자가 직접 제품에 배정하고, 그때 따로 읽어.)");
  } else {
    lines.push("분류할 사진은 없어. photos, measurements, materials는 빈 배열로 둬.");
  }
  lines.push("");
  lines.push("## 제품명 제안 (names)");
  lines.push("제품명이 (없음)인 상품만 names에 넣어. 메루카리 제목과 사진을 보고 지어.");
  lines.push("형식: 브랜드 영문 표기 + 특징 + 아이템(한국어). 사이즈는 넣지 마. 지어낸 소재·연도는 넣지 마.");
  lines.push("기존 제품명에 같은 브랜드가 있으면 브랜드 표기(띄어쓰기·대소문자 포함)를 그대로 따라 써. 예: TORNADO MART, junhashimoto.");
  if (nameExamples.length) lines.push(`기존 제품명 예시: ${nameExamples.slice(0, 25).join(" / ")}`);
  return lines.join("\n");
}

// Claude 결과를 실제 이동 계획으로 바꾼다. 모르는 productId/파일은 미분류로 남긴다.
function planMoves(result, { validIds, photos }) {
  const ids = new Set(validIds);
  const files = new Set(photos);
  const seen = new Set();
  const moves = [];
  for (const p of result.photos || []) {
    if (!files.has(p.file) || seen.has(p.file)) continue;
    seen.add(p.file);
    if (!p.productId || !ids.has(p.productId) || p.kind === "unknown") continue;
    moves.push({ file: p.file, productId: p.productId, kind: p.kind });
  }
  // 제품마다 앞→뒤→태그→디테일 순으로 번호가 붙도록 정렬(같은 종류는 넣은 순서대로).
  const rank = (k) => (NUMBERED_KINDS.includes(k) ? NUMBERED_KINDS.indexOf(k) : 10);
  const order = new Map(photos.map((f, i) => [f, i]));
  moves.sort((a, b) => rank(a.kind) - rank(b.kind) || order.get(a.file) - order.get(b.file));
  const moved = new Set(moves.map((m) => m.file));
  return { moves, unsorted: photos.filter((f) => !moved.has(f)) };
}

function cleanNames(result, idsWithoutName) {
  const ok = new Set(idsWithoutName);
  return (result.names || [])
    .filter((n) => ok.has(n.productId) && String(n.name || "").trim())
    .map((n) => ({ productId: n.productId, name: n.name.replace(/[\/:]/g, " ").replace(/\s+/g, " ").trim() }));
}

// 같은 부위가 여러 줄로 나뉘어 오면(겉감 면 97% / 겉감 폴리우레탄 3%) 한 줄로 합친다:
// 사용자 규칙 "부위마다 한 줄 - 겉감 면 97% 폴리우레탄 3%".
const PART_RE = /^(겉감|안감|립|배색|앞판|뒤판|몸판|소매|충전재|칼라|트리밍|본체|겉감2|안감2)\s+(.+)$/;
function mergeParts(lines) {
  const out = [];
  const byPart = new Map();
  for (const l of lines) {
    const m = PART_RE.exec(l);
    if (!m) {
      out.push(l);
      continue;
    }
    if (byPart.has(m[1])) out[byPart.get(m[1])] += ` ${m[2]}`;
    else {
      byPart.set(m[1], out.length);
      out.push(`${m[1]} ${m[2]}`);
    }
  }
  return out;
}

function cleanMaterials(result, validIds) {
  const ok = new Set(validIds);
  return (result.materials || [])
    .filter((m) => ok.has(m.productId))
    .map((m) => ({ productId: m.productId, lines: mergeParts((m.lines || []).map((l) => String(l).replace(/^·\s*/, "").trim()).filter(Boolean)) }))
    .filter((m) => m.lines.length);
}

function cleanMeasurements(result, validIds) {
  const ok = new Set(validIds);
  return (result.measurements || []).filter((m) => ok.has(m.productId) && String(m.size || "").trim());
}

module.exports = { SCHEMA, NUMBERED_KINDS, EXTRA_NAMES, buildPrompt, planMoves, cleanNames, cleanMeasurements, cleanMaterials };
