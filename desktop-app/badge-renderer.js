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

function drawBadge(cx, r, label) {
  ctx.beginPath();
  ctx.arc(cx, HEIGHT / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = "#FF3B30";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#1E1D1B";
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 13px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, HEIGHT / 2 + 1);
}

function render(count) {
  const hasBadge = count > 0;
  const label = count > 99 ? "99+" : String(count);
  const badgeR = label.length > 2 ? 13 : 11;
  const badgeD = badgeR * 2;

  const width = (hasBadge ? badgeD + GAP : 0) + ICON_SIZE + 8;
  canvas.width = width;
  canvas.height = HEIGHT;
  ctx.clearRect(0, 0, width, HEIGHT);

  let iconX = 4;
  if (hasBadge) {
    const badgeCx = badgeR + 2;
    drawBadge(badgeCx, badgeR, label);
    iconX = badgeD + GAP + 2;
  }
  drawIcon(iconX);

  ipcRenderer.send("badge-image", canvas.toDataURL());
}

ipcRenderer.on("draw-badge", (event, count) => render(count));
ipcRenderer.send("badge-ready");
