// 매일 매입 할당량을 미리 알림(콜렉트룸 목록)에 올리고, 달성하면 완료 처리하는 스크립트.
//   node daily-quota.js create  - 오늘 할당량 계산 후 미리 알림 추가 (launchd가 매일 0시에 실행)
//   node daily-quota.js check   - 오늘 매입액이 할당량 이상이면 오늘 미리 알림을 완료 처리
//
// 할당량 = (월말 재고원가 목표 - 오늘 0시 기준 재고원가) / 오늘 포함 이번달 남은 일수.
// 재고원가 계산은 앱 대시보드의 "현재 재고"와 같다(개인구매/판매완료 제외 원가 합).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadItems } = require("./store");
const { addReminder, completeReminder } = require("./reminders");

const DATA_DIR = path.join(os.homedir(), "Library/Application Support/inventory-app");
const DB_FILE = path.join(DATA_DIR, "inventory.json");
const GOAL_FILE = path.join(DATA_DIR, "purchase-goal.json");
const REMINDER_LIST = "콜렉트룸";

function loadGoal() {
  if (!fs.existsSync(GOAL_FILE)) return { stockTargetKrw: 5000000, days: {} };
  return JSON.parse(fs.readFileSync(GOAL_FILE, "utf-8"));
}

function saveGoal(goal) {
  fs.writeFileSync(GOAL_FILE, JSON.stringify(goal, null, 2));
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function summarize(now = new Date()) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const items = loadItems(DB_FILE).filter((i) => i.status !== "개인구매");
  const stock = items.filter((i) => i.status !== "판매완료").reduce((s, i) => s + i.costKrw, 0);
  const todayBuy = items
    .filter((i) => new Date(i.createdAt) >= dayStart)
    .reduce((s, i) => s + i.costKrw, 0);
  return { dayStart, stock, todayBuy };
}

function fmt(n) {
  return n.toLocaleString("ko-KR");
}

function create() {
  const now = new Date();
  const goal = loadGoal();
  const key = dayKey(now);
  if (goal.days[key]?.reminderId) {
    console.log(`이미 오늘(${key}) 미리 알림이 있어요.`);
    return;
  }
  const { stock, todayBuy } = summarize(now);
  const startStock = stock - todayBuy; // 0시 직후 실행이면 todayBuy는 보통 0
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = lastDay - now.getDate() + 1;
  const gap = Math.max(0, goal.stockTargetKrw - startStock);
  const quota = Math.ceil(gap / daysLeft);

  const title = `매일 할당량 ${fmt(quota)}원 매입`;
  const body = `재고원가 ${fmt(startStock)}원 / 목표 ${fmt(goal.stockTargetKrw)}원 (남은 ${fmt(gap)}원, ${daysLeft}일)`;
  const id = addReminder(REMINDER_LIST, { name: title, body, dueToday: true });
  goal.days[key] = { quota, startStock, reminderId: id, completed: false };
  saveGoal(goal);
  console.log(`추가함: ${title}`);
  if (quota === 0) check();
}

function check() {
  const now = new Date();
  const goal = loadGoal();
  const key = dayKey(now);
  const day = goal.days[key];
  const { stock, todayBuy } = summarize(now);
  const monthPct = ((stock / goal.stockTargetKrw) * 100).toFixed(1);
  if (!day) {
    console.log(`오늘 할당량 기록이 없어요. 이번달 ${monthPct}% (재고원가 ${fmt(stock)}원)`);
    return;
  }
  const dayPct = day.quota > 0 ? ((todayBuy / day.quota) * 100).toFixed(1) : "100.0";
  console.log(
    `오늘 ${fmt(todayBuy)}원 / ${fmt(day.quota)}원 (${dayPct}%), 이번달 ${fmt(stock)}원 / ${fmt(goal.stockTargetKrw)}원 (${monthPct}%)`
  );
  // 내일 0시에 create가 계산할 할당량과 같은 식 - 오늘 더 사면 내일 할당량이 줄어든다.
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysAfterToday = lastDay - now.getDate();
  if (daysAfterToday > 0) {
    const gap = Math.max(0, goal.stockTargetKrw - stock);
    console.log(
      `내일부터 하루 ${fmt(Math.ceil(gap / daysAfterToday))}원 (남은 ${fmt(gap)}원 / ${daysAfterToday}일)`
    );
  }
  if (todayBuy >= day.quota && !day.completed) {
    completeReminder(day.reminderId);
    day.completed = true;
    saveGoal(goal);
    console.log("오늘 할당량 달성 - 미리 알림 완료 처리함");
  } else if (todayBuy < day.quota && day.completed) {
    // 매입 취소/환불로 재고에서 지워져 다시 할당량 아래로 내려간 경우 - 완료를 되돌린다.
    completeReminder(day.reminderId, false);
    day.completed = false;
    saveGoal(goal);
    console.log("오늘 매입이 할당량 아래로 내려감 - 미리 알림 완료 취소함");
  }
}

const cmd = process.argv[2];
if (cmd === "create") create();
else if (cmd === "check") check();
else console.log("usage: node daily-quota.js create|check");
