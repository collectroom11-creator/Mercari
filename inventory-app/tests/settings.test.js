const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { DEFAULT_SETTINGS, loadSettings, saveSettings } = require("../settings");

function tempFile() {
  return path.join(os.tmpdir(), `inv-settings-test-${Date.now()}-${Math.random()}.json`);
}

test("loadSettings: 파일이 없으면 기본값을 준다", () => {
  const file = tempFile();
  assert.deepEqual(loadSettings(file), DEFAULT_SETTINGS);
});

test("saveSettings: 저장한 환율을 loadSettings가 그대로 읽는다", () => {
  const file = tempFile();
  saveSettings(file, { fxRate: 901 });
  const loaded = loadSettings(file);
  assert.equal(loaded.fxRate, 901);
});
