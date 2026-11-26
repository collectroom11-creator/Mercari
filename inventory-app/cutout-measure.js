// 누끼(투명 PNG)의 실제 픽셀로 옷을 잰다.
// 크기는 "눈으로 봤을 때 비슷한 크기"가 목표라(사용자 요청) 바깥 테두리가 아니라 옷이 차지하는
// 면적으로 맞춘다 - 팔을 벌리거나 끈이 늘어져도 면적은 거의 그대로라 보이는 크기가 고르게 나온다.
// 기준 면적은 사용자가 이미 올린 앞·뒤 사진 54장(3:4 캔버스 대비 옷 면적)의 종류별 가운데값.
const TARGET_AREA = { jacket: 0.3, hooded: 0.25, coat: 0.33, pants: 0.28, shoes: 0.24 };
// 후루츠는 3:4 사진의 가운데 정사각형(세로 0.125~0.875)만 보여주니 그 안에 들어가게만 제한한다.
const MAX_W = 0.92;
const MAX_H = 0.74;

// 아래는 위치(가운데 맞추기)와 잘림 제한에 쓰는 범위 측정. 사용자 기준(지난 작업):
//  - 끈·스트링·신발끈처럼 몸통보다 훨씬 가늘게 삐져나온 부분은 크기 계산에서 뺀다.
//  - 후드는 대부분 무시: 어깨선~밑단(몸통)이 높이 0.60 안에, 가로 0.64 안에 들어가고,
//    후드까지 포함한 전체도 0.74를 넘지 않게(후루츠는 3:4 사진의 가운데 정사각형만 보여준다).

const THIN_ROW = 0.15; // 가장 넓은 줄 대비 이보다 가는 줄이 위아래 끝에 이어지면 끈으로 본다
const THIN_COL = 0.1; // 가장 높은 세로줄 대비 이보다 낮은 세로줄이 좌우 끝에 이어지면 뺀다
const SHOULDER = 0.7; // 위에서부터 처음으로 가장 넓은 줄의 70%를 넘는 줄 = 어깨선

// alpha: 길이 w*h 배열(0~255). 결과는 0~1 비율(이미지 크기 기준).
function analyzeAlpha(alpha, w, h, threshold = 128) {
  let count = 0;
  const rowW = new Array(h).fill(0);
  const colH = new Array(w).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > threshold) {
        count++;
        rowW[y]++;
        colH[x]++;
      }
    }
  }
  const maxW = Math.max(...rowW);
  const maxH = Math.max(...colH);
  if (!maxW) return null;
  let y0 = rowW.findIndex((v) => v > 0);
  let y1 = h - 1 - [...rowW].reverse().findIndex((v) => v > 0);
  let x0 = colH.findIndex((v) => v > 0);
  let x1 = w - 1 - [...colH].reverse().findIndex((v) => v > 0);
  const full = { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
  while (y1 > y0 && rowW[y1] < maxW * THIN_ROW) y1--;
  while (y0 < y1 && rowW[y0] < maxW * THIN_ROW) y0++;
  while (x1 > x0 && colH[x1] < maxH * THIN_COL) x1--;
  while (x0 < x1 && colH[x0] < maxH * THIN_COL) x0++;
  let shoulder = y0;
  while (shoulder < y1 && rowW[shoulder] < maxW * SHOULDER) shoulder++;
  return {
    full,
    x0: x0 / w,
    y0: y0 / h,
    x1: (x1 + 1) / w,
    y1: (y1 + 1) / h,
    shoulder: shoulder / h,
    area: count / (w * h),
  };
}

// 캔버스 W×H(px)에서 잰 범위 r(비율)을 몇 배로 키울지. fit = [가로 비율, 세로 비율].
function fitScale(kind, r, W, H, fit) {
  const rw = (r.x1 - r.x0) * W;
  const rh = (r.y1 - r.y0) * H;
  if (kind === "hooded") {
    const body = (r.y1 - r.shoulder) * H;
    return Math.min((fit[0] * W) / rw, (fit[1] * H) / Math.max(body, 1), (0.74 * H) / rh);
  }
  return Math.min((fit[0] * W) / rw, (fit[1] * H) / rh);
}

// 면적 기준 배율: 옷 면적이 종류별 기준 면적이 되게 키우고/줄이되, 끈 뺀 범위가 후루츠 정사각형
// 밖으로 나가지 않게 제한한다. r은 analyzeAlpha 결과(캔버스와 같은 비율의 이미지 기준).
function areaScale(kind, r) {
  const target = TARGET_AREA[kind] || TARGET_AREA.jacket;
  const s = Math.sqrt(target / r.area);
  return Math.min(s, MAX_W / (r.x1 - r.x0), MAX_H / (r.y1 - r.y0));
}

module.exports = { analyzeAlpha, fitScale, areaScale, TARGET_AREA };
