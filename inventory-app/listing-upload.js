// 3단계: 후루츠/인스타 업로드. 앱이 Claude(claude -p --chrome)를 불러 사용자의 크롬으로 올린다.
// 지시문은 사용자가 지금까지 하나씩 고쳐 준 업로드 규칙(메모)을 그대로 옮긴 것.
// 정보를 지어내지 않는다: 글은 txt를 그대로, 사진은 폴더 사진만 쓴다.


// txt에서 가격(원) 읽기: "- Price : 180,000원"
function parsePrice(text) {
  const m = /^- Price : ([\d,]+)/m.exec(text || "");
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

// 올릴 사진 순서. 후루츠: 후루츠 썸네일 → 1,2,3… / 인스타: 인스타 썸네일 → 1,2,3…
// 실측·착용 등 번호 없는 사진은 넣지 않는다. 썸네일이 없으면 1번부터.
function photoOrder(photos, platform) {
  const thumbName = platform === "fruits" ? "후루츠 썸네일" : "인스타 썸네일";
  const thumb = photos.thumbs.find((n) => n.replace(/\.[^.]+$/, "").normalize("NFC") === thumbName);
  return [...(thumb ? [thumb] : []), ...photos.numbered];
}

function commonRules() {
  return [
    "- 사용자의 크롬(claude-in-chrome 도구)으로 작업해.",
    "- 크롬 창은 딱 하나만 써: 처음에 tabs_context_mcp(createIfEmpty: true)로 창/탭 하나를 만들고, 모든 작업을 그 탭 하나에서 주소를 바꿔가며 해. 새 탭이나 새 창을 열지 마. 사용자가 원래 열어둔 탭은 건드리지 마.",
    "- 모든 작업이 끝나면(실패가 있어도) 네가 만든 탭을 tabs_close_mcp로 닫아서 그 창이 닫히게 해.",
    "- 글과 정보는 각 작업의 '설명 글'에 있는 것만 써. 지어내거나 덧붙이지 마.",
    "- 사진은 각 작업에 적힌 경로의 파일만, 적힌 순서대로 file_upload로 올려.",
    "- 로그인이 풀려 있거나, 캡차·본인확인이 뜨거나, 확실하지 않은 선택이 있으면 그 작업은 올리지 말고 uploaded=false, problem에 이유를 적고 다음 작업으로 넘어가.",
    "- 업로드(공유) 버튼을 누르기 직전에 모든 칸을 처음부터 다시 확인해.",
    "- 끝나면 결과를 JSON으로만 답해: results 배열에 작업마다 {task(작업 번호), uploaded, url(상품/게시물 주소, 모르면 null), problem(없으면 null)}.",
  ];
}

function fruitsRules() {
  return [
    "### 후루츠 작업 규칙",
    "- https://fruitsfamily.com/upload 에서 올려.",
    "- 제목 = 설명 글 첫 줄 그대로. 설명 = 둘째 줄부터 끝까지 그대로(첫 줄 다음 빈 줄은 빼고).",
    "- 사진: 적힌 순서 그대로(첫 장이 대표 사진).",
    "- 성별 기본 남성. 카테고리는 상품에 맞게: 가죽 자켓→아우터>가죽자켓, 트랙자켓·져지→아우터>져지, 후드집업→아우터>후드집업, 코트·트렌치·파카→아우터>코트, 니트→상의>니트, 구두·로퍼·더비→신발>구두/로퍼, 부츠→신발>부츠. 애매하면 멈춰.",
    "- 사이즈: 설명 글 Size 줄 맨 앞 표기 기준. 신발은 '(255 추천)'처럼 추천 mm가 있으면 그 값. 여성 사이즈라고 적혀 있으면 적힌 남성 사이즈로.",
    "- 상태: 설명에 따로 없으면 '아주 좋은 상태'.",
    "- 실측 칸(총장/어깨/가슴/소매 등)은 Size 줄 괄호 안 숫자로 채워. '79.5/85.5'처럼 두 값이면 앞 값.",
    "- 브랜드: 브랜드 입력칸에 브랜드명을 직접 타이핑하고 드롭다운 항목을 find로 찾은 ref로 골라. 박스가 ✕ 달린 칩으로 바뀌었는지 꼭 확인. '추천 브랜드' 칩은 저장이 안 되니 쓰지 마. 목록에 없는 일본 브랜드면 'Japanese Vintage'.",
    "- 색상은 비워 둬. 배송비 3,000원 / 도서산간 6,000원. 수수료 구매자 부담. 네고 OFF.",
    "- 가격 = 설명 글의 Price.",
    "- 성별·카테고리·사이즈·상태 라디오는 좌표 클릭으로 안 먹을 수 있어: .upload-right-column 안의 label을 javascript로 label.click() 해서 고르고, 그 칸은 안에서 따로 스크롤돼.",
    "- 업로드 후 상품 페이지에서 브랜드가 비어 있지 않은지(페이지 데이터의 \"brand\"가 null이 아닌지) 확인하고 그 주소를 url로.",
  ];
}

function instaRules() {
  return [
    "### 인스타 작업 규칙",
    "- https://www.instagram.com 에서 collectroom_ 계정으로 로그인돼 있는지 확인해. 다른 계정이면 그 작업은 멈춰.",
    "- 새 게시물 하나에 사진을 적힌 순서대로 전부 넣어.",
    "- 자르기는 '원본'(3:4). 음악은 넣지 마. 필터·편집은 그대로 넘겨.",
    "- 캡션 = 설명 글 전체를 그대로(줄바꿈 포함).",
    "- 절대 Escape 키를 누르지 마(게시물 삭제 창이 떠).",
    "- 공유한 뒤 게시물 주소를 찾을 수 있으면 url로, 못 찾으면 null.",
  ];
}

// tasks: [{platform:"fruits"|"insta", productName, text, photoPaths}] - 적힌 순서대로 처리
function batchPrompt(tasks) {
  const platforms = new Set(tasks.map((t) => t.platform));
  const lines = [
    "빈티지 의류 샵 'collect room'의 상품을 후루츠패밀리(fruitsfamily.com)와 인스타그램(collectroom_)에 올리는 일이야. 아래 작업을 번호 순서대로 하나씩 해.",
    "",
    "## 공통 규칙",
    ...commonRules(),
    "",
    ...(platforms.has("fruits") ? [...fruitsRules(), ""] : []),
    ...(platforms.has("insta") ? [...instaRules(), ""] : []),
    "## 작업 목록",
  ];
  tasks.forEach((t, k) => {
    lines.push("");
    lines.push(`### 작업 ${k + 1}: ${t.platform === "fruits" ? "후루츠" : "인스타"} · ${t.productName}`);
    lines.push("사진 (순서대로):");
    lines.push(...t.photoPaths);
    lines.push("설명 글:");
    lines.push("<<<");
    lines.push(t.text.trim());
    lines.push(">>>");
  });
  return lines.join("\n");
}

const BATCH_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task: { type: "integer" },
          uploaded: { type: "boolean" },
          url: { type: ["string", "null"] },
          problem: { type: ["string", "null"] },
        },
        required: ["task", "uploaded", "url", "problem"],
      },
    },
  },
  required: ["results"],
};

module.exports = { BATCH_SCHEMA, parsePrice, photoOrder, batchPrompt };
