const assert = require("node:assert/strict");
const { test } = require("node:test");
const { VERSION, validate, locator } = require("./contract.js");
const cli = require("./examples/markdown-cli.json");
const reservations = require("./examples/reservations.json");

function changed(source, mutate) {
  const data = structuredClone(source);
  mutate(data);
  return data;
}

test("both independent reports import; same labels keep separate identities", () => {
  const { records } = validate(cli);
  assert.equal(cli.schemaVersion, VERSION);
  assert.equal(records.get("N-own-args").object.label, records.get("N-ref-args").object.label);
  assert.notEqual(records.get("N-own-args").object.repo, records.get("N-ref-args").object.repo);
  assert.equal(locator(records.get("E-01").object), "marginlint@demo-cli-01:src/cli.ts:12-29");
  assert.equal(locator(records.get("E-02").object), "marginlint@demo-cli-01:src/check.ts:runRules");
  assert.doesNotThrow(() => validate(reservations));
});

test("v1 accepts optional language tags without changing report contents", () => {
  assert.equal(validate(reservations).reportLocale, null);
  assert.equal(validate(cli).reportLocale.baseName, "en");
  for (const tag of ["zh", "zh-Hans", "zh-CN", "zh-SG", "zh-Hant-TW", "en-GB", "fr-CA", "qaa"]) {
    const result = validate(changed(cli, report => { report.language = tag; }));
    assert.equal(result.reportLocale.baseName, tag);
    assert.equal(result.report.language, tag);
    assert.equal(result.report.title, cli.title);
  }
  for (const tag of [null, 42, [], "", " en", "zh_CN", "<b>en</b>", "en-x-" + "a-".repeat(30) + "a"]) {
    assert.throws(() => validate(changed(cli, report => { report.language = tag; })), /\$\.language: expected a well-formed/);
  }
});

test("allows omitted candidate/flow/task lists, explicit gaps, and an empty graph", () => {
  const report = changed(reservations, data => {
    delete data.candidates;
    delete data.tasks;
  });
  assert.doesNotThrow(() => validate(report));
  for (const key of ["nodes", "edges", "correspondences", "evidence"]) {
    report[key] = [];
    if (key !== "evidence") report.views.overview[key] = [];
  }
  assert.doesNotThrow(() => validate(report));
});

test("allows many-to-many, but forbids fabricated missing-side matches", () => {
  assert.doesNotThrow(() => validate(changed(cli, data => {
    data.correspondences[2].own.push("N-own-lint");
  })));
  assert.throws(() => validate(changed(cli, data => {
    data.correspondences[3].status = "matched";
  })), /needs nodes and evidence on both sides/);
});

test("adoption mechanisms distinguish test cases, design, dependencies, and source", () => {
  assert.equal(cli.candidates[0].approach, "test-cases-only");
  for (const approach of ["test-cases-only", "add-dependency", "design-only", "copy-code", "status-quo"]) {
    const { records } = validate(changed(cli, data => { data.candidates[0].approach = approach; }));
    assert.equal(records.get("H-01").object.decision, "adapt");
    assert.equal(records.get("H-01").object.approach, approach);
  }
  assert.throws(() => validate(changed(cli, data => { data.candidates[0].decision = "add-dependency"; })), /expected adopt/);
});

test("blocks unsupported versions, invalid IDs, duplicates, and broken view references", () => {
  for (const [modify, message] of [
    [data => { data.schemaVersion += 1; }, /schemaVersion/],
    [data => { data.nodes[0].id = "#bad"; }, /expected a .* ID/],
    [data => { data.nodes.push(data.nodes[0]); }, /duplicate ID/],
    [data => { data.views.overview.nodes.push(data.nodes[0].id); }, /duplicate reference/],
    [data => { data.nodes[0].evidence = ["unknown"]; }, /unknown evidence ID/],
    [data => { data.views.overview.edges.push("N-own-args"); }, /unknown edges ID/],
    [data => { data.views.overview.nodes.shift(); }, /endpoint outside this view/],
    [data => { data.candidates[0].targets = ["unknown"]; }, /unknown nodes\/edges/],
    [data => { data.tasks[0].candidate = "unknown"; }, /unknown candidates ID/]
  ]) assert.throws(() => validate(changed(cli, modify)), message);
});

test("blocks cross-repo calls, misattributed evidence, and unmarked missing evidence", () => {
  assert.throws(() => validate(changed(cli, data => { data.edges[0].to = "N-ref-lint"; })), /cannot cross repositories/);
  assert.throws(() => validate(changed(cli, data => { data.edges[0].evidence = []; })), /expected an array of 1-/);
  assert.throws(() => validate(changed(cli, data => { data.nodes[0].evidence = []; })), /evidenceGap/);
  assert.throws(() => validate(changed(cli, data => { data.candidates[0].evidence.own = ["E-09"]; })), /expected records from/);
  assert.throws(() => validate(changed(cli, data => { data.evidence[0].revision = "a-different-revision"; })), /does not match/);
  assert.throws(() => validate(changed(reservations, data => { data.tasks = []; })), /needs a recheck/);
});

test("plain text stays data; executable fields and non-relative paths are not accepted", () => {
  const message = '<img src="https://invalid.test/never" onerror="run()"> <script>run()</script>';
  const plain = changed(cli, data => { data.edges[0].label = message; });
  assert.equal(validate(plain).records.get("L-own-check").object.label, message);
  assert.throws(() => validate(changed(cli, data => { data.nodes[0].html = message; })), /unsupported field "html"/);
  assert.throws(() => validate(changed(cli, data => { data.edges[0].onClick = message; })), /unsupported field "onClick"/);
  for (const path of ["../run", "/bin/run", "C:\\run.exe", "https://invalid.test/file", "file:///bad"]) {
    assert.throws(() => validate(changed(cli, data => { data.evidence[0].path = path; })), /repository-relative path/);
  }
});
