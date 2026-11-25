const assert = require("node:assert/strict");
const { test } = require("node:test");
const { layout, fitCamera, zoomCamera, findCardPlacement, overlapArea,
  fitWindow, unprojectWindow, unionBounds, adjustWindow } = require("./graph-layout");
const { validate } = require("./contract");
const cli = require("./examples/markdown-cli.zh-Hans.json");
const reservations = require("./examples/reservations.json");

function graph(report, narrow) {
  const { records } = validate(report);
  const view = report.views.overview;
  const get = id => records.get(id).object;
  const ids = side => view.nodes.filter(id => get(id).repo === report.repositories[side].id);
  return layout({ own: ids("own"), reference: ids("reference") }, view.edges.map(get),
    view.correspondences.map(get).filter(record => record.status === "matched"), narrow);
}

test("report geometry uses two directions, bounded lanes, and distinct relation shapes", () => {
  for (const narrow of [false, true]) {
    for (const report of [cli, reservations]) {
      const result = graph(report, narrow);
      const { nodes, routes, lanes, bounds } = result;
      assert.equal(nodes.size, report.views.overview.nodes.length);
      assert.equal(lanes.length, 2);
      for (const node of nodes.values()) {
        assert.ok(node.x >= 0 && node.y >= 0 && node.x + node.w <= bounds.w && node.y + node.h <= bounds.h);
      }
      for (const match of report.correspondences) {
        const route = routes.get(match.id);
        if (match.status === "matched") {
          assert.equal(route.runs.length, match.own.length + match.reference.length);
          assert.ok(route.hub && !route.arrow);
        } else assert.equal(route, undefined);
      }
      assert.ok(report.edges.every(edge => routes.get(edge.id).arrow));
      assert.deepEqual(graph(report, narrow), result);
      if (narrow) assert.ok(lanes[0].x + lanes[0].w < lanes[1].x);
      else assert.ok(lanes[0].y + lanes[0].h < lanes[1].y);
    }
  }
});

test("cycle, a multi-to-multi relation, and empty lanes remain finite", () => {
  const edges = [{ id: "ab", from: "a", to: "b", kind: "call" }, { id: "ba", from: "b", to: "a", kind: "data" }];
  const matched = [{ id: "both", own: ["a", "b"], reference: ["c", "d"] }];
  for (const narrow of [false, true]) {
    const result = layout({ own: ["a", "b"], reference: ["c", "d"] }, edges, matched, narrow);
    assert.equal(result.routes.get("both").runs.length, 4);
    const boxes = [...result.nodes.values()].map(({ x, y }) => `${x}:${y}`);
    assert.equal(new Set(boxes).size, 4);
    assert.ok([...result.routes.values()].every(route => !route.runs.join().includes("NaN")));
    const empty = layout({ own: [], reference: [] }, [], [], narrow);
    assert.equal(empty.routes.size, 0);
    assert.ok(empty.bounds.w > 0 && empty.bounds.h > 0);
  }
});

test("fit contains the whole layout; pointer-centric zoom preserves its world position", () => {
  const bounds = graph(cli, true).bounds;
  const area = { x: 12, y: 114, w: 366, h: 656 };
  const camera = fitCamera(bounds, area);
  assert.ok(camera.x >= area.x && camera.y >= area.y);
  assert.ok(camera.x + bounds.w * camera.k <= area.x + area.w + 1e-9);
  assert.ok(camera.y + bounds.h * camera.k <= area.y + area.h + 1e-9);
  const pointer = { x: 205, y: 360 };
  const next = zoomCamera(camera, pointer, 2.35);
  assert.ok(Math.abs((pointer.x - camera.x) / camera.k - (pointer.x - next.x) / next.k) < 1e-9);
  assert.ok(Math.abs((pointer.y - camera.y) / camera.k - (pointer.y - next.y) / next.k) < 1e-9);
});

