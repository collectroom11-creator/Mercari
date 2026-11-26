// 3단계: 포토샵 버튼. Claude 없이 포토샵 스크립트(JSX)를 osascript로 직접 돌린다.
// 사용자 작업 방식(지난 작업 기록 기준):
//  - 배경 제작: 사진을 포토샵에 열고 맨 위 레이어 이름을 "사진"으로, 그 밑에 #E9E9E7로 채운
//    "배경 E9E9E7" 레이어를 깐다. 누끼(레이어 마스크)는 사용자가 직접 딴다.
//  - 크기 조정: 1(앞)·2(뒤) 사진의 누끼를 종류별 비율로 캔버스 가운데에 맞추고,
//    폴더의 사진을 전부 JPEG 품질 12로 N.jpg에 저장한다. 원본은 폴더 안 "원본/"으로 옮긴다.
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// 누끼가 3:4 캔버스에서 차지할 최대 비율(가로, 세로) - 사용자가 후루츠 기존 상품 기준으로 확정한 값
const FIT = {
  jacket: [0.72, 0.55], // 자켓·베스트
  hooded: [0.64, 0.6], // 후드 (끈은 빼고 보는 게 맞지만 마스크 범위로 잰다)
  coat: [0.72, 0.675], // 롱코트·파카
  pants: [0.9, 0.72], // 바지는 높이 기준
  shoes: [0.74, 0.55],
};
const FIT_LABEL = { jacket: "자켓", hooded: "후드", coat: "코트", pants: "바지", shoes: "신발" };

function fitKind(productName) {
  const n = String(productName || "");
  if (/슈즈|부츠|스니커즈|로퍼|더비|구두|샌들|신발/.test(n)) return "shoes";
  if (/팬츠|바지|데님(?!.*자켓)|진$|슬랙스|트라우저|카고/.test(n)) return "pants";
  if (/코트|파카|트렌치/.test(n)) return "coat";
  if (/후드|후디/.test(n)) return "hooded";
  return "jacket";
}

