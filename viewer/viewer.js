(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const { VERSION, MAX_BYTES, validate, locator, parseLanguage } = window.ReportContract;
  const { layout, fitCamera, zoomCamera, clamp, overlapArea, findCardPlacement,
    fitWindow, unprojectWindow, unionBounds, adjustWindow } = window.HarvestGraph;
  const preferenceKey = "harvest-advisor.ui-language";
  const canvas = $("canvas");
  const graph = $("graph");
  const wires = $("wires");
  const inspector = $("inspector");
  const leader = $("leader");
  const narrow = matchMedia("(max-width: 680px)");
  let languageMode = readLanguagePreference();
  let uiLanguage = "en";
  let importStatus;
  let importError;
  let state;
  let camera = { x: 0, y: 0, k: 1 };
  let windowRect;
  let windowHome;
  let windowBasis;
  let windowGesture;
  let windowFrame = 0;
  let leaderOrigin;
  let leaderDetour = 0;
  let drag;
  let viewport;
  let paintFrame = 0;
  let tabNavigation = false;
  let feedback;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const t = (key, ...args) => window.viewerMessage(uiLanguage, key, ...args);

  function readLanguagePreference() {
    try {
      const choice = window.localStorage.getItem(preferenceKey);
      if (choice === "en" || choice === "zh-Hans") return choice;
    } catch { /* A file origin may deny storage. */ }
    return "auto";
  }

  function supportedLanguage(locale) {
    if (locale?.language === "en") return "en";
    if (locale?.language === "zh" &&
        (locale.script ? locale.script === "Hans" : !locale.region || ["CN", "SG"].includes(locale.region))) return "zh-Hans";
    return null;
  }

  function resolveLanguage() {
    if (languageMode !== "auto") return languageMode;
    const hint = supportedLanguage(state?.reportLocale);
    if (hint) return hint;
    const preferences = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const preference of preferences) {
      const language = supportedLanguage(parseLanguage(preference));
      if (language) return language;
    }
    return "en";
  }

  function applyLanguage(refreshReport = true) {
    const language = resolveLanguage();
    const changed = language !== uiLanguage;
    uiLanguage = language;
    document.documentElement.lang = language;
    $("language-select").value = languageMode;
    for (const element of document.querySelectorAll("[data-i18n]")) {
      element.textContent = t(element.dataset.i18n);
    }
    for (const element of document.querySelectorAll("[data-i18n-aria]")) {
      element.setAttribute("aria-label", t(element.dataset.i18nAria));
    }
    for (const element of document.querySelectorAll("[data-i18n-title]")) {
      element.title = t(element.dataset.i18nTitle);
    }
    renderImportFeedback();
    if (changed && state && refreshReport) {
      // Keep the current graph nodes, view, selection, and drill-down history.
      renderScope();
      renderIndex(state.view);
      measureViewport();
      renderInspector({ keepScroll: true });
    }
  }

  function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setReportText(element, text) {
    element.textContent = text;
    const language = state.reportLocale?.baseName;
    if (language) element.lang = language;
    else element.removeAttribute("lang");
    return element;
  }

  function localized(tag, className, key) {
    const element = el(tag, className, t(key));
    element.dataset.i18n = key;
    return element;
  }

  function svg(tag, attrs) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  }

  function show(id, hidden) {
    $(id).hidden = hidden;
  }

  function get(id) {
    return state.records.get(id).object;
  }

  function reverseIndex(items, keys) {
    const index = new Map();
    for (const item of items) {
      for (const key of keys(item)) {
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(item);
      }
    }
    return index;
  }

  function recordButton(id, title, sub, { mark, onClick, graphControl = false, code = false, gap = false } = {}) {
    const button = el("button", "record-button");
    button.type = "button";
    if (mark) {
      const symbol = el("span", `mark ${mark}`);
      symbol.setAttribute("aria-hidden", "true");
      button.append(symbol);
    }
    const content = el("span");
    content.append(code ? el("code", "", title) : setReportText(el("strong"), title));
    if (sub) content.append(el(code ? "code" : "small", gap ? "gap-text" : "", sub));
    button.append(content);
    button.addEventListener("click", onClick ?? (() => drill(id)));
    if (graphControl) state.controls.set(id, button);
    return button;
  }

  function listItem(list, element, className) {
    const item = el("li", className);
    item.append(element);
    list.append(item);
  }

  function plainList(values, tag = "ul") {
    if (!values.length) return el("span", "muted", t("noneListed"));
    const list = el(tag);
    for (const value of values) list.append(setReportText(el("li"), value));
    return list;
  }

  function renderScope() {
    const { scope, repositories } = state.report;
    const body = $("scope-body");
    const grid = el("div", "scope-grid");
    for (const [title, values] of [["included", scope.included], ["excluded", scope.excluded]]) {
      const column = el("div");
      column.append(el("h4", "", t(title)), plainList(values));
      grid.append(column);
    }
    for (const [side, repo] of Object.entries(repositories)) {
      const column = el("div");
      column.append(el("h4", "", t(side)), setReportText(el("p"), `${repo.name} (${repo.id})`),
        el("code", "revision", `${t(repo.revision.kind)}: ${repo.revision.value}`));
      if (repo.revision.state) column.append(setReportText(el("p", "muted"), repo.revision.state));
      grid.append(column);
    }
    body.replaceChildren(grid);
    if (scope.gaps.length) {
      const gaps = el("div", "scope-gaps");
      const list = el("ul", "records");
      for (const gap of scope.gaps) {
        listItem(list, recordButton(gap.id, gap.label, gap.note, {
          mark: "gap", gap: true, graphControl: true, onClick: event => selectFromGraph(gap.id, event)
        }));
      }
      gaps.append(el("h4", "", t("scopeGaps")), list);
      body.append(gaps);
    }
  }

  function load(model) {
    const identity = JSON.stringify(model.report);
    if (state?.identity === identity) return;
    endDrag();
    const views = [model.report.views.overview, ...(model.report.views.flows ?? [])];
    state = { ...model, identity, views, view: views[0], history: [], controls: new Map(),
      nodeButtons: new Map(), drawn: new Map(), anchors: new Map(),
      candidates: reverseIndex(model.report.candidates ?? [], item => item.targets),
      tasks: reverseIndex(model.report.tasks ?? [], item => [item.candidate]) };
    applyLanguage(false);
    setReportText($("report-title"), state.report.title);
    setReportText($("report-goal"), state.report.scope.goal);
    const select = $("view-select");
    select.replaceChildren();
    for (const view of views) {
      const option = setReportText(el("option"), view.label);
      option.value = view.id;
      select.append(option);
    }
    select.disabled = views.length < 2;
    show("empty", true);
    show("report", false);
    show("graph", false);
    show("zoom-tools", false);
    show("minimap", false);
    canvas.classList.add("ready");
    renderView(views[0]);
  }

  function relationLabel(relation) {
    if (relation.kind) return `${t(relation.kind)}: ${get(relation.from).label} \u2192 ${get(relation.to).label}`;
    const names = side => relation[side].map(id => get(id).label).join(" + ") || t("noNode");
    return `${names("own")} / ${names("reference")}`;
  }

  function setBox(element, { x, y, w, h }) {
    Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  function renderLanes(geometry) {
    for (const bounds of geometry.lanes) {
      const { side } = bounds;
      const repo = state.report.repositories[side];
      const lane = $(`${side}-lane`);
      setBox(lane, bounds);
      const head = el("header", "lane-head");
      const title = el("div", "lane-title");
      title.append(localized("p", "lane-role", side), setReportText(el("h4"), repo.name));
      head.append(title, el("code", "revision", repo.revision.value));
      lane.replaceChildren(head);
      let count = 0;
      for (const [id, rect] of geometry.nodes) {
        if (rect.side !== side) continue;
        count++;
        const node = get(id);
        const button = el("button", node.evidence.length ? "node" : "node unverified");
        button.type = "button";
        button.dataset.node = node.id;
        button.title = node.label;
        const meta = el("span", "node-meta", node.group ? `${node.group} / ${node.id}` : node.id);
        if (!node.evidence.length) meta.append(" / ", localized("span", "", "noEvidenceShort"));
        button.append(setReportText(el("span", "node-label"), node.label), meta);
        button.addEventListener("click", event => selectFromGraph(node.id, event));
        setBox(button, { ...rect, x: rect.x - bounds.x - 1, y: rect.y - bounds.y - 1 });
        state.nodeButtons.set(node.id, button);
        state.anchors.set(node.id, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, rect });
        lane.append(button);
      }
      if (!count) lane.append(localized("p", "muted", "noNodes"));
    }
  }

  function renderIndex(view, preserveDisclosure = true) {
    const index = $("graph-index");
    const open = preserveDisclosure ? Array.from(index.querySelectorAll("details[open]"), item => item.dataset.kind) : [];
    index.replaceChildren();
    const comparisons = el("ul", "records");
    for (const id of view.correspondences) {
      const match = get(id);
      const gap = match.status !== "matched";
      const caption = gap ? `${t(match.status)} / ${relationLabel(match)}` : relationLabel(match);
      listItem(comparisons, recordButton(id, match.label, caption, {
        mark: gap ? "gap" : "matched", gap, graphControl: true, onClick: event => selectFromGraph(id, event)
      }));
    }
    index.append(el("h4", "", t("correspondencesAndGaps")),
      view.correspondences.length ? comparisons : el("p", "muted", t("noCorrespondences")));
    if (view.edges.length) {
      const details = el("details");
      details.dataset.kind = "edges";
      details.open = open.includes("edges");
      details.append(el("summary", "", t("directedRelationships", view.edges.length)));
      const list = el("ul", "records");
      for (const id of view.edges) {
        const edge = get(id);
        listItem(list, recordButton(id, edge.label, relationLabel(edge), {
          mark: edge.kind, graphControl: true, onClick: event => selectFromGraph(id, event)
        }));
      }
      details.append(list);
      index.append(details);
    }
    if (view.nodes.length) {
      const details = el("details");
      const list = el("ul", "records");
      details.dataset.kind = "nodes";
      details.open = open.includes("nodes");
      details.append(el("summary", "", t("graphNodes")), list);
      for (const id of view.nodes) {
        const node = get(id);
        listItem(list, recordButton(id, node.label, `${state.repos.get(node.repo).name} / ${id}`, {
          mark: "node-mark", graphControl: true, onClick: event => selectFromGraph(id, event)
        }));
      }
      index.append(details);
    }
  }

  function renderView(view) {
    endDrag();
    state.view = view;
    state.history = [];
    state.controls.clear();
    state.selection = null;
    state.graphSelection = null;
    state.wireAnchor = null;
    setReportText($("view-title"), view.label);
    setReportText($("view-note"), view.note ?? "");
    closeMenus();
    renderScope();
    renderIndex(view, false);
    state.incident = reverseIndex([...view.edges, ...view.correspondences].map(get), item =>
      new Set(item.kind ? [item.from, item.to] : [...item.own, ...item.reference]));
    buildGraph();
    renderInspector();
    fit();
  }

  function wireGroup(id, { kind, runs, arrow, hub }) {
    const group = svg("g", { class: "wire-group", "data-relation": id, "data-kind": kind });
    if (arrow) group.dataset.side = state.geometry.nodes.get(get(id).from).side;
    for (const d of runs) {
      group.append(svg("path", { d, class: `wire ${kind}` }), svg("path", { d, class: "wire-hit" }));
    }
    if (arrow) group.append(svg("path", { d: arrow, class: "wire" }));
    if (hub) {
      const { x, y } = hub;
      group.append(svg("path", { class: "wire-hub", d: `M${x} ${y - 6}l6 6-6 6-6-6z` }),
        svg("circle", { class: "hub-hit", cx: x, cy: y, r: 12 }));
    }
    const title = svg("title", {});
    title.textContent = get(id).label;
    group.prepend(title);
    group.addEventListener("click", event => selectFromGraph(id, event));
    state.drawn.set(id, group);
    return group;
  }

  function buildGraph() {
    const view = state.view;
    const bySide = { own: [], reference: [] };
    for (const id of view.nodes) bySide[get(id).repo === state.report.repositories.own.id ? "own" : "reference"].push(id);
    const geometry = layout(bySide, view.edges.map(get),
      view.correspondences.map(get).filter(item => item.status === "matched"), narrow.matches);
    state.geometry = geometry;
    state.narrow = narrow.matches;
    state.wireAnchor = null;
    state.nodeButtons.clear();
    state.anchors.clear();
    state.drawn.clear();
    setBox(graph, geometry.bounds);
    renderLanes(geometry);
    const fragment = document.createDocumentFragment();
    for (const [id, route] of geometry.routes) fragment.append(wireGroup(id, route));
    wires.replaceChildren(fragment);
    for (const [id, route] of geometry.routes) {
      const path = state.drawn.get(id).querySelector(".wire");
      state.anchors.set(id, route.hub ?? path.getPointAtLength(path.getTotalLength() / 2));
    }
    renderMinimap();
    updateGraphSelection();
  }

  function closeMenus(except) {
    for (const menu of document.querySelectorAll(".tool-menu[open]")) {
      if (menu !== except) menu.open = false;
    }
  }

  function measureViewport() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const margin = narrow.matches ? 10 : 22;
    const top = Math.min($("toolbar").getBoundingClientRect().bottom + margin, h / 2);
    const fitArea = { x: margin, y: top, w: Math.max(1, w - margin * 2),
      h: Math.max(1, h - top - (narrow.matches ? 74 : 84)) };
    viewport = { w, h, fitArea };
  }

  function screen(point) {
    return { x: camera.x + point.x * camera.k, y: camera.y + point.y * camera.k };
  }

  function screenBox(box) {
    return { ...screen(box), w: box.w * camera.k, h: box.h * camera.k };
  }

  function currentAnchor() {
    if (state.wireAnchor) return state.wireAnchor;
    const id = state.graphSelection;
    const anchor = state.anchors.get(id);
    if (anchor) return anchor;
    const record = get(id);
    const peer = [...(record.own ?? []), ...(record.reference ?? [])].map(node => state.anchors.get(node)).find(Boolean);
    if (peer) return peer;
    const lane = state.geometry.lanes[0];
    return narrow.matches ? { x: lane.w, y: lane.y + 65 } : { x: lane.x + 38, y: lane.y + lane.h };
  }

  function axisShift(low, high, start, size) {
    if (high - low > size) return start + (size - high - low) / 2;
    if (low < start) return start - low;
    if (high > start + size) return start + size - high;
    return 0;
  }

  function controlBoxes() {
    return [...$("toolbar").children, $("zoom-tools"), $("minimap"), $("import-error")]
      .map(element => element.getBoundingClientRect()).filter(rect => rect.width && rect.height)
      .map(rect => ({ x: rect.x - 8, y: rect.y - 8, w: rect.width + 16, h: rect.height + 16, kind: "control" }));
  }

  function wireObstacles(id) {
    const selectedWire = state.drawn.get(id);
    if (!selectedWire) return [];
    const paths = state.wireAnchor?.path ? [state.wireAnchor.path] : [...selectedWire.querySelectorAll(".wire")].slice(0, 3);
    return paths.flatMap(path => {
      const length = path.getTotalLength();
      const count = clamp(Math.ceil(length * camera.k / 12), 1, 40);
      const points = Array.from({ length: count + 1 }, (_, i) => screen(path.getPointAtLength(length * i / count)));
      return points.slice(1).map((b, i) => {
        const a = points[i];
        return { x: Math.min(a.x, b.x) - 2, y: Math.min(a.y, b.y) - 2,
          w: Math.abs(a.x - b.x) + 4, h: Math.abs(a.y - b.y) + 4, kind: "wire" };
      });
    });
  }

  function windowArea() {
    const x = 8;
    const y = narrow.matches ? Math.max(8, Math.min(viewport.fitArea.y, viewport.h - 136)) : 8;
    return { x, y, w: Math.max(1, viewport.w - x - 8), h: Math.max(1, viewport.h - y - 8) };
  }

  function placeAttachment() {
    const area = windowArea();
    const origin = leaderOrigin;
    const pin = screen(origin);
    const selected = origin.rect ? screenBox(origin.rect) : { x: pin.x - 8, y: pin.y - 8, w: 16, h: 16 };
    const obstacles = [...controlBoxes(), { ...selected, kind: "selected" }, ...wireObstacles(state.graphSelection)];
    for (const rect of state.geometry.nodes.values()) {
      if (rect !== origin.rect) obstacles.push({ ...screenBox(rect), kind: "node" });
    }
    const size = fitWindow({ x: area.x, y: area.y, w: inspector.offsetWidth, h: inspector.offsetHeight }, area);
    const box = findCardPlacement({ area, size, anchor: pin, obstacles });
    // Calibrate the content once at opening zoom; further camera changes only project this world box.
    windowBasis = camera.k;
    windowHome = windowRect = unprojectWindow(box, camera);
    inspector.classList.add("positioned");
    paintWindow();
  }

  function planLeader() {
    leaderDetour = 0;
    let bestCost = Infinity;
    const blockers = [...controlBoxes(), ...Array.from(state.geometry.nodes.values())
      .filter(rect => rect !== leaderOrigin.rect).map(rect => ({ ...screenBox(rect), kind: "node" }))];
    for (const detour of [0, -1, 1]) {
      const points = attachmentPoints(detour).map(screen);
      let cost = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const segment = { x: Math.min(a.x, b.x) - .5, y: Math.min(a.y, b.y) - .5,
          w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
        cost += Math.hypot(a.x - b.x, a.y - b.y);
        for (const rect of blockers) {
          if (overlapArea(segment, rect)) cost += rect.kind === "control" ? 400 : 130;
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        leaderDetour = detour;
      }
    }
  }

  function attachmentPoints(detour) {
    const { x, y, w, h } = windowRect;
    const pin = leaderOrigin;
    const halfW = pin.rect?.w / 2 || 0;
    const halfH = pin.rect?.h / 2 || 0;
    const padding = 12 / windowBasis;
    const bendOut = 16 / windowBasis;
    const approach = 10 / windowBasis;
    const dx = Math.max(x - pin.x, 0, pin.x - x - w);
    const dy = Math.max(y - pin.y, 0, pin.y - y - h);
    if (dx > dy) {
      const sign = pin.x < x + w / 2 ? 1 : -1;
      const from = detour ? { x: pin.x, y: pin.y + detour * halfH } : { x: pin.x + sign * halfW, y: pin.y };
      const rail = from.y + detour * bendOut;
      const to = { x: x + (sign < 0 ? w : 0), y: clamp(rail, y + padding, y + h - padding) };
      const turn = detour ? to.x - sign * approach : (from.x + to.x) / 2;
      return [from, { x: from.x, y: rail }, { x: turn, y: rail }, { x: turn, y: to.y }, to];
    }
    const sign = pin.y < y + h / 2 ? 1 : -1;
    const from = detour ? { x: pin.x + detour * halfW, y: pin.y } : { x: pin.x, y: pin.y + sign * halfH };
    const rail = from.x + detour * bendOut;
    const to = { x: clamp(rail, x + padding, x + w - padding), y: y + (sign < 0 ? h : 0) };
    const turn = detour ? to.y - sign * approach : (from.y + to.y) / 2;
    return [from, { x: rail, y: from.y }, { x: rail, y: turn }, { x: to.x, y: turn }, to];
  }

  function paintAttachment() {
    if (!windowRect || !leaderOrigin) return;
    const pin = leaderOrigin;
    const { x, y, w, h } = windowRect;
    if (pin.x >= x && pin.x <= x + w && pin.y >= y && pin.y <= y + h) {
      leader.setAttribute("hidden", "");
      return;
    }
    const points = attachmentPoints(leaderDetour).map(screen);
    const from = points[0];
    leader.firstElementChild.setAttribute("d", `M${points.map(p => `${p.x} ${p.y}`).join("L")}`);
    leader.lastElementChild.setAttribute("cx", from.x);
    leader.lastElementChild.setAttribute("cy", from.y);
    const projected = screen(pin);
    leader.toggleAttribute("data-offscreen",
      projected.x < 0 || projected.y < 0 || projected.x > viewport.w || projected.y > viewport.h);
    leader.removeAttribute("hidden");
  }

  function paintWindow() {
    if (!windowRect) return;
    const { w, h } = windowRect;
    setBox(inspector, { x: 0, y: 0, w: w * windowBasis, h: h * windowBasis });
    projectWindow();
    paintAttachment();
    updateZoomControls();
  }

  function projectWindow() {
    if (!windowRect) return;
    const { x, y } = screen(windowRect);
    inspector.style.transform = `translate(${x}px, ${y}px) scale(${camera.k / windowBasis})`;
  }

  function renderMinimap() {
    const { bounds, lanes, nodes } = state.geometry;
    $("map-image").setAttribute("viewBox", `-6 -6 ${bounds.w + 12} ${bounds.h + 12}`);
    const rect = ({ x, y, w, h, side }, type) => svg("rect",
      { x, y, width: w, height: h, rx: 4, class: `${type} ${side}` });
    $("map-graph").replaceChildren(...lanes.map(lane => rect(lane, "map-lane")),
      ...[...nodes.values()].map(node => rect(node, "map-node")));
  }

  function paintCamera() {
    graph.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})`;
    $("zoom-level").value = `${Math.round(camera.k * 100)}%`;
    updateZoomControls();
    const { bounds } = state.geometry;
    const mapWindow = $("map-window");
    const x = clamp(-camera.x / camera.k, 0, bounds.w);
    const y = clamp(-camera.y / camera.k, 0, bounds.h);
    mapWindow.setAttribute("x", x);
    mapWindow.setAttribute("y", y);
    mapWindow.setAttribute("width", Math.max(0, Math.min(bounds.w, (viewport.w - camera.x) / camera.k) - x));
    mapWindow.setAttribute("height", Math.max(0, Math.min(bounds.h, (viewport.h - camera.y) / camera.k) - y));
    projectWindow();
    paintAttachment();
  }

  function queuePaint() {
    if (!paintFrame) paintFrame = requestAnimationFrame(() => {
      paintFrame = 0;
      paintCamera();
    });
  }

  function flushPaint() {
    if (paintFrame) cancelAnimationFrame(paintFrame);
    paintFrame = 0;
    paintCamera();
  }

  function fit() {
    if (windowGesture) return;
    measureViewport();
    camera = fitCamera(sceneBounds(), viewport.fitArea);
    flushPaint();
  }

  function sceneBounds() {
    return unionBounds(state.geometry.bounds, windowRect);
  }

  function minimumZoom() {
    return Math.min(camera.k, .3, fitCamera(sceneBounds(), viewport.fitArea).k);
  }

  function updateZoomControls() {
    if (!viewport) return;
    $("zoom-in").disabled = camera.k >= 2.6;
    $("zoom-out").disabled = camera.k <= minimumZoom();
  }

  function zoom(point, factor, deferred = false) {
    if (windowGesture) return;
    const k = clamp(camera.k * factor, minimumZoom(), 2.6);
    if (k === camera.k) return;
    camera = zoomCamera(camera, point, k);
    if (deferred) queuePaint();
    else flushPaint();
  }

  function pan(x, y, deferred = false) {
    if (windowGesture) return;
    camera.x = x;
    camera.y = y;
    if (deferred) queuePaint();
    else flushPaint();
  }

  function centerPoint() {
    const { x, y, w, h } = viewport.fitArea;
    return { x: x + w / 2, y: y + h / 2 };
  }

  function reveal(box) {
    const area = viewport.fitArea;
    const dx = axisShift(box.x, box.x + box.w, area.x, area.w);
    const dy = axisShift(box.y, box.y + box.h, area.y, area.h);
    if (dx || dy) pan(camera.x + dx, camera.y + dy);
  }

  function updateGraphSelection() {
    for (const [id, control] of state.controls) control.setAttribute("aria-pressed", String(id === state.graphSelection));
    for (const [id, control] of state.nodeButtons) control.setAttribute("aria-pressed", String(id === state.graphSelection));
    for (const [id, group] of state.drawn) group.classList.toggle("selected", id === state.graphSelection);
  }

  function focusInspection() {
    $("selection-heading")?.focus({ preventScroll: true });
  }

  function clickedWirePoint(event) {
    const path = event.target;
    if (!event.detail || !path.matches(".wire-hit")) return null;
    const world = { x: (event.clientX - camera.x) / camera.k, y: (event.clientY - camera.y) / camera.k };
    const length = path.getTotalLength();
    let along = 0, best = Infinity;
    const check = distance => {
      const p = path.getPointAtLength(distance);
      const d = (p.x - world.x) ** 2 + (p.y - world.y) ** 2;
      if (d < best) { along = distance; best = d; }
    };
    for (let i = 0; i <= 32; i++) check(length * i / 32);
    for (const divisor of [128, 512]) {
      const start = along;
      for (let i = -4; i <= 4; i++) check(clamp(start + length * i / divisor, 0, length));
    }
    const { x, y } = path.getPointAtLength(along);
    return { x, y, path };
  }

  function selectFromGraph(id, event) {
    closeMenus();
    state.history = [];
    state.selection = id;
    state.graphSelection = id;
    state.wireAnchor = clickedWirePoint(event);
    renderInspector();
    if (event.detail === 0 || narrow.matches) focusInspection();
  }

  function drill(id) {
    if (id === state.selection) return;
    state.history.push({ id: state.selection, scrollTop: $("inspection-body").scrollTop });
    state.selection = id;
    renderInspector();
    focusInspection();
  }

  function section(key) {
    const block = el("section", "inspection-section");
    block.append(el("h5", "", t(key)));
    return block;
  }

  function evidenceSection(ids, key = "evidence") {
    const block = section(key);
    if (!ids?.length) {
      block.append(el("p", "muted", t("noEvidence")));
      return block;
    }
    const list = el("ul", "records");
    for (const id of ids) listItem(list, recordButton(id, id, locator(get(id)), { code: true }), "evidence-row");
    block.append(list);
    return block;
  }

  function addFacts(parent, fields) {
    const dl = el("dl", "facts");
    for (const [key, value] of fields) {
      const description = el("dd");
      if (value instanceof Node) description.append(value);
      else setReportText(description, value);
      dl.append(el("dt", "", t(key)), description);
    }
    parent.append(dl);
  }

  function candidateSection(candidates, key = "candidates") {
    const block = section(key);
    if (!candidates.length) {
      block.append(el("p", "muted", t("noCandidates")));
      return block;
    }
    const list = el("ul", "records");
    for (const candidate of candidates) {
      listItem(list, recordButton(candidate.id, `${candidate.id} / ${candidate.title}`,
        `${t(candidate.decision)} / ${t(candidate.approach)}`));
    }
    block.append(list);
    return block;
  }

  function taskSection(tasks) {
    const block = section("handoff");
    if (tasks.length) {
      const list = el("ul", "records");
      for (const task of tasks) listItem(list, recordButton(task.id, task.title, t(task.kind)));
      block.append(list);
    } else {
      block.append(el("p", "muted", t("noHandoff")));
    }
    return block;
  }

  function choicesFor(id, neighbors = []) {
    return [...new Set([id, ...neighbors.map(item => item.id)].flatMap(key => state.candidates.get(key) ?? []))];
  }

  function renderInspector({ keepScroll = false, scrollTop = 0 } = {}) {
    updateGraphSelection();
    inspector.hidden = !state.selection;
    leader.toggleAttribute("hidden", !state.selection);
    const back = $("back");
    back.hidden = !state.selection;
    back.title = t(state.history.length ? "back" : "backToGraph");
    back.setAttribute("aria-label", back.title);
    const body = $("inspection-body");
    const scroll = keepScroll ? body.scrollTop : scrollTop;
    fillInspector();
    if (!state.selection) {
      leaderOrigin = windowRect = windowHome = null;
      endWindowGesture();
      inspector.classList.remove("positioned");
      for (const prop of ["left", "top", "width", "height", "transform"]) inspector.style.removeProperty(prop);
    } else {
      const origin = currentAnchor();
      const anchorChanged = origin !== leaderOrigin;
      leaderOrigin = origin;
      if (!windowRect) placeAttachment();
      if (anchorChanged) planLeader();
      paintAttachment();
    }
    updateZoomControls();
    body.scrollTop = scroll;
    feedback?.cancel();
    if (!inspector.hidden && !keepScroll && !reducedMotion.matches) {
      feedback = body.animate([{ opacity: .86 }, { opacity: 1 }], { duration: 110, easing: "ease-out" });
    }
  }

  function fillInspector() {
    const body = $("inspection-body");
    body.replaceChildren();
    if (!state.selection) return;
    const entry = state.records.get(state.selection);
    const item = entry.object;
    const type = entry.collection;
    const isGap = type === "gaps" || (type === "correspondences" && item.status !== "matched");
    const metaKey = { edges: item.kind, correspondences: item.status, gaps: "scopeGap", evidence: "sourceLocator",
      candidates: item.decision, tasks: item.kind }[type];
    const title = el("h4", "selection-heading");
    if (type === "evidence") title.textContent = t("evidenceId", item.id);
    else setReportText(title, item.title ?? item.label);
    title.id = "selection-heading";
    title.tabIndex = -1;
    const subtitle = el("div", "selection-meta");
    const tag = el("span", isGap ? "tag gap-status" : "tag");
    if (type === "nodes") setReportText(tag, state.repos.get(item.repo).name);
    else tag.textContent = t(metaKey);
    subtitle.append(el("code", "", item.id), tag);
    body.append(title, subtitle);
    if (type === "evidence") {
      body.append(el("code", "location", locator(item)));
      const block = section("whatEvidenceEstablishes");
      addFacts(block, [["supports", item.supports], ["limits", item.limits]]);
      body.append(block);
      const parent = state.history.at(-1)?.id;
      const direct = (state.report.candidates ?? []).filter(candidate =>
        candidate.evidence.own.includes(item.id) || candidate.evidence.reference.includes(item.id));
      const candidates = [...new Set([...direct, ...choicesFor(parent, state.incident.get(parent))])];
      if (candidates.length) body.append(candidateSection(candidates), taskSection(candidates.flatMap(candidate => state.tasks.get(candidate.id) ?? [])));
      return;
    }
    if (type === "candidates") {
      const reasoning = section("decision");
      addFacts(reasoning, [["approach", el("span", "", t(item.approach))], ["fact", item.fact], ["inference", item.inference],
        ["recommendation", item.recommendation]]);
      body.append(reasoning);
      body.append(evidenceSection(item.evidence.own, "ownEvidence"),
        evidenceSection(item.evidence.reference, "referenceEvidence"));
      if (item.evidenceGap) body.append(setReportText(el("p", "notice gap"), item.evidenceGap));
      const constraints = section("fitAndConstraints");
      addFacts(constraints, [["benefit", item.benefit], ["license", item.license],
        ["stackFit", item.stackFit], ["maintenanceCost", item.maintenanceCost], ["architectureImpact", item.architectureImpact]]);
      body.append(taskSection(state.tasks.get(item.id) ?? []), constraints);
      return;
    }
    if (type === "tasks") {
      const block = section(item.kind === "approval" ? "approvalChecklist" : "recheckHeading");
      const fields = item.kind === "approval" ? [["modules", plainList(item.modules)],
        ["dependencies", plainList(item.dependencies)], ["steps", plainList(item.steps, "ol")],
        ["acceptance", item.acceptance], ["rollback", item.rollback]] : [["action", item.action], ["revisitWhen", item.condition]];
      addFacts(block, fields);
      body.append(block, evidenceSection(item.evidence), candidateSection([get(item.candidate)], "parentCandidate"));
      return;
    }

    if (type === "edges" || type === "correspondences") body.append(el("p", "muted", relationLabel(item)));
    if (item.note) body.append(setReportText(el("p", isGap ? "notice gap" : ""), item.note));
    if (item.evidenceGap) body.append(setReportText(el("p", "notice gap"), item.evidenceGap));
    const neighbors = state.incident.get(item.id) ?? [];
    const candidates = choicesFor(item.id, neighbors);
    body.append(candidateSection(candidates), taskSection(candidates.flatMap(candidate => state.tasks.get(candidate.id) ?? [])),
      evidenceSection(item.evidence));
    if (neighbors.length) {
      const related = section("relatedRecords");
      const links = el("ul", "records");
      for (const relation of neighbors) listItem(links, recordButton(relation.id, relation.label, t(relation.kind ?? relation.status)));
      related.append(links);
      body.append(related);
    }
  }

  function closeInspection() {
    if (!state?.selection) return;
    const id = state.graphSelection;
    const pin = screen(currentAnchor());
    state.history = [];
    state.selection = null;
    state.graphSelection = null;
    state.wireAnchor = null;
    renderInspector();
    const visible = pin.x > 0 && pin.y > 0 && pin.x < viewport.w && pin.y < viewport.h &&
      !controlBoxes().some(box => overlapArea(box, { ...pin, w: 1, h: 1 }));
    const control = visible ? state.nodeButtons.get(id) ?? canvas : canvas;
    tabNavigation = false;
    control.focus({ preventScroll: true });
  }

  $("back").addEventListener("click", () => {
    if (state.history.length) {
      const { id, scrollTop } = state.history.pop();
      state.selection = id;
      renderInspector({ scrollTop });
      focusInspection();
    } else closeInspection();
  });
  $("close-inspector").addEventListener("click", closeInspection);
  $("reset-inspector").addEventListener("click", () => {
    if (!windowHome) return;
    endWindowGesture();
    windowRect = windowHome;
    planLeader();
    paintWindow();
  });

  inspector.addEventListener("pointerdown", event => {
    if (!windowRect || windowGesture || drag || !event.isPrimary || event.button !== 0) return;
    const grip = event.target.closest(".inspector-resize");
    const header = event.target.closest(".inspector-header");
    if (!grip && (!header || event.target.closest("button"))) return;
    if (event.pointerType === "mouse") event.preventDefault();
    windowGesture = { id: event.pointerId, edge: grip?.dataset.edge ?? "move", x: event.clientX, y: event.clientY,
      start: windowRect, k: camera.k, moved: false };
    inspector.setPointerCapture(event.pointerId);
    inspector.style.setProperty("--window-cursor", grip ? getComputedStyle(grip).cursor : "grabbing");
    inspector.classList.add("manipulating");
  });

  function trackWindow(event) {
    if (!windowGesture || windowGesture.id !== event.pointerId) return;
    const { start, k, edge, x, y } = windowGesture;
    const dx = event.clientX - x, dy = event.clientY - y;
    if (!windowGesture.moved && Math.hypot(dx, dy) < 3) return;
    windowGesture.moved = true;
    // The minimum is calibrated from the starting window once, not from the current viewport or zoom.
    const minimum = { w: Math.min(windowHome.w, 224 / windowBasis), h: Math.min(windowHome.h, 128 / windowBasis) };
    windowRect = adjustWindow(start, minimum, edge, dx, dy, k);
    if (!windowFrame) windowFrame = requestAnimationFrame(() => {
      windowFrame = 0;
      paintWindow();
    });
  }

  function endWindowGesture(event) {
    if (!windowGesture || (event && windowGesture.id !== event.pointerId)) return;
    if (event?.type === "pointerup") trackWindow(event);
    const { id, moved } = windowGesture;
    windowGesture = null;
    if (windowFrame) cancelAnimationFrame(windowFrame);
    windowFrame = 0;
    inspector.classList.remove("manipulating");
    inspector.style.removeProperty("--window-cursor");
    if (inspector.hasPointerCapture(id)) inspector.releasePointerCapture(id);
    if (moved && windowRect) {
      planLeader();
      paintWindow();
    }
  }
  inspector.addEventListener("pointermove", trackWindow);
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) inspector.addEventListener(name, endWindowGesture);

  document.addEventListener("keydown", event => {
    if (!event.isTrusted || event.key !== "Tab") return;
    tabNavigation = true;
    setTimeout(() => { tabNavigation = false; }, 0);
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const menu = document.querySelector(".tool-menu[open]");
    if (menu) {
      closeMenus();
      menu.querySelector("summary").focus();
    } else closeInspection();
  });
  for (const menu of document.querySelectorAll(".tool-menu")) {
    menu.querySelector("summary").addEventListener("click", () => closeMenus(menu));
  }

  $("zoom-in").addEventListener("click", () => zoom(centerPoint(), 1.23));
  $("zoom-out").addEventListener("click", () => zoom(centerPoint(), 1 / 1.23));
  $("fit-graph").addEventListener("click", fit);
  $("minimap").addEventListener("click", event => {
    if (!event.detail) return fit();
    const matrix = $("map-image").getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const target = centerPoint();
    const { bounds } = state.geometry;
    pan(target.x - clamp(point.x, 0, bounds.w) * camera.k, target.y - clamp(point.y, 0, bounds.h) * camera.k);
  });
  canvas.addEventListener("keydown", event => {
    if (!state || event.target !== canvas || event.ctrlKey || event.metaKey || event.altKey) return;
    const offsets = { ArrowLeft: [52, 0], ArrowRight: [-52, 0], ArrowUp: [0, 52], ArrowDown: [0, -52] };
    if (Object.hasOwn(offsets, event.key)) {
      const [x, y] = offsets[event.key];
      pan(camera.x + x, camera.y + y);
    } else if (event.key === "+" || event.key === "=") zoom(centerPoint(), 1.23);
    else if (event.key === "-") zoom(centerPoint(), 1 / 1.23);
    else if (event.key === "Home") fit();
    else return;
    event.preventDefault();
  });
  canvas.addEventListener("focusin", event => {
    if (!tabNavigation || !event.target.matches(":focus-visible")) return;
    tabNavigation = false;
    const rect = state?.geometry.nodes.get(event.target.dataset.node);
    if (rect) reveal(screenBox(rect));
  });
  canvas.addEventListener("wheel", event => {
    if (!state || event.target.closest(".inspector")) return;
    event.preventDefault();
    if (drag || windowGesture) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.h : 1;
    zoom({ x: event.clientX, y: event.clientY }, Math.exp(-event.deltaY * unit * .0017), true);
  }, { passive: false });

  canvas.addEventListener("pointerdown", event => {
    if (!state || drag || windowGesture || !event.isPrimary || event.button !== 0 ||
        event.target.closest("button, .inspector, .wire-group")) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: camera.x, top: camera.y, moved: false };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      canvas.classList.add("dragging");
    }
    pan(drag.left + dx, drag.top + dy, true);
  });
  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const { id, moved, left, top, x, y } = drag;
    drag = null;
    canvas.classList.remove("dragging");
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    if (moved && event?.type === "pointerup") pan(left + event.clientX - x, top + event.clientY - y);
    else if (paintFrame) flushPaint();
  }
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(name, endDrag);
  window.addEventListener("blur", () => {
    endDrag();
    endWindowGesture();
  });

  $("view-select").addEventListener("change", event => renderView(get(event.target.value)));
  $("language-select").addEventListener("change", event => {
    languageMode = event.currentTarget.value;
    try {
      if (languageMode === "auto") window.localStorage.removeItem(preferenceKey);
      else window.localStorage.setItem(preferenceKey, languageMode);
    } catch { /* Keep the choice for this page when storage is blocked. */ }
    applyLanguage();
  });

  function renderImportFeedback() {
    $("import-status").textContent = importStatus ? t(...importStatus) : "";
    const alert = $("import-error");
    alert.hidden = !importError;
    if (!importError) return;
    const detail = el("span", "", importError.key ? t(importError.key) : importError.detail);
    if (!importError.key) detail.lang = "en";
    alert.replaceChildren(t("errorPrefix"), detail, t("expectedFormat", VERSION), state ? t("keptReport") : "");
  }

  async function importReport(read, readError, size) {
    const button = $("import-button");
    button.disabled = true;
    importError = null;
    importStatus = ["readingReport"];
    renderImportFeedback();
    let stage = "read";
    try {
      if (size > MAX_BYTES) {
        importError = { key: "fileTooLarge" };
        return;
      }
      const content = await read();
      stage = "parse";
      const raw = JSON.parse(content);
      stage = "validate";
      load(validate(raw));
      importStatus = ["reportImported", state.report.title];
    } catch (error) {
      importError = stage === "read" ? { key: readError } :
        stage === "parse" ? { key: "fileNotJson" } : { detail: error.message };
    } finally {
      if (importError) importStatus = null;
      renderImportFeedback();
      button.disabled = false;
    }
  }

  $("import-button").addEventListener("click", () => $("report-file").click());
  $("report-file").addEventListener("change", event => {
    const input = event.currentTarget;
    const file = input.files[0];
    input.value = "";
    if (file) void importReport(() => file.text(), "fileUnreadable", file.size);
  });
  applyLanguage(false);
  if (location.protocol === "http:" && location.hostname === "127.0.0.1" &&
      location.port && /^\/[a-f0-9]{48}\/$/.test(location.pathname)) {
    void importReport(async () => {
      const response = await fetch("./report.json", {
        credentials: "omit", cache: "no-store", redirect: "error", mode: "same-origin", signal: AbortSignal.timeout(5000)
      });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json") ||
          Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Preview report unavailable");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_BYTES) throw new Error("Preview report exceeds size limit");
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }, "previewUnreadable");
  }
  window.addEventListener("resize", () => {
    if (!state) return;
    endWindowGesture();
    const relayout = state.narrow !== narrow.matches;
    if (relayout) buildGraph();
    measureViewport();
    if (windowRect && relayout) {
      leaderOrigin = currentAnchor();
      planLeader();
    }
    flushPaint();
  });
})();
