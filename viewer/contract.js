/* Shared by the file:// viewer and local contract checks. */
(() => {
  "use strict";

  const VERSION = 1;
  const MAX_BYTES = 2 * 1024 * 1024;
  const sides = ["own", "reference"];
  const limits = { nodes: 200, edges: 600, correspondences: 300, evidence: 2000,
    candidates: 200, tasks: 400, flows: 30, gaps: 200 };

  function fail(at, reason) {
    throw new Error(`${at}: ${reason}`);
  }

  function shape(value, at, required, optional = []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(at, "expected an object");
    for (const key of required) if (!Object.hasOwn(value, key)) fail(`${at}.${key}`, "required field");
    for (const key of Object.keys(value)) {
      if (!required.includes(key) && !optional.includes(key)) fail(at, `unsupported field ${JSON.stringify(key.slice(0, 80))}`);
    }
  }

  function text(value, at, max = 4000) {
    if (typeof value !== "string" || !value.trim() || value.length > max) {
      fail(at, `expected non-empty text (up to ${max} characters)`);
    }
  }

  function enumValue(value, at, options) {
    if (!options.includes(value)) fail(at, `expected ${options.join(" / ")}`);
  }

  function id(value, at) {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value)) {
      fail(at, "expected a 1-64 character ID (letters, digits, dot, underscore, hyphen)");
    }
  }

  function list(value, at, max, min = 0) {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
      fail(at, `expected an array of ${min}-${max} entries`);
    }
    return value;
  }

  function optionalText(value, key, at, max) {
    if (Object.hasOwn(value, key)) text(value[key], `${at}.${key}`, max);
  }

  function parseLanguage(value) {
    if (typeof value !== "string" || !value.length || value.length > 64) return null;
    try { return new Intl.Locale(value); }
    catch { return null; }
  }

  function validate(report) {
    shape(report, "$", ["schemaVersion", "title", "repositories", "scope", "nodes",
      "edges", "correspondences", "evidence", "views"], ["candidates", "tasks", "language"]);
    if (report.schemaVersion !== VERSION) fail("$.schemaVersion", `expected ${VERSION}`);
    text(report.title, "$.title", 160);
    const reportLocale = parseLanguage(report.language);
    if (Object.hasOwn(report, "language") && !reportLocale) {
      fail("$.language", "expected a well-formed language tag of at most 64 characters");
    }
    shape(report.repositories, "$.repositories", sides);
    const repos = new Map();
    for (const side of sides) {
      const at = `$.repositories.${side}`;
      const repo = report.repositories[side];
      shape(repo, at, ["id", "name", "revision"]);
      id(repo.id, `${at}.id`);
      if (repos.has(repo.id)) fail(`${at}.id`, "duplicate repository ID");
      repos.set(repo.id, repo);
      text(repo.name, `${at}.name`, 120);
      shape(repo.revision, `${at}.revision`, ["kind", "value"], ["state"]);
      enumValue(repo.revision.kind, `${at}.revision.kind`, ["revision", "snapshot"]);
      text(repo.revision.value, `${at}.revision.value`, 160);
      optionalText(repo.revision, "state", `${at}.revision`);
    }

    const { scope } = report;
    shape(scope, "$.scope", ["goal", "included", "excluded", "gaps"]);
    text(scope.goal, "$.scope.goal");
    for (const key of ["included", "excluded"]) {
      list(scope[key], `$.scope.${key}`, 100).forEach((item, i) => text(item, `$.scope.${key}[${i}]`));
    }

    const records = new Map();
    function register(object, at, collection) {
      id(object.id, `${at}.id`);
      if (records.has(object.id)) fail(`${at}.id`, `duplicate ID "${object.id}"`);
      records.set(object.id, { collection, object });
    }
    function collection(name, check, optional = false) {
      const at = `$.${name}`;
      const values = optional && !Object.hasOwn(report, name) ? [] : report[name];
      list(values, at, limits[name]).forEach((item, i) => {
        const location = `${at}[${i}]`;
        check(item, location);
        register(item, location, name);
      });
      return values;
    }
    function refs(values, at, allowed, min = 0) {
      const seen = new Set();
      return list(values, at, limits.evidence, min).map((value, i) => {
        const location = `${at}[${i}]`;
        id(value, location);
        if (seen.has(value)) fail(location, `duplicate reference "${value}"`);
        seen.add(value);
        const entry = records.get(value);
        if (!entry || !allowed.includes(entry.collection)) fail(location, `unknown ${allowed.join("/")} ID "${value}"`);
        return entry.object;
      });
    }
    function correctRepo(values, repo, at) {
      if (values.some(value => value.repo !== repo)) fail(at, `expected records from "${repo}"`);
    }
    const sideId = side => report.repositories[side].id;
    function evidence(values, at, min = 0) {
      return refs(values, at, ["evidence"], min);
    }

    collection("evidence", (item, at) => {
      shape(item, at, ["id", "repo", "revision", "path", "supports", "limits"], ["range", "symbol"]);
      const repo = repos.get(item.repo);
      if (!repo) fail(`${at}.repo`, "unknown repository ID");
      if (item.revision !== repo.revision.value) fail(`${at}.revision`, "does not match the inspected repository version");
      text(item.path, `${at}.path`, 500);
      if (/[:\\\x00-\x1F\x7F]/.test(item.path) || item.path.split("/").some(part => !part || /^[.]{1,2}$/.test(part))) {
        fail(`${at}.path`, "expected a repository-relative path without traversal, drive letters, or URL schemes");
      }
      const hasRange = Object.hasOwn(item, "range");
      if (hasRange === Object.hasOwn(item, "symbol")) fail(at, "provide exactly one of range or symbol");
      if (hasRange) {
        shape(item.range, `${at}.range`, ["start", "end"]);
        if (!Number.isSafeInteger(item.range.start) || !Number.isSafeInteger(item.range.end) ||
            item.range.start < 1 || item.range.end < item.range.start) fail(`${at}.range`, "expected a positive inclusive line range");
      } else {
        text(item.symbol, `${at}.symbol`, 300);
      }
      text(item.supports, `${at}.supports`);
      text(item.limits, `${at}.limits`);
    });

    const gapIds = new Set();
    list(scope.gaps, "$.scope.gaps", limits.gaps).forEach((gap, i) => {
      const at = `$.scope.gaps[${i}]`;
      shape(gap, at, ["id", "label", "note"], ["evidence"]);
      text(gap.label, `${at}.label`, 160);
      text(gap.note, `${at}.note`);
      if (Object.hasOwn(gap, "evidence")) evidence(gap.evidence, `${at}.evidence`);
      register(gap, at, "gaps");
      gapIds.add(gap.id);
    });

    collection("nodes", (node, at) => {
      shape(node, at, ["id", "repo", "label", "evidence"], ["group", "note", "evidenceGap"]);
      if (!repos.has(node.repo)) fail(`${at}.repo`, "unknown repository ID");
      text(node.label, `${at}.label`, 160);
      optionalText(node, "group", at, 120);
      optionalText(node, "note", at);
      optionalText(node, "evidenceGap", at);
      const anchors = evidence(node.evidence, `${at}.evidence`);
      correctRepo(anchors, node.repo, `${at}.evidence`);
      if (!anchors.length && !node.evidenceGap) fail(`${at}.evidenceGap`, "required when a node has no evidence");
    });

    collection("edges", (edge, at) => {
      shape(edge, at, ["id", "kind", "from", "to", "label", "evidence"], ["note"]);
      const [from] = refs([edge.from], `${at}.from`, ["nodes"]);
      const [to] = refs([edge.to], `${at}.to`, ["nodes"]);
      if (from.repo !== to.repo) fail(at, "a directed edge cannot cross repositories");
      enumValue(edge.kind, `${at}.kind`, ["call", "data", "dependency"]);
      text(edge.label, `${at}.label`, 160);
      optionalText(edge, "note", at);
      correctRepo(evidence(edge.evidence, `${at}.evidence`, 1), from.repo, `${at}.evidence`);
    });

    collection("correspondences", (match, at) => {
      shape(match, at, ["id", "status", "label", "own", "reference", "evidence", "note"]);
      enumValue(match.status, `${at}.status`, ["matched", "checked-no-match", "unverified"]);
      text(match.label, `${at}.label`, 160);
      text(match.note, `${at}.note`);
      for (const side of sides) {
        correctRepo(refs(match[side], `${at}.${side}`, ["nodes"]), sideId(side), `${at}.${side}`);
      }
      const count = Number(match.own.length > 0) + Number(match.reference.length > 0);
      const anchors = evidence(match.evidence, `${at}.evidence`);
      if (match.status === "matched") {
        if (count !== 2 || sides.some(side => !anchors.some(anchor => anchor.repo === sideId(side)))) {
          fail(at, "a matched correspondence needs nodes and evidence on both sides");
        }
      } else if (!count || (match.status === "checked-no-match" && count !== 1)) {
        fail(at, "checked-no-match needs exactly one populated side; unverified needs at least one");
      }
    });

    shape(report.views, "$.views", ["overview"], ["flows"]);
    const visible = new Set(gapIds);
    function view(item, at) {
      shape(item, at, ["id", "label", "nodes", "edges", "correspondences"], ["note"]);
      text(item.label, `${at}.label`, 120);
      optionalText(item, "note", at);
      const included = new Set(refs(item.nodes, `${at}.nodes`, ["nodes"]).map(node => node.id));
      for (const kind of ["edges", "correspondences"]) {
        for (const relation of refs(item[kind], `${at}.${kind}`, [kind])) {
          const endpoints = kind === "edges" ? [relation.from, relation.to] : [...relation.own, ...relation.reference];
          if (endpoints.some(endpoint => !included.has(endpoint))) {
            fail(`${at}.${kind}`, `"${relation.id}" has an endpoint outside this view`);
          }
          visible.add(relation.id);
        }
      }
      for (const id of included) visible.add(id);
      register(item, at, "views");
    }
    view(report.views.overview, "$.views.overview");
    if (Object.hasOwn(report.views, "flows")) {
      list(report.views.flows, "$.views.flows", limits.flows).forEach((item, i) => view(item, `$.views.flows[${i}]`));
    }

    const candidates = collection("candidates", (candidate, at) => {
      shape(candidate, at, ["id", "title", "decision", "approach", "targets", "evidence",
        "fact", "inference", "recommendation", "benefit", "license", "stackFit",
        "maintenanceCost", "architectureImpact"], ["evidenceGap"]);
      text(candidate.title, `${at}.title`, 160);
      enumValue(candidate.decision, `${at}.decision`, ["adopt", "adapt", "reject", "watch"]);
      enumValue(candidate.approach, `${at}.approach`,
        ["copy-code", "design-only", "test-cases-only", "add-dependency", "status-quo"]);
      refs(candidate.targets, `${at}.targets`, ["nodes", "edges", "correspondences", "gaps"], 1);
      if (!candidate.targets.some(target => visible.has(target))) fail(`${at}.targets`, "at least one target must be visible");
      shape(candidate.evidence, `${at}.evidence`, sides);
      for (const side of sides) {
        correctRepo(evidence(candidate.evidence[side], `${at}.evidence.${side}`, candidate.decision === "watch" ? 0 : 1),
          sideId(side), `${at}.evidence.${side}`);
      }
      optionalText(candidate, "evidenceGap", at);
      if (sides.some(side => !candidate.evidence[side].length) && !candidate.evidenceGap) {
        fail(`${at}.evidenceGap`, "required when a side lacks evidence");
      }
      for (const key of ["fact", "inference", "recommendation", "benefit", "license", "stackFit",
        "maintenanceCost", "architectureImpact"]) text(candidate[key], `${at}.${key}`);
    }, true);

    const rechecks = new Set();
    collection("tasks", (task, at) => {
      const base = ["id", "candidate", "kind", "title", "evidence"];
      enumValue(task?.kind, `${at}.kind`, ["approval", "recheck"]);
      const fields = task.kind === "approval" ?
        ["modules", "dependencies", "steps", "acceptance", "rollback"] : ["action", "condition"];
      shape(task, at, [...base, ...fields]);
      const [candidate] = refs([task.candidate], `${at}.candidate`, ["candidates"]);
      text(task.title, `${at}.title`, 160);
      evidence(task.evidence, `${at}.evidence`, task.kind === "approval" ? 1 : 0);
      if (task.kind === "recheck") {
        if (candidate.decision !== "watch") fail(`${at}.candidate`, "a recheck belongs to a watch candidate");
        rechecks.add(candidate.id);
      } else if (!["adopt", "adapt"].includes(candidate.decision)) {
        fail(`${at}.candidate`, "an approval task belongs to an adopt or adapt candidate");
      }
      for (const key of fields) {
        if (["modules", "dependencies", "steps"].includes(key)) {
          list(task[key], `${at}.${key}`, 80, key === "dependencies" ? 0 : 1)
            .forEach((item, i) => text(item, `${at}.${key}[${i}]`));
        } else text(task[key], `${at}.${key}`);
      }
    }, true);
    for (const candidate of candidates) {
      if (candidate.decision === "watch" && !rechecks.has(candidate.id)) {
        fail("$.tasks", `watch candidate "${candidate.id}" needs a recheck action and condition`);
      }
    }
    return { report, repos, records, reportLocale };
  }

  function locator(item) {
    const anchor = item.range ? (item.range.start === item.range.end ? item.range.start :
      `${item.range.start}-${item.range.end}`) : item.symbol;
    return `${item.repo}@${item.revision}:${item.path}:${anchor}`;
  }

  const contract = Object.freeze({ VERSION, MAX_BYTES, validate, locator, parseLanguage });
  if (typeof module === "object" && module.exports) module.exports = contract;
  else window.ReportContract = contract;
})();
