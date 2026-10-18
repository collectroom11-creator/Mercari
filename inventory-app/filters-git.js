// filters.json을 GitHub(원격 main)에서 읽고 저장한다. 알림 봇이 1분마다 main에
// 커밋하므로 push는 항상 rebase 후 재시도한다. 저장소에는 사용자의 커밋 안 된 다른
// 작업이 있을 수 있어서 filters.json 한 파일만 add하고, rebase는 --autostash로 한다.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const FILE = "filters.json";
const COMMIT_MESSAGE = "Update Mercari filters (app)";
const PUSH_ATTEMPTS = 4;

function git(repoDir, ...args) {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function readRemoteFilters(repoDir) {
  git(repoDir, "fetch", "-q", "origin", "main");
  return JSON.parse(git(repoDir, "show", `origin/main:${FILE}`));
}

function saveFilters(repoDir, filters) {
  try {
    // 다른 브랜치(작업용 worktree 등)에서 rebase+push하면 그 브랜치 커밋이 통째로 main에 올라간다.
    const branch = git(repoDir, "rev-parse", "--abbrev-ref", "HEAD");
    if (branch !== "main") return { ok: false, error: `main 브랜치에서만 저장할 수 있어요(현재: ${branch})` };
    git(repoDir, "pull", "-q", "--rebase", "--autostash", "origin", "main");
    const filePath = path.join(repoDir, FILE);
    const current = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (JSON.stringify(current) === JSON.stringify(filters)) return { ok: true, unchanged: true };
    fs.writeFileSync(filePath, JSON.stringify(filters, null, 2) + "\n");
    git(repoDir, "add", "--", FILE);
    git(repoDir, "commit", "-q", "-m", COMMIT_MESSAGE, "--", FILE);
    let lastError = null;
    for (let i = 0; i < PUSH_ATTEMPTS; i++) {
      try {
        git(repoDir, "push", "-q", "origin", "HEAD:main");
        return { ok: true, commit: git(repoDir, "rev-parse", "--short", "HEAD") };
      } catch (e) {
        lastError = e;
        git(repoDir, "pull", "-q", "--rebase", "--autostash", "origin", "main");
      }
    }
    return { ok: false, error: `push 실패: ${lastError.stderr || lastError.message}` };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message) };
  }
}

module.exports = { readRemoteFilters, saveFilters };