// JSX 파일 글자 깨짐을 피하려고 한글 등은 전부 \uXXXX로 바꿔서 넘긴다.
function asciiJs(src) {
  return src.replace(/[^\x00-\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

function runJsx(src, timeoutSec = 900) {
  const file = path.join(os.tmpdir(), `collectroom-${Date.now()}.jsx`);
  fs.writeFileSync(file, asciiJs(src));
  const script = `with timeout of ${timeoutSec} seconds\ntell application id "com.adobe.Photoshop" to do javascript file (POSIX file ${JSON.stringify(file)})\nend timeout`;
  return new Promise((resolve, reject) =>
    execFile("/usr/bin/osascript", ["-e", script], { timeout: (timeoutSec + 30) * 1000 }, (err, stdout, stderr) => {
      fs.rmSync(file, { force: true });
      if (err) {
        const msg = String(stderr || err.message);
        if (/not allowed|-1743/.test(msg)) return reject(new Error("포토샵 제어 권한이 필요해요: 시스템 설정 > 개인정보 보호 > 자동화에서 허용해주세요."));
        if (/-600|isn.t running/.test(msg)) return reject(new Error("포토샵을 먼저 켜주세요."));
        return reject(new Error(`포토샵 오류: ${msg.trim().slice(0, 200)}`));
      }
      resolve(stdout.trim());
    })
  );
}

const JSX_COMMON = `
var BG_NAME = "배경 E9E9E7", PHOTO_NAME = "사진";
function findDoc(p){
  for (var i=0;i<app.documents.length;i++){
    var d=app.documents[i];
    try { if (d.fullName.fsName == File(p).fsName) return d; } catch(e) {}
  }
  return null;
}
function hasBg(d){ for (var j=0;j<d.layers.length;j++) if (d.layers[j].name==BG_NAME) return true; return false; }
`;

// files: 열어서 배경을 깔 사진들의 절대 경로
function addBackgroundJsx(files) {
  return `${JSX_COMMON}
var files = ${JSON.stringify(files)};
var saved = app.displayDialogs; app.displayDialogs = DialogModes.NO;
var c = new SolidColor(); c.rgb.red=233; c.rgb.green=233; c.rgb.blue=231;
var made=0, skipped=0, errs=[];
for (var i=0;i<files.length;i++){
  try {
    var d = findDoc(files[i]) || app.open(File(files[i]));
    app.activeDocument = d;
    if (hasBg(d)) { skipped++; continue; }
    var photo = d.layers[0];
    if (photo.isBackgroundLayer) photo.isBackgroundLayer = false;
    photo.name = PHOTO_NAME;
    var bg = d.artLayers.add(); bg.name = BG_NAME;
    d.selection.selectAll(); d.selection.fill(c); d.selection.deselect();
    bg.move(photo, ElementPlacement.PLACEAFTER);
    d.activeLayer = photo;
    made++;
  } catch(e) { errs.push(File(files[i]).name + ": " + e.message); }
}
app.displayDialogs = saved;
made + "|" + skipped + "|" + errs.join(" ; ");
`;
}

// jobs: [{src, out, fit:[fw,fh]|null}] - src는 포토샵에 열려 있는 문서의 파일 경로
function fitAndSaveJsx(jobs) {
  return `${JSX_COMMON}
function loadMask(){var d=new ActionDescriptor();var r=new ActionReference();r.putProperty(charIDToTypeID('Chnl'),charIDToTypeID('fsel'));d.putReference(charIDToTypeID('null'),r);var r2=new ActionReference();r2.putEnumerated(charIDToTypeID('Chnl'),charIDToTypeID('Chnl'),charIDToTypeID('Msk '));d.putReference(charIDToTypeID('T   '),r2);executeAction(charIDToTypeID('setd'),d,DialogModes.NO);}
function maskBounds(d){ loadMask(); var b=d.selection.bounds; d.selection.deselect(); return [b[0].as('px'),b[1].as('px'),b[2].as('px'),b[3].as('px')]; }
var jobs = ${JSON.stringify(jobs)};
var saved = app.displayDialogs; app.displayDialogs = DialogModes.NO;
var o = new JPEGSaveOptions(); o.quality = 12; o.embedColorProfile = true;
var out=[], errs=[];
for (var i=0;i<jobs.length;i++){
  var j = jobs[i];
  try {
    var d = findDoc(j.src);
    if (!d) { errs.push(File(j.src).name + ": 포토샵에 안 열려 있음"); continue; }
    app.activeDocument = d;
    var note = "";
    if (j.fit) {
      var photo = d.layers[0]; d.activeLayer = photo;
      var W = d.width.as('px'), H = d.height.as('px'), b;
      try { b = maskBounds(d); } catch(e) { b = null; }
      if (!b) { note = "누끼없음"; }
      else {
        var s = Math.min(j.fit[0]*W/(b[2]-b[0]), j.fit[1]*H/(b[3]-b[1])) * 100;
        photo.resize(s, s, AnchorPosition.MIDDLECENTER);
        b = maskBounds(d);
        photo.translate(W/2 - (b[0]+b[2])/2, H/2 - (b[1]+b[3])/2);
        note = "맞춤";
      }
    }
    d.saveAs(new File(j.out), o, true, Extension.LOWERCASE);
    out.push(File(j.out).name + (note ? "(" + note + ")" : ""));
    if (j.close) d.close(SaveOptions.DONOTSAVECHANGES);
  } catch(e) { errs.push(File(j.src).name + ": " + e.message); }
}
app.displayDialogs = saved;
out.join(",") + "|" + errs.join(" ; ");
`;
}

const JSX_MASK = `
function loadMask(){var d=new ActionDescriptor();var r=new ActionReference();r.putProperty(charIDToTypeID('Chnl'),charIDToTypeID('fsel'));d.putReference(charIDToTypeID('null'),r);var r2=new ActionReference();r2.putEnumerated(charIDToTypeID('Chnl'),charIDToTypeID('Chnl'),charIDToTypeID('Msk '));d.putReference(charIDToTypeID('T   '),r2);executeAction(charIDToTypeID('setd'),d,DialogModes.NO);}
function maskBounds(d){ loadMask(); var b=d.selection.bounds; d.selection.deselect(); return [b[0].as('px'),b[1].as('px'),b[2].as('px'),b[3].as('px')]; }
`;

// 선택 없이 쓰는 버튼용: 지금 포토샵에 열린 문서 전부에 배경을 깐다(이미 있으면 건너뜀).
function backgroundOpenJsx() {
  return `${JSX_COMMON}
var saved = app.displayDialogs; app.displayDialogs = DialogModes.NO;
var c = new SolidColor(); c.rgb.red=233; c.rgb.green=233; c.rgb.blue=231;
var made=0, skipped=0, errs=[];
for (var i=0;i<app.documents.length;i++){
  var d = app.documents[i];
  try {
    app.activeDocument = d;
    if (hasBg(d)) { skipped++; continue; }
    var photo = d.layers[0];
    if (photo.isBackgroundLayer) photo.isBackgroundLayer = false;
    photo.name = PHOTO_NAME;
    var bg = d.artLayers.add(); bg.name = BG_NAME;
    d.selection.selectAll(); d.selection.fill(c); d.selection.deselect();
    bg.move(photo, ElementPlacement.PLACEAFTER);
    d.activeLayer = photo;
    made++;
  } catch(e) { errs.push(d.name + ": " + e.message); }
}
app.displayDialogs = saved;
made + "|" + skipped + "|" + errs.join(" ; ");
`;
}

// 열린 문서마다 "번호<TAB>파일 경로(없으면 빈칸)<TAB>누끼 있음(1/0)<TAB>문서 이름"
function docsInfoJsx() {
  return `${JSX_COMMON}${JSX_MASK}
var r=[];
for (var i=0;i<app.documents.length;i++){
  var d=app.documents[i]; app.activeDocument=d; var p="";
  try { p=d.fullName.fsName; } catch(e) {}
  var m=0; try { d.activeLayer=d.layers[0]; maskBounds(d); m=1; } catch(e) {}
  r.push(i+"\\t"+p+"\\t"+m+"\\t"+d.name);
}
r.join("\\n");
`;
}

// jobs: [{index, fit:[fw,fh]}] - 누끼를 비율대로 가운데 맞춤(저장은 안 함, 저장은 일괄 저장 버튼)
function fitOpenJsx(jobs) {
  return `${JSX_COMMON}${JSX_MASK}
var jobs = ${JSON.stringify(jobs)};
var ok=[], errs=[];
for (var i=0;i<jobs.length;i++){
  var d = app.documents[jobs[i].index];
  try {
    app.activeDocument = d; var photo = d.layers[0]; d.activeLayer = photo;
    var W = d.width.as('px'), H = d.height.as('px'), b = maskBounds(d), f = jobs[i].fit;
    var s = Math.min(f[0]*W/(b[2]-b[0]), f[1]*H/(b[3]-b[1])) * 100;
    photo.resize(s, s, AnchorPosition.MIDDLECENTER);
    b = maskBounds(d);
    photo.translate(W/2 - (b[0]+b[2])/2, H/2 - (b[1]+b[3])/2);
    ok.push(d.name);
  } catch(e) { errs.push(d.name + ": " + e.message); }
}
ok.length + "|" + errs.join(" ; ");
`;
}

// 어떤 옷인지 Claude가 보게 작은 미리보기 저장. items: [{index, out}]
function previewJsx(items) {
  return `
var items = ${JSON.stringify(items)};
var o = new JPEGSaveOptions(); o.quality = 7;
for (var i=0;i<items.length;i++){
  var d = app.documents[items[i].index]; app.activeDocument = d;
  var t = d.duplicate("preview", true);
  t.resizeImage(null, UnitValue(640,'px'), 72, ResampleMethod.BILINEAR);
  t.saveAs(new File(items[i].out), o, true); t.close(SaveOptions.DONOTSAVECHANGES);
}
"ok";
`;
}

// 포토샵에 열려 있는 문서들의 파일 경로
async function openDocPaths() {
  const r = await runJsx(`var r=[];for(var i=0;i<app.documents.length;i++){try{r.push(app.documents[i].fullName.fsName)}catch(e){}}r.join("\\n")`, 60);
  return r ? r.split("\n").map((p) => p.normalize("NFC")) : [];
}

module.exports = { FIT, FIT_LABEL, fitKind, asciiJs, runJsx, addBackgroundJsx, fitAndSaveJsx, openDocPaths, backgroundOpenJsx, docsInfoJsx, fitOpenJsx, previewJsx };