test("card finds a clear rectangle away from the anchor even among 200 staggered nodes", () => {
  const area = { x: 14, y: 14, w: 1412, h: 902 };
  const size = { w: 350, h: 480 };
  const obstacles = Array.from({ length: 200 }, (_, i) => ({
    x: 20 + i % 15 * 61 + i % 3, y: 18 + Math.floor(i / 15) * 61 + i % 7,
    w: 58, h: 55, kind: "node"
  }));
  obstacles.push({ x: 1260, y: 804, w: 166, h: 112, kind: "control" });
  const anchor = { x: 563, y: 430 };
  const box = findCardPlacement({ area, size, anchor, obstacles });
  assert.equal(box.h, size.h);
  assert.ok(obstacles.every(rect => overlapArea(rect, box) < 1e-5));
  assert.ok(box.x > 900);
  const shorter = findCardPlacement({ area, size: { ...size, h: 260 }, anchor, obstacles, previous: box });
  assert.deepEqual(shorter, { ...box, h: 260 });
});

test("dense fallback shortens the card and protects the selection and controls", () => {
  const area = { x: 10, y: 10, w: 370, h: 830 };
  const critical = [
    { x: 10, y: 10, w: 370, h: 114, kind: "control" },
    { x: 10, y: 770, w: 370, h: 70, kind: "control" },
    { x: 32, y: 375, w: 144, h: 60, kind: "selected" }
  ];
  const obstacles = [{ x: 10, y: 124, w: 370, h: 646, kind: "node" }, ...critical];
  const box = findCardPlacement({ area, size: { w: 350, h: 378 }, anchor: { x: 103, y: 405 }, obstacles });
  assert.equal(box.h, 236);
  assert.ok(critical.every(rect => overlapArea(rect, box) === 0));
});

test("all eight resize grips unproject at every zoom and keep the opposite world sides fixed", () => {
  const start = { x: 260, y: 190, w: 350, h: 270 };
  const minimum = { w: 224, h: 128 };
  for (const k of [.5, 1, 2]) {
    for (const edge of ["n", "e", "s", "w", "nw", "ne", "sw", "se"]) {
      const dx = edge.includes("w") ? -36 : 36;
      const dy = edge.includes("n") ? -24 : 24;
      const next = adjustWindow(start, minimum, edge, dx, dy, k);
      assert.equal(next.x, start.x + (edge.includes("w") ? dx / k : 0), edge);
      assert.equal(next.y, start.y + (edge.includes("n") ? dy / k : 0), edge);
      assert.equal(next.x + next.w, start.x + start.w + (edge.includes("e") ? dx / k : 0), edge);
      assert.equal(next.y + next.h, start.y + start.h + (edge.includes("s") ? dy / k : 0), edge);
    }
    assert.deepEqual(adjustWindow(start, minimum, "nw", 900, 900, k), { x: 386, y: 332, w: 224, h: 128 });
  }
  assert.deepEqual(adjustWindow(start, minimum, "move", 2000, -2000, 2),
    { x: 1260, y: -810, w: start.w, h: start.h });
});

test("initial screen sizing converts once; explicit fit includes a window in negative world space", () => {
  const area = { x: 8, y: 126, w: 344, h: 396 };
  const first = fitWindow({ x: 720, y: 408, w: 410, h: 600 }, area);
  assert.deepEqual(first, { x: 8, y: 126, w: 344, h: 396 });
  const world = unprojectWindow(first, { x: 48, y: 146, k: .5 });
  assert.deepEqual(world, { x: -80, y: -40, w: 688, h: 792 });
  const far = { ...world, x: -1200 };
  const bounds = unionBounds({ x: 0, y: 0, w: 760, h: 480 }, far);
  const camera = fitCamera(bounds, area);
  assert.ok(camera.x + bounds.x * camera.k >= area.x - 1e-8);
  assert.ok(camera.x + (bounds.x + bounds.w) * camera.k <= area.x + area.w + 1e-8);
  assert.ok(camera.y + bounds.y * camera.k >= area.y - 1e-8);
  assert.ok(camera.y + (bounds.y + bounds.h) * camera.k <= area.y + area.h + 1e-8);
});
