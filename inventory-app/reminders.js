const { execFileSync } = require("node:child_process");

// 0시엔 맥이 잠자기 중이라 미리 알림 앱이 늦게 떠서 AppleEvent 시간 초과(-1712)가
// 났었다. 앱을 먼저 백그라운드로 띄우고, 넉넉한 timeout으로 몇 번 재시도한다.
function osa(script) {
  try {
    execFileSync("open", ["-gj", "-a", "Reminders"]);
  } catch (e) {
    // 띄우기 실패해도 osascript가 직접 실행을 시도하니 무시
  }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return execFileSync("osascript", ["-e", `with timeout of 300 seconds\n${script}\nend timeout`], {
        encoding: "utf-8",
      }).trim();
    } catch (e) {
      lastErr = e;
      execFileSync("sleep", ["10"]);
    }
  }
  throw lastErr;
}

// 상품명에 " 나 \ 가 들어있으면 AppleScript 문자열이 깨지니 이스케이프한다.
function asString(text) {
  return `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function addReminder(list, { name, body, dueToday = false }) {
  const props = [`name:${asString(name)}`, `body:${asString(body)}`];
  if (dueToday) props.push("allday due date:(current date)");
  return osa(
    `tell application "Reminders" to get id of (make new reminder at end of list ${asString(list)} with properties {${props.join(", ")}})`
  );
}

function completeReminder(id, completed = true) {
  osa(`tell application "Reminders" to set completed of (reminder id ${asString(id)}) to ${completed}`);
}

module.exports = { osa, addReminder, completeReminder };
