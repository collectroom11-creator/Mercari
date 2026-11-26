// 파일 관리 창의 파일 작업. 제품 하나 = `업로드 파일/<제품명>/` 폴더 하나.
// 폴더 안 규칙(사용자 워크플로): `인스타 썸네일.jpg`, `후루츠 썸네일.jpg`, 그다음
// 1.jpg(앞) 2.jpg(뒤) 3.jpg(태그) 4+ 디테일, 그리고 `<제품명>.txt`(설명 글).
// 실측/하자는 txt 안의 "- Size :" 줄과 "※" 줄이 원본이다.
const fs = require("node:fs");
const path = require("node:path");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".heic", ".webp"]);
const THUMB_NAMES = ["인스타 썸네일", "후루츠 썸네일"];

function isImage(name) {
  return IMAGE_EXT.has(path.extname(name).toLowerCase()) && !name.startsWith(".");
}

function numberOf(name) {
  const m = /^(\d+)\.[^.]+$/.exec(name);
  return m ? Number(m[1]) : null;
}

// 폴더 안 사진을 썸네일 / 번호 사진(번호순) / 기타로 나눈다.
function listPhotos(dir) {
  if (!fs.existsSync(dir)) return { thumbs: [], numbered: [], others: [] };
  const names = fs.readdirSync(dir).filter(isImage);
  // 맥 파일명은 한글이 자모 분리형(NFD)으로 올 수 있어서 NFC로 맞춰 비교한다.
  const thumbs = THUMB_NAMES.map((t) => names.find((n) => path.parse(n).name.normalize("NFC") === t)).filter(Boolean);
  const numbered = names.filter((n) => numberOf(n) != null).sort((a, b) => numberOf(a) - numberOf(b));
  const others = names.filter((n) => !thumbs.includes(n) && !numbered.includes(n)).sort();
  return { thumbs, numbered, others };
}

function nextNumber(dir) {
  const { numbered } = listPhotos(dir);
  return numbered.length ? numberOf(numbered[numbered.length - 1]) + 1 : 1;
}

function txtPath(dir, productName) {
  const own = path.join(dir, `${productName}.txt`);
  if (fs.existsSync(own)) return own;
  if (!fs.existsSync(dir)) return own;
  const any = fs.readdirSync(dir).find((n) => n.endsWith(".txt") && !n.startsWith("."));
  return any ? path.join(dir, any) : own;
}

const SIZE_RE = /^- Size : (.*)$/m;

function parseListing(text) {
  const size = (SIZE_RE.exec(text) || [])[1] || "";
  const lines = text.split("\n");
  const defects = lines.filter((l) => l.startsWith("※")).map((l) => l.replace(/^※\s*/, ""));
  const materials = lines.filter((l) => l.startsWith("·")).map((l) => l.replace(/^·\s*/, ""));
  return { size, defects, materials };
}

// prefix로 시작하는 줄 묶음(소재 "·", 하자 "※")을 새 줄들로 바꾼다. 묶음이 없었으면
// before(lines)가 알려주는 줄 바로 위에 빈 줄과 함께 넣는다. 다 지우면 뒤 빈 줄도 같이 지운다.
function replaceBlock(lines, prefix, newLines, before) {
  const first = lines.findIndex((l) => l.startsWith(prefix));
  if (first !== -1) {
    let last = first;
    while (last + 1 < lines.length && lines[last + 1].startsWith(prefix)) last++;
    const removeTrailingBlank = newLines.length === 0 && lines[last + 1] === "";
    lines.splice(first, last - first + 1 + (removeTrailingBlank ? 1 : 0), ...newLines);
  } else if (newLines.length) {
    const idx = before(lines);
    if (idx !== -1) lines.splice(idx, 0, ...newLines, "");
  }
  return lines;
}

// 실측/소재/하자만 바꾸고 나머지 글은 그대로 둔다.
// 순서는 사용자 양식대로: 제품명 줄 → 소재(·) → 하자(※) → Price/Size.
function applyListingEdits(text, { size, defects, materials }) {
  let out = text;
  if (size != null && SIZE_RE.test(out)) out = out.replace(SIZE_RE, `- Size : ${size}`);
  let lines = out.split("\n");
  const priceIdx = (ls) => ls.findIndex((l) => l.startsWith("- Price"));
  if (materials != null) {
    const clean = materials.map((d) => d.trim()).filter(Boolean).map((d) => `· ${d}`);
    lines = replaceBlock(lines, "·", clean, (ls) => {
      const d = ls.findIndex((l) => l.startsWith("※"));
      return d !== -1 ? d : priceIdx(ls);
    });
  }
  if (defects != null) {
    const clean = defects.map((d) => d.trim()).filter(Boolean).map((d) => `※ ${d}`);
    lines = replaceBlock(lines, "※", clean, priceIdx);
  }
  return lines.join("\n");
}

// 설명 글이 아직 없는 제품용 txt를 사용자 양식대로 만든다(지금 txt들과 같은 모양).
// 신발은 착용 정보(178cm / 63kg) 줄이 없다.
function buildListing({ productName, size, materials, defects, price, isShoes }) {
  const label = (size || "").split(" (")[0].trim();
  const lines = [label ? `${productName} ${label}` : productName, ""];
  const mats = (materials || []).map((m) => m.trim()).filter(Boolean);
  if (mats.length) lines.push(...mats.map((m) => `· ${m}`), "");
  const defs = (defects || []).map((d) => d.trim()).filter(Boolean);
  if (defs.length) lines.push(...defs.map((d) => `※ ${d}`), "");
  lines.push(`- Price : ${price != null ? Number(price).toLocaleString("en-US") : ""}원`);
  lines.push(`- Size : ${size || ""}`, "");
  if (!isShoes) lines.push("178cm / 63kg", "");
  lines.push("최선을 다해 검수하고 있습니다.", "가품 확인시 100% 환불 도와드리겠습니다.", "", "@collectroom_", "");
  return lines.join("\n");
}

