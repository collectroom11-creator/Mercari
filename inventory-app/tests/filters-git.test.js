const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { readRemoteFilters, saveFilters } = require("../filters-git");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "filters-git-"));
  const remote = path.join(root, "remote.git");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  const a = path.join(root, "a");
  git(root, "clone", "-q", remote, a);
  git(a, "config", "user.email", "t@t");
  git(a, "config", "user.name", "t");
  fs.writeFileSync(path.join(a, "filters.json"), JSON.stringify({ brands: [], excludeKeywords: ["x"], brandExcludeKeywords: {} }));
  fs.writeFileSync(path.join(a, "other.txt"), "v1");
  git(a, "add", ".");
  git(a, "commit", "-q", "-m", "init");
  git(a, "push", "-q", "origin", "main");
  const b = path.join(root, "b");
  git(root, "clone", "-q", remote, b);
  git(b, "config", "user.email", "t@t");
  git(b, "config", "user.name", "t");
  return { remote, a, b };
}

test("readRemoteFilters: 원격 main의 최신 filters.json을 읽는다", () => {
  const { a, b } = setup();
  fs.writeFileSync(path.join(a, "filters.json"), JSON.stringify({ brands: [], excludeKeywords: ["y"], brandExcludeKeywords: {} }));
  git(a, "commit", "-q", "-am", "remote change");
  git(a, "push", "-q", "origin", "main");
  assert.deepEqual(readRemoteFilters(b).excludeKeywords, ["y"]);
});

test("saveFilters: 원격이 앞서도 성공, 커밋에는 filters.json만, 다른 미커밋 변경은 그대로", () => {
  const { remote, a, b } = setup();
  fs.writeFileSync(path.join(a, "seen.json"), "[1]");
  git(a, "add", "seen.json");
  git(a, "commit", "-q", "-m", "bot");
  git(a, "push", "-q", "origin", "main");
  fs.writeFileSync(path.join(b, "other.txt"), "local edit");

  const r = saveFilters(b, { brands: [{ name: "Hugo Boss", priceMax: 30000 }], excludeKeywords: [], brandExcludeKeywords: {} });
  assert.equal(r.ok, true);
  const files = git(remote, "show", "--name-only", "--format=", "main");
  assert.equal(files, "filters.json");
  assert.equal(git(remote, "log", "-1", "--format=%s", "main"), "Update Mercari filters (app)");
  assert.equal(fs.readFileSync(path.join(b, "other.txt"), "utf-8"), "local edit");
  assert.equal(JSON.parse(git(remote, "show", "main:filters.json")).brands[0].name, "Hugo Boss");
});

test("saveFilters: 바뀐 게 없으면 커밋하지 않고 ok + unchanged", () => {
  const { remote, b } = setup();
  const before = git(remote, "rev-parse", "main");
  const r = saveFilters(b, { brands: [], excludeKeywords: ["x"], brandExcludeKeywords: {} });
  assert.deepEqual(r, { ok: true, unchanged: true });
  assert.equal(git(remote, "rev-parse", "main"), before);
});
