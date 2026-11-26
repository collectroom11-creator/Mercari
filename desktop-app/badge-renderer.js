// 트레이 아이콘 이미지를 직접 그려서 만드는 숨은 렌더러. tray.setTitle()은
// 색을 못 입히는 순수 텍스트라 배지가 잘 안 보였는데, 캔버스로 아이콘+빨간
// 배지를 합성한 이미지를 만들어 tray.setImage()로 바꿔치기하면 진짜 배지
// 처럼 보인다. 배지는 아이콘 왼쪽에 그리고, 배지가 잘리지 않도록 캔버스
// 너비 자체를 숫자 자릿수에 맞춰 동적으로 늘린다(고정 너비였다가 배지가
// 오른쪽 밖으로 잘려 나갔었다).
const { ipcRenderer } = require("electron");

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const ICON_SIZE = 32; // 16pt 아이콘을 2배로 그린 크기
const HEIGHT = 44; // 메뉴바 @2x 기준 높이
const GAP = 4;
const BADGE_FONT = "bold 13px -apple-system, sans-serif";

function drawIcon(x) {
  // 태그(라벨) 모양: 흰색 채우기 + 옅은 테두리로, 메뉴바가 밝든 어둡든 웬만큼 보이게 한다.
  ctx.save();
  ctx.translate(x, (HEIGHT - ICON_SIZE) / 2);
  const s = ICON_SIZE / 16;
  ctx.beginPath();
  ctx.roundRect(2 * s, 3 * s, 12 * s, 10 * s, 2 * s);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.stroke();

  // 태그 구멍
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(10.5 * s, 6 * s, 1.4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}

// 배지 폭은 숫자 길이에 맞춰 늘어난다(1~2자리는 원, 3자리 이상은 알약 모양).
function drawBadge(x, w, r, label) {
  ctx.beginPath();
  ctx.roundRect(x, HEIGHT / 2 - r, w, r * 2, r);
  ctx.fillStyle = "#FF3B30";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#1E1D1B";
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = BADGE_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, HEIGHT / 2 + 1);
}

function render(count) {
  const hasBadge = count > 0;
  // 99+로 자르지 않고 실제 개수를 그대로 보여준다.
  const label = String(count);
  const badgeR = 11;
  ctx.font = BADGE_FONT;
  const badgeW = Math.max(badgeR * 2, Math.ceil(ctx.measureText(label).width) + 12);

  const width = (hasBadge ? badgeW + GAP : 0) + ICON_SIZE + 8;
  canvas.width = width;
  canvas.height = HEIGHT;
  ctx.clearRect(0, 0, width, HEIGHT);

  let iconX = 4;
  if (hasBadge) {
    drawBadge(2, badgeW, badgeR, label);
    iconX = badgeW + GAP + 2;
  }
  drawIcon(iconX);

  ipcRenderer.send("badge-image", canvas.toDataURL());
}

ipcRenderer.on("draw-badge", (event, count) => render(count));
ipcRenderer.send("badge-ready");