function readListing(dir, productName) {
  const p = txtPath(dir, productName);
  if (!fs.existsSync(p)) return { hasTxt: false, size: "", defects: [], materials: [] };
  return { hasTxt: true, ...parseListing(fs.readFileSync(p, "utf-8")) };
}

function writeListing(dir, productName, edits) {
  const p = txtPath(dir, productName);
  if (!fs.existsSync(p)) return false;
  const before = fs.readFileSync(p, "utf-8");
  const after = applyListingEdits(before, edits);
  if (after !== before) fs.writeFileSync(p, after);
  return true;
}

// 제품명 변경: 폴더 이름, txt 파일 이름, txt 첫 줄의 제품명 부분을 같이 바꾼다.
function renameProduct(root, oldName, newName) {
  const from = path.join(root, oldName);
  const to = path.join(root, newName);
  if (oldName === newName) return;
  if (fs.existsSync(to)) throw new Error(`"${newName}" 폴더가 이미 있어요.`);
  fs.renameSync(from, to);
  const oldTxt = path.join(to, `${oldName}.txt`);
  if (fs.existsSync(oldTxt)) {
    const newTxt = path.join(to, `${newName}.txt`);
    fs.renameSync(oldTxt, newTxt);
    const text = fs.readFileSync(newTxt, "utf-8");
    const [first, ...rest] = text.split("\n");
    if (first.startsWith(oldName)) {
      fs.writeFileSync(newTxt, [newName + first.slice(oldName.length), ...rest].join("\n"));
    }
  }
}

// 번호 사진 순서 바꾸기: orderedNames 순서대로 1, 2, 3 ...으로 다시 붙인다.
// 이름이 겹치지 않게 임시 이름을 거쳐서 바꾼다.
function reorderPhotos(dir, orderedNames) {
  const tmp = orderedNames.map((n, i) => {
    const t = `.reorder-${i}${path.extname(n).toLowerCase()}`;
    fs.renameSync(path.join(dir, n), path.join(dir, t));
    return t;
  });
  tmp.forEach((t, i) => {
    const ext = path.extname(t) === ".jpeg" ? ".jpg" : path.extname(t);
    fs.renameSync(path.join(dir, t), path.join(dir, `${i + 1}${ext}`));
  });
}

// 남은 번호 사진을 1부터 빈칸 없이 다시 매긴다(사진을 다른 탭으로 뺀 뒤).
function compactNumbers(dir) {
  reorderPhotos(dir, listPhotos(dir).numbered);
}

function uniqueTarget(dir, name) {
  let target = path.join(dir, name);
  const { name: base, ext } = path.parse(name);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${base} ${i}${ext}`);
  return target;
}

// 다른 제품 폴더로 사진 옮기기. 번호 사진은 받는 폴더의 다음 번호로, 그 밖의 사진
// (썸네일 등)은 이름 그대로(겹치면 뒤에 숫자) 옮긴다.
function movePhoto(fromDir, name, toDir) {
  fs.mkdirSync(toDir, { recursive: true });
  const ext = path.extname(name).toLowerCase();
  const target = numberOf(name) != null ? path.join(toDir, `${nextNumber(toDir)}${ext}`) : uniqueTarget(toDir, name);
  fs.renameSync(path.join(fromDir, name), target);
  if (numberOf(name) != null) compactNumbers(fromDir);
  return path.basename(target);
}

// 파인더에서 끌어온 사진을 다음 번호로 복사한다(원본은 그대로).
function addPhotos(dir, srcPaths) {
  fs.mkdirSync(dir, { recursive: true });
  const added = [];
  for (const src of srcPaths) {
    if (!isImage(path.basename(src))) continue;
    const ext = path.extname(src).toLowerCase();
    const target = path.join(dir, `${nextNumber(dir)}${ext === ".jpeg" ? ".jpg" : ext}`);
    fs.copyFileSync(src, target);
    added.push(path.basename(target));
  }
  return added;
}

// 분류된 사진을 제품 폴더로 옮긴다(미분류 보관함에서). 앞/뒤/태그/디테일은 다음 번호로,
// 실측·착용 사진은 번호 없이 "실측.jpg", "착용.jpg"(겹치면 "실측 2.jpg")로 둔다.
function placePhoto(dir, srcPath, extraName) {
  fs.mkdirSync(dir, { recursive: true });
  let ext = path.extname(srcPath).toLowerCase();
  if (ext === ".jpeg") ext = ".jpg";
  const target = extraName ? uniqueTarget(dir, `${extraName}${ext}`) : path.join(dir, `${nextNumber(dir)}${ext}`);
  fs.renameSync(srcPath, target);
  return path.basename(target);
}

// 넘기기: `업로드 완료/`로 폴더를 옮긴다. 같은 이름이 이미 있으면 덮어쓰지 않는다.
function finishProduct(root, doneRoot, name) {
  const from = path.join(root, name);
  if (!fs.existsSync(from)) return null;
  fs.mkdirSync(doneRoot, { recursive: true });
  const to = uniqueTarget(doneRoot, name);
  fs.renameSync(from, to);
  return to;
}

module.exports = {
  listPhotos,
  parseListing,
  applyListingEdits,
  readListing,
  writeListing,
  renameProduct,
  reorderPhotos,
  movePhoto,
  addPhotos,
  finishProduct,
  placePhoto,
  isImage,
  compactNumbers,
  buildListing,
  txtPath,
};
