"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { spawnSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");
const { saveReport, readReport, startServer } = require("./preview.cjs");

const root = fs.realpathSync.native(path.resolve(__dirname, ".."));
const helper = path.join(__dirname, "preview.cjs");
const reportA = fs.readFileSync(path.join(root, "viewer/examples/markdown-cli.zh-Hans.json"));
const reportB = fs.readFileSync(path.join(root, "viewer/examples/reservations.json"));
const base = "harvest-advisor-reports";

function scratch(t) {
  const prefix = ".harvest-preview-test-";
  const dir = fs.mkdtempSync(path.join(root, prefix));
  t.after(() => {
    if (path.dirname(dir) !== root || !path.basename(dir).startsWith(prefix) ||
        fs.realpathSync.native(dir) !== dir || fs.lstatSync(dir).isSymbolicLink()) {
      throw new Error("Refusing to clean a path outside the test workspace");
    }
    fs.rmSync(dir, { recursive: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}

function run(cwd, args, input, script = helper) {
  return spawnSync(process.execPath, [script, ...args], { cwd, input, encoding: "utf8", timeout: 12000, windowsHide: true });
}

function request(url, changes = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname,
      signal: AbortSignal.timeout(2000), ...changes }, res => {
      const chunks = [];
      res.on("data", data => chunks.push(data));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

test("two validated saves create distinct rounds and retain exact independent bytes", t => {
  const dir = scratch(t);
  const bad = run(dir, ["save", dir], Buffer.from("{"));
  assert.equal(bad.status, 1);
  assert.equal(fs.existsSync(path.join(dir, base)), false);
  assert.throws(() => saveReport(os.tmpdir(), reportA), /system temporary/);
  const good = run(dir, ["save", dir], reportA);
  assert.equal(good.status, 0, good.stderr);
  const { reportPath: first } = JSON.parse(good.stdout);
  const second = saveReport(dir, reportB);
  assert.notEqual(first, second);
  assert.equal(path.dirname(path.dirname(first)), path.join(dir, base));
  assert.deepEqual(fs.readdirSync(path.dirname(first)), ["report.json"]);
  assert.deepEqual(fs.readdirSync(path.dirname(second)), ["report.json"]);
  assert.deepEqual(readReport(dir, first).bytes, reportA);
  assert.deepEqual(readReport(dir, second).bytes, reportB);
  const other = run(root, ["open", dir, first]);
  assert.match(other.stderr, /authorized workspace root/);
});

test("new saves require their own approval tasks for every adopt or adapt decision", t => {
  const dir = scratch(t);
  const report = JSON.parse(reportA.toString("utf8"));
  report.candidates.push({ ...report.candidates[0], id: "H-adopt", decision: "adopt" });
  const encode = value => Buffer.from(JSON.stringify(value));
  let result = run(dir, ["save", dir], encode(report));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /approval task.*H-adopt/);
  assert.equal(fs.existsSync(path.join(dir, base)), false);

  report.tasks = [{ ...report.tasks[0], candidate: "H-adopt" }];
  assert.throws(() => saveReport(dir, encode(report)), /approval task.*H-01/);
  assert.equal(fs.existsSync(path.join(dir, base)), false);
  report.tasks.push({ ...report.tasks[0], id: "T-adapt", candidate: "H-01" });
  const complete = encode(report);
  result = run(dir, ["save", dir], complete);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(JSON.parse(result.stdout).reportPath), complete);

  const watch = JSON.parse(reportB.toString("utf8"));
  delete watch.tasks;
  assert.throws(() => saveReport(dir, encode(watch)), /recheck/);
  watch.candidates[0] = { ...report.candidates[0], id: "H-reject", decision: "reject", targets: ["M-scope"],
    evidence: { own: ["M-E01"], reference: ["M-E04"] } };
  assert.doesNotThrow(() => saveReport(dir, encode(watch)));
});

test("pre-existing symlink or junction folders and file redirects cannot escape the report boundary", t => {
  const dir = scratch(t);
  const linkedRoot = path.join(dir, "linked");
  const outside = path.join(dir, "outside");
  fs.mkdirSync(linkedRoot);
  fs.mkdirSync(outside);
  const linkKind = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(outside, path.join(linkedRoot, base), linkKind);
  assert.throws(() => saveReport(linkedRoot, reportA), /plain directory/);
  assert.deepEqual(fs.readdirSync(outside), []);
  const good = saveReport(dir, reportA);
  const redirected = path.join(dir, base, "20261125T010203Z-0000000000000000");
  fs.symlinkSync(path.dirname(good), redirected, linkKind);
  assert.throws(() => readReport(dir, path.join(redirected, "report.json")), /plain directory/);
  const otherFile = path.join(outside, "private.json");
  fs.writeFileSync(otherFile, reportA);
  const hardlinkDir = path.join(dir, base, "20261125T010203Z-1111111111111111");
  fs.mkdirSync(hardlinkDir);
  const hardlink = path.join(hardlinkDir, "report.json");
  fs.linkSync(otherFile, hardlink);
  assert.throws(() => readReport(dir, hardlink), /plain file/);
  assert.throws(() => readReport(dir, otherFile), /workspace's harvest-advisor-reports/);
});

test("detached GET preview does not expose other files, rejects Host and traversal, and can reopen", async t => {
  const dir = scratch(t);
  const file = saveReport(dir, reportA);
  const alternate = saveReport(dir, reportB);
  fs.writeFileSync(path.join(dir, "private.txt"), "private");
  const children = new Set();
  const stop = (pid) => {
    if (!children.delete(pid)) return;
    try { process.kill(pid); } catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  t.after(() => { for (const pid of children) stop(pid); });
  function open(reportPath) {
    const result = run(dir, ["open", dir, reportPath]);
    assert.equal(result.status, 0, result.stderr);
    const info = JSON.parse(result.stdout);
    children.add(info.pid);
    return info;
  }
  const bad = run(dir, ["open", dir, path.join(dir, "private.txt")]);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  const old = open(file);
  const concurrent = open(alternate);
  assert.notEqual(new URL(old.url).port, new URL(concurrent.url).port);
  assert.equal(new URL(old.url).hostname, "127.0.0.1");
  const { pathname } = new URL(old.url);
  assert.match(pathname, /^\/[a-f0-9]{48}\/$/);
  const body = await request(old.reportUrl);
  assert.equal(body.status, 200);
  assert.deepEqual(body.body, reportA);
  assert.equal(body.headers["cache-control"], "no-store");
  assert.equal(body.headers["access-control-allow-origin"], undefined);
  assert.deepEqual((await request(concurrent.reportUrl)).body, reportB);
  const page = await request(old.url);
  assert.match(page.body.toString(), /connect-src 'self'/);
  assert.match(page.headers["content-security-policy"], /connect-src 'self'/);
  assert.equal((await request(old.reportUrl, { headers: { Host: "localhost" } })).status, 421);
  assert.equal((await request(old.reportUrl, { method: "POST" })).status, 405);
  for (const denied of ["/", `${pathname}../private.txt`, `${pathname}%2e%2e/private.txt`,
    `${pathname}private.txt`, `${pathname}examples/markdown-cli.json`, `${pathname}preview.cjs`,
    `${pathname}report.json?x=1`, new URL(concurrent.reportUrl).pathname]) {
    assert.equal((await request(old.url, { path: denied })).status, 404, denied);
  }
  stop(old.pid);
  // The new token is a clean boundary even if the OS later reuses a port.
  const reopened = open(file);
  assert.notEqual(reopened.url, old.url);
  assert.equal(reopened.reportPath, file);
  assert.equal(fs.readdirSync(path.join(dir, base)).length, 2);
  assert.deepEqual((await request(reopened.reportUrl)).body, reportA);
  const broken = saveReport(dir, reportB);
  fs.writeFileSync(broken, "{broken");
  const invalid = run(dir, ["open", dir, broken]);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, "");
  const legacy = JSON.parse(reportA.toString("utf8"));
  delete legacy.tasks;
  const legacyBytes = Buffer.from(JSON.stringify(legacy));
  fs.writeFileSync(broken, legacyBytes);
  assert.deepEqual(readReport(dir, broken).bytes, legacyBytes);
  assert.deepEqual((await request(open(broken).reportUrl)).body, legacyBytes);
});

test("save and detached preview work from a real nested skill in an ESM workspace", async t => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}\n');
  const skill = path.join(dir, ".claude", "skills", "harvest-advisor-skill");
  for (const file of ["package.json", "scripts/preview.cjs", "viewer/index.html", "viewer/styles.css",
    "viewer/contract.js", "viewer/messages.js", "viewer/graph-layout.js", "viewer/viewer.js"]) {
    const target = path.join(skill, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  const script = path.join(skill, "scripts", "preview.cjs");
  const saved = run(dir, ["save", dir], reportA, script);
  assert.equal(saved.status, 0, saved.stderr);
  const { reportPath } = JSON.parse(saved.stdout);
  assert.ok(reportPath.startsWith(path.join(dir, base) + path.sep));
  const opened = run(dir, ["open", dir, reportPath], undefined, script);
  assert.equal(opened.status, 0, opened.stderr);
  const info = JSON.parse(opened.stdout);
  try {
    assert.equal((await request(info.url)).status, 200);
    assert.deepEqual((await request(info.reportUrl)).body, reportA);
    assert.equal((await request(new URL("contract.js", info.url))).status, 200);
  } finally {
    process.kill(info.pid);
    // Windows keeps the copied Skill directory locked while its detached worker exits.
    for (let i = 0; i < 50; i++) {
      try { process.kill(info.pid, 0); } catch (error) { if (error.code === "ESRCH") break; throw error; }
      await delay(20);
    }
  }
});

test("loopback listener closes after its idle window without deleting the report", async t => {
  const dir = scratch(t);
  const reportPath = saveReport(dir, reportA);
  const { server, port, token } = await startServer(readReport(dir, reportPath).bytes, 300);
  assert.deepEqual(server.address(), { address: "127.0.0.1", family: "IPv4", port });
  const closed = once(server, "close");
  assert.equal((await request(`http://127.0.0.1:${port}/${token}/report.json`)).status, 200);
  await closed;
  assert.equal(server.listening, false);
  assert.deepEqual(fs.readFileSync(reportPath), reportA);
});
