#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { randomBytes } = require("node:crypto");
const { fork } = require("node:child_process");
const { MAX_BYTES, validate } = require("../viewer/contract");

const HOST = "127.0.0.1";
const IDLE_MS = 30 * 60 * 1000;
const SKILL = path.resolve(__dirname, "..");
const REPORTS = "harvest-advisor-reports";
const ROUND = /^\d{8}T\d{6}Z-[a-f0-9]{16}$/;
const FILE_CSP = "default-src 'none'; script-src file:; style-src file:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const HTTP_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
const assets = {
  "styles.css": "text/css",
  "contract.js": "text/javascript",
  "messages.js": "text/javascript",
  "graph-layout.js": "text/javascript",
  "viewer.js": "text/javascript"
};

const same = (a, b) => path.relative(a, b) === "";
function within(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`));
}

function plain(entry, kind) {
  const stat = fs.lstatSync(entry);
  if (stat.isSymbolicLink() || !same(entry, fs.realpathSync.native(entry)) ||
      (kind === "directory" ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) {
    throw new Error(`Expected a plain ${kind}, not a link or redirect: ${entry}`);
  }
  return stat;
}

function workspaceRoot(input) {
  if (!input || !path.isAbsolute(input) || (process.platform === "win32" && !/^[A-Za-z]:[\\/]/.test(input))) {
    throw new Error("Supply the absolute path of the authorized local workspace.");
  }
  const root = path.resolve(input);
  plain(root, "directory");
  const temp = fs.realpathSync.native(os.tmpdir());
  if (same(root, path.parse(root).root) || within(temp, root)) {
    throw new Error("A drive root or system temporary location is not a report workspace.");
  }
  return root;
}

function checkReport(bytes) {
  if (bytes.length > MAX_BYTES) throw new Error("Report exceeds the viewer size limit.");
  return validate(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes))).report;
}

function saveReport(workspace, bytes) {
  const root = workspaceRoot(workspace);
  const report = checkReport(bytes);
  const approvals = new Set((report.tasks ?? []).filter(task => task.kind === "approval").map(task => task.candidate));
  const missing = (report.candidates ?? []).filter(candidate =>
    (candidate.decision === "adopt" || candidate.decision === "adapt") && !approvals.has(candidate.id));
  if (missing.length) {
    throw new Error(`New report requires an approval task for each adopt or adapt candidate: ${missing.map(candidate => candidate.id).join(", ")}.`);
  }
  const base = path.join(root, REPORTS);
  try { fs.mkdirSync(base, { mode: 0o700 }); } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  plain(base, "directory");
  const stamp = new Date().toISOString().replace(/[:-]|\.\d+/g, "");
  const dir = path.join(base, `${stamp}-${randomBytes(8).toString("hex")}`);
  fs.mkdirSync(dir, { mode: 0o700 });
  plain(dir, "directory");
  const reportPath = path.join(dir, "report.json");
  fs.writeFileSync(reportPath, bytes, { flag: "wx", mode: 0o600 });
  plain(reportPath, "file");
  return reportPath;
}

function readReport(workspace, report) {
  const root = workspaceRoot(workspace);
  if (!report || !path.isAbsolute(report)) throw new Error("Supply the absolute path of a saved report.");
  const reportPath = path.resolve(report);
  const [folder, round, name, ...tail] = path.relative(root, reportPath).split(path.sep);
  if (folder !== REPORTS || !ROUND.test(round ?? "") || name !== "report.json" || tail.length) {
    throw new Error("Report must be in the workspace's harvest-advisor-reports/<round>/report.json.");
  }
  plain(path.join(root, folder), "directory");
  plain(path.join(root, folder, round), "directory");
  const before = plain(reportPath, "file");
  if (before.size > MAX_BYTES) throw new Error("Report exceeds the viewer size limit.");
  const fd = fs.openSync(reportPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const current = fs.fstatSync(fd);
    if (!current.isFile() || current.nlink !== 1 || current.dev !== before.dev || current.ino !== before.ino) {
      throw new Error("Report changed while opening.");
    }
    const bytes = Buffer.alloc(before.size + 1);
    let used = 0, count;
    while (used < bytes.length && (count = fs.readSync(fd, bytes, used, bytes.length - used, null))) used += count;
    if (used !== before.size || fs.fstatSync(fd).mtimeMs !== before.mtimeMs) throw new Error("Report changed while reading.");
    const snapshot = bytes.subarray(0, used);
    checkReport(snapshot);
    return { reportPath, bytes: snapshot };
  } finally { fs.closeSync(fd); }
}

async function startServer(bytes, idleMs = IDLE_MS) {
  checkReport(bytes);
  const root = path.join(fs.realpathSync.native(SKILL), "viewer");
  plain(root, "directory");
  const readAsset = name => {
    const file = path.join(root, name);
    plain(file, "file");
    return fs.readFileSync(file);
  };
  const page = readAsset("index.html").toString("utf8");
  if (!page.includes(FILE_CSP)) throw new Error("Unexpected viewer policy; HTTP preview refused.");
  const token = randomBytes(24).toString("hex");
  const prefix = `/${token}/`;
  const routes = new Map([
    [prefix, ["text/html", Buffer.from(page.replace(FILE_CSP, HTTP_CSP))]],
    [`${prefix}report.json`, ["application/json", bytes]],
    ...Object.entries(assets).map(([name, mime]) => [`${prefix}${name}`, [mime, readAsset(name)]])
  ]);
  let timer;
  const idle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      server.close();
      server.closeAllConnections();
    }, idleMs).unref();
  };
  const server = http.createServer({ headersTimeout: 5000, requestTimeout: 5000, keepAliveTimeout: 1000 }, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (req.headersDistinct.host?.length !== 1 || req.headers.host !== `${HOST}:${server.address().port}`) {
      res.writeHead(421).end();
    } else if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET" }).end();
    } else if (!routes.has(req.url)) {
      res.writeHead(404).end();
    } else {
      const [mime, payload] = routes.get(req.url);
      idle();
      res.writeHead(200, {
        "Content-Type": `${mime}; charset=utf-8`,
        "Content-Length": payload.length,
        "Content-Security-Policy": HTTP_CSP
      }).end(payload);
    }
  });
  server.on("close", () => clearTimeout(timer));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  idle();
  return { server, port: server.address().port, token };
}

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port, path: pathname, signal: AbortSignal.timeout(3000) }, res => {
      const parts = [];
      res.on("data", part => parts.push(part));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    }).on("error", reject);
  });
}

async function openPreview(workspace, report) {
  const { reportPath, bytes } = readReport(workspace, report);
  const child = fork(__filename, ["serve"], {
    cwd: SKILL, detached: true, windowsHide: true, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"]
  });
  try {
    const { port, token } = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Preview did not start in time.")), 6000);
      child.on("exit", () => reject(new Error("Preview worker exited before startup.")));
      child.on("error", reject);
      child.once("message", message => {
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error));
        else resolve(message);
      });
      child.send(bytes.toString("utf8"), error => { if (error) reject(error); });
      child.once("disconnect", () => clearTimeout(timeout));
    });
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{48}$/.test(token)) {
      throw new Error("Invalid preview startup response.");
    }
    const prefix = `/${token}/`;
    const [page, data] = await Promise.all([get(port, prefix), get(port, `${prefix}report.json`)]);
    if (page.status !== 200 || !page.headers["content-type"]?.startsWith("text/html") ||
        !page.body.includes(Buffer.from("Harvest Advisor")) || data.status !== 200 ||
        !data.headers["content-type"]?.startsWith("application/json") || !data.body.equals(bytes)) {
      throw new Error("Preview GET verification failed.");
    }
    const url = `http://${HOST}:${port}${prefix}`;
    return { reportPath, url, reportUrl: `${url}report.json`, pid: child.pid, idleMinutes: IDLE_MS / 60000 };
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    if (child.connected) child.disconnect();
    child.unref();
  }
}

