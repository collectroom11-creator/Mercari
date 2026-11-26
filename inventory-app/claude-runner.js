// 앱이 Claude(터미널용 claude CLI)를 불러서 일을 시키는 곳.
// 맥 앱으로 켜면 PATH에 ~/.local/bin이 없어서 claude 위치를 직접 찾는다.
// 사용자 설정/플러그인/훅은 끄고(--setting-sources ""), 쓸 수 있는 도구도 Read만 준다.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function findClaude() {
  const candidates = [
    path.join(os.homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(os.homedir(), ".claude/local/claude"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// 1년짜리 토큰(claude setup-token으로 만든 것)을 이 파일에 저장해두면 그걸로 로그인한다.
// 일반 로그인은 가끔 풀려서, 앱이 혼자 Claude를 부를 때 끊기지 않게 하려는 것.
const TOKEN_FILE = path.join(os.homedir(), "Library/Application Support/inventory-app/claude-token");

function readToken() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
    return t || null;
  } catch (e) {
    return null;
  }
}

// chrome: true면 사용자의 크롬(Claude in Chrome)을 쓸 수 있게 한다. 크롬 연결은 1년짜리 토큰
// (추론 권한만 있음)으로는 꺼지기 때문에, 이때는 토큰 대신 터미널 로그인(claude auth login)을 쓴다.
function runClaude({ prompt, cwd, schema, model = "sonnet", timeoutMs = 10 * 60 * 1000, chrome = false }) {
  const bin = findClaude();
  if (!bin) return Promise.reject(new Error("claude 프로그램을 찾을 수 없어요."));
  const args = [
    "-p",
    prompt,
    "--model",
    model,
    "--tools",
    "Read",
    "--allowedTools",
    "Read",
    ...(chrome ? ["mcp__claude-in-chrome", "--chrome"] : []),
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--output-format",
    "json",
  ];
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: `${path.dirname(bin)}:${process.env.PATH || "/usr/bin:/bin"}` };
    const token = chrome ? null : readToken();
    if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
    const child = spawn(bin, args, { cwd, env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      let res;
      try {
        res = JSON.parse(out);
      } catch (e) {
        return reject(new Error(`Claude 응답을 읽지 못했어요. ${err.slice(0, 200)}`));
      }
      if (res.is_error) {
        const msg = String(res.result || "");
        if (/authenticat|log ?in|OAuth/i.test(msg)) {
          return reject(new Error(token ? "저장된 Claude 토큰이 만료됐어요. claude setup-token으로 새로 만들어주세요." : "터미널 Claude 로그인이 필요해요: 터미널에서 claude auth login"));
        }
        return reject(new Error(`Claude 오류: ${msg.slice(0, 200)}`));
      }
      resolve({ output: res.structured_output ?? parseJsonLoose(res.result), costUsd: res.total_cost_usd });
    });
  });
}

// --json-schema 결과가 structured_output에 없을 때를 대비해 글에서 JSON만 뽑는다.
function parseJsonLoose(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Claude 응답에 결과(JSON)가 없어요.");
  return JSON.parse(s.slice(start, end + 1));
}

module.exports = { findClaude, runClaude, parseJsonLoose, TOKEN_FILE };
