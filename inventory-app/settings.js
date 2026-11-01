const fs = require("node:fs");

// 관세율/부가세율/국제배송비는 고정값이라 더 이상 설정에 없다(pricing.js 상수).
// 환율만 켄즈포스트에서 자동으로 읽어온 최신값을 캐시해뒀다가, 스크래핑에
// 실패했을 때의 대체값/수동입력 폼 기본값으로 쓴다.
const DEFAULT_SETTINGS = {
  fxRate: 950,
  // 대시보드 재고원가 목표(원). 이만큼은 재고를 들고 있어야 판매가 끊기지 않는다는 기준.
  stockTargetKrw: 6000000,
};

function loadSettings(filePath) {
  if (!fs.existsSync(filePath)) return { ...DEFAULT_SETTINGS };
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
}

function saveSettings(filePath, settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
  return merged;
}

module.exports = { DEFAULT_SETTINGS, loadSettings, saveSettings };