async function main() {
  const [mode, workspace, report, ...extra] = process.argv.slice(2);
  if (mode === "serve" && process.send && !workspace) {
    process.once("message", async text => {
      try {
        const { port, token } = await startServer(Buffer.from(text, "utf8"));
        process.send({ port, token });
      } catch (error) { process.send({ error: error.message }); }
    });
    return;
  }
  if ((mode === "save" || mode === "open") &&
      !same(workspaceRoot(workspace), fs.realpathSync.native(process.cwd()))) {
    throw new Error("Run the helper from the authorized workspace root.");
  }
  if (mode === "save" && workspace && !report) {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new Error("Report exceeds the viewer size limit.");
      chunks.push(chunk);
    }
    console.log(JSON.stringify({ reportPath: saveReport(workspace, Buffer.concat(chunks)) }));
  } else if (mode === "open" && workspace && report && !extra.length) {
    console.log(JSON.stringify(await openPreview(workspace, report)));
  } else throw new Error("Use: preview.cjs save <workspace> (UTF-8 JSON via stdin), or preview.cjs open <workspace> <report.json>.");
}

if (require.main === module) main().catch(error => {
  console.error(`Harvest preview: ${error.message}`);
  process.exitCode = 1;
});
module.exports = { saveReport, readReport, startServer };
