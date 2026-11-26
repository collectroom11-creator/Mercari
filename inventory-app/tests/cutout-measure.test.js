const test = require("node:test");
const assert = require("node:assert");
const cm = require("../cutout-measure");

// w×h 그림에 사각형들을 칠한다
function canvas(w, h, rects) {
  const a = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = 255;
  return a;
}

test("analyzeAlpha ignores thin cords hanging below the body", () => {
  // 몸통 20~80 x 20~70, 끈 두 가닥(폭 2) 70~90까지
  const a = canvas(100, 100, [[20, 20, 80, 70], [40, 70, 42, 90], [58, 70, 60, 90]]);
  const r = cm.analyzeAlpha(a, 100, 100);
  assert.strictEqual(r.full.y1, 0.9);
  assert.strictEqual(r.y1, 0.7);
  assert.strictEqual(r.x0, 0.2);
  assert.strictEqual(r.x1, 0.8);
});

test("analyzeAlpha finds the shoulder line below a hood", () => {
  // 후드(폭 24) 10~30, 몸통(폭 60) 30~80
  const a = canvas(100, 100, [[38, 10, 62, 30], [20, 30, 80, 80]]);
  const r = cm.analyzeAlpha(a, 100, 100);
  assert.strictEqual(r.y0, 0.1);
  assert.strictEqual(r.shoulder, 0.3);
});

test("fitScale for hooded uses the body, capped by the whole height", () => {
  const r = { x0: 0.2, x1: 0.8, y0: 0.1, y1: 0.8, shoulder: 0.3 };
  // 가로 0.64/0.6, 몸통 0.60/0.5, 전체 0.74/0.7 중 가장 작은 값
  assert.ok(Math.abs(cm.fitScale("hooded", r, 100, 100, [0.64, 0.6]) - Math.min(0.64 / 0.6, 0.6 / 0.5, 0.74 / 0.7)) < 1e-9);
  assert.ok(Math.abs(cm.fitScale("jacket", r, 100, 100, [0.72, 0.55]) - Math.min(0.72 / 0.6, 0.55 / 0.7)) < 1e-9);
});

test("areaScale matches the target area regardless of arm spread, capped by the frame", () => {
  // 팔을 벌린 옷과 접은 옷: 면적이 같으면 배율도 같다
  const spread = cm.analyzeAlpha(canvas(100, 100, [[35, 35, 65, 65], [25, 35, 35, 40], [65, 35, 75, 40]]), 100, 100);
  const folded = cm.analyzeAlpha(canvas(100, 100, [[35, 35, 65, 65], [40, 65, 60, 70]]), 100, 100);
  assert.strictEqual(spread.area, folded.area);
  assert.ok(Math.abs(cm.areaScale("jacket", spread) - Math.sqrt(0.3 / spread.area)) < 1e-9);
  assert.ok(Math.abs(cm.areaScale("jacket", folded) - Math.sqrt(0.3 / folded.area)) < 1e-9);
  // 아주 긴 옷은 세로 0.74 안으로 제한
  const tall = cm.analyzeAlpha(canvas(100, 100, [[45, 5, 55, 95]]), 100, 100);
  assert.ok(Math.abs(cm.areaScale("coat", tall) - 0.74 / 0.9) < 1e-9);
});
