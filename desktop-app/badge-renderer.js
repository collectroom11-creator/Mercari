// 트레이 아이콘 이미지를 직접 그려서 만드는 숨은 렌더러. tray.setTitle()은
// 색을 못 입히는 순수 텍스트라 배지가 잘 안 보였는데, 캔버스로 아이콘+빨간
// 배지를 합성한 이미지를 만들어 tray.setImage()로 바꿔치기하면 진짜 배지
// 처럼 보인다.
const { ipcRenderer } = require("electron");

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

function drawIcon() {
  // 태그(라벨) 모양: 흰색 채우기 + 옅은 테두리로, 메뉴바가 밝든 어둡든 웬만큼 보이게 한다.
  ctx.save();
  ctx.translate(4, 8);
  const s = 2; // 16pt 기준 아이콘을 2배로 그려서 32x32 영역에 배치
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

function drawBadge(count) {
  if (count <= 0) return;
  const label = count > 99 ? "99+" : String(count);
  const r = label.length > 2 ? 12 : 10;
  const cx = 34;
  const cy = 10;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#FF3B30";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#1E1D1B";
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 13px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 1);
}

ipcRenderer.on("draw-badge", (event, count) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawIcon();
  drawBadge(count);
  ipcRenderer.send("badge-image", canvas.toDataURL());
});

ipcRenderer.send("badge-ready");
