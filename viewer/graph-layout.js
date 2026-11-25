(() => {
  "use strict";

  const sides = ["own", "reference"];
  const center = (a, size) => a + size / 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  function ranks(ids, edges) {
    const order = new Map(ids.map((id, i) => [id, i]));
    const outgoing = new Map(ids.map(id => [id, []]));
    const incoming = new Map(ids.map(id => [id, 0]));
    for (const edge of edges) {
      if (!order.has(edge.from) || edge.from === edge.to) continue;
      outgoing.get(edge.from).push(edge.to);
      incoming.set(edge.to, incoming.get(edge.to) + 1);
    }
    const rank = new Map(ids.map(id => [id, 0]));
    const ready = ids.filter(id => !incoming.get(id));
    for (let i = 0; i < ready.length; i++) {
      const from = ready[i];
      for (const to of outgoing.get(from)) {
        rank.set(to, Math.max(rank.get(to), rank.get(from) + 1));
        incoming.set(to, incoming.get(to) - 1);
        if (!incoming.get(to)) ready.push(to);
      }
    }
    // Preserve report order within ranks, including components with cycles.
    return ids.slice().sort((a, b) => rank.get(a) - rank.get(b) || order.get(a) - order.get(b))
      .map(id => ({ id, rank: rank.get(id) }));
  }

  function layout(bySide, edges, matches, narrow) {
    const along = narrow ? 62 : 170;
    const across = narrow ? 134 : 64;
    const gap = narrow ? 38 : 148;
    const lead = narrow ? 84 : 34;
    const pitch = narrow ? 82 : 240;
    const depth = narrow ? 159 : 164;
    const box = (u, v, du, dv) => narrow ? { x: v, y: u, w: dv, h: du } : { x: u, y: v, w: du, h: dv };
    const point = (u, v) => narrow ? { x: v, y: u } : { x: u, y: v };
    const xy = (u, v) => { const p = point(u, v); return `${p.x} ${p.y}`; };
    let offset = 0;
    let length = narrow ? 190 : 588;
    const lanes = [];
    const nodes = new Map();
    const routes = new Map();
    for (const side of sides) {
      const items = ranks(bySide[side], edges);
      const lane = { side, start: offset, depth };
      const counts = new Map();
      const columns = new Map();
      let column = 0;
      for (const { id, rank } of items) {
        const slot = counts.get(rank) ?? 0;
        counts.set(rank, slot + 1);
        if (!narrow && !columns.has(rank)) {
          columns.set(rank, column);
          column++;
        }
        // A wide fan-out wraps into further columns instead of making a single deep stack.
        if (!narrow && slot > 0 && slot % 3 === 0) column++;
        const laneColumn = narrow ? nodes.size - (side === "reference" ? bySide.own.length : 0) :
          columns.get(rank) + Math.floor(slot / 3);
        const u = lead + laneColumn * pitch;
        const v = offset + (narrow ? (side === "own" ? 19 : 6) : 73 + (slot % 3) * 79);
        nodes.set(id, { ...box(u, v, along, across), u, v, side, lane, laneColumn });
        if (!narrow) lane.depth = Math.max(lane.depth, v - offset + across + 26);
        length = Math.max(length, u + along + (narrow ? 26 : 34));
      }
      lanes.push(lane);
      offset += lane.depth + gap;
    }
    const thickness = offset - gap;
    for (const lane of lanes) Object.assign(lane, box(0, lane.start, length, lane.depth));

    const tracks = { own: 0, reference: 0 };
    for (const edge of edges) {
      const a = nodes.get(edge.from);
      const b = nodes.get(edge.to);
      const ac = center(a.v, across);
      const bc = center(b.v, across);
      let d, arrow;
      if (b.laneColumn === a.laneColumn + 1) {
        const start = a.u + along + 2;
        const end = b.u - 2;
        const bend = center(start, end - start);
        d = `M${xy(start, ac)}L${xy(bend, ac)}L${xy(bend, bc)}L${xy(end, bc)}`;
        arrow = `M${xy(end - 7, bc - 4)}L${xy(end, bc)}L${xy(end - 7, bc + 4)}`;
      } else if (narrow) {
        const sign = a.side === "own" ? -1 : 1;
        const start = sign < 0 ? a.v - 2 : a.v + across + 2;
        const end = sign < 0 ? b.v - 2 : b.v + across + 2;
        const bend = start + sign * (8 + tracks[a.side]++ % 3 * 3);
        const fromU = center(a.u, along) - (a === b ? 10 : 0);
        const toU = center(b.u, along) + (a === b ? 10 : 0);
        d = `M${xy(fromU, start)}L${xy(fromU, bend)}L${xy(toU, bend)}L${xy(toU, end)}`;
        arrow = `M${xy(toU - 4, end + sign * 6)}L${xy(toU, end)}L${xy(toU + 4, end + sign * 6)}`;
      } else {
        const start = a.u + along + 2;
        const end = b.u - 2;
        const rail = a.lane.start + 60 + tracks[a.side]++ % 3 * 4;
        const after = start + 12;
        const before = end - 12;
        d = `M${xy(start, ac)}L${xy(after, ac)}L${xy(after, rail)}L${xy(before, rail)}L${xy(before, bc)}L${xy(end, bc)}`;
        arrow = `M${xy(end - 7, bc - 4)}L${xy(end, bc)}L${xy(end - 7, bc + 4)}`;
      }
      routes.set(edge.id, { kind: edge.kind, runs: [d], arrow });
    }

    const cross = lanes[0].depth + gap / 2;
    const centers = [];
    for (const match of matches) {
      const peers = [...match.own, ...match.reference].map(id => nodes.get(id));
      const mean = peers.reduce((sum, node) => sum + center(node.u, along), 0) / peers.length;
      let hub = clamp(mean, 14, length - 14);
      for (let attempt = 1; centers.some(previous => Math.abs(previous - hub) < 18) && attempt < 20; attempt++) {
        hub = clamp(mean + (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * 20, 14, length - 14);
      }
      centers.push(hub);
      const runs = peers.map(node => {
        const own = node.side === "own";
        const startV = own ? node.v + across + 1 : node.v - 1;
        const startU = center(node.u, along);
        const obscured = !narrow && [...nodes.values()].some(other => other.side === node.side &&
          other.u === node.u && (own ? other.v > node.v : other.v < node.v));
        const inner = own ? lanes[0].depth : lanes[1].start;
        const tipU = obscured ? node.u + along + 14 : startU;
        const tipV = obscured ? inner : startV;
        const joinV = center(tipV, cross - tipV);
        const start = obscured ?
          `M${xy(node.u + along + 1, center(node.v, across))}L${xy(tipU, center(node.v, across))}L${xy(tipU, inner)}` :
          `M${xy(tipU, tipV)}`;
        return `${start}C${xy(tipU, joinV)} ${xy(hub, joinV)} ${xy(hub, cross)}`;
      });
      routes.set(match.id, { kind: "matched", runs, hub: point(hub, cross) });
    }
    const bounds = box(0, 0, length, thickness);
    return { bounds, lanes, nodes, routes };
  }

  function fitCamera(bounds, area, max = 1.12) {
    const k = Math.min(max, area.w / bounds.w, area.h / bounds.h);
    return { k, x: area.x + (area.w - bounds.w * k) / 2 - (bounds.x ?? 0) * k,
      y: area.y + (area.h - bounds.h * k) / 2 - (bounds.y ?? 0) * k };
  }

  function zoomCamera(camera, point, k) {
    const ratio = k / camera.k;
    return { k, x: point.x + (camera.x - point.x) * ratio, y: point.y + (camera.y - point.y) * ratio };
  }

  function overlapArea(a, b) {
    return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  }

  function findCardPlacement({ area, size, anchor, obstacles, previous, compactHeight = 236 }) {
    const visible = obstacles.filter(rect => overlapArea(area, rect) > 0).sort((a, b) => a.x - b.x);
    const w = Math.min(size.w, area.w);
    const full = Math.min(size.h, area.h);
    const compact = Math.min(full, compactHeight);
    const pin = { x: clamp(anchor.x, area.x, area.x + area.w), y: clamp(anchor.y, area.y, area.y + area.h) };
    const order = { control: 0, selected: 1, node: 2, wire: 3 };
    function better(a, b) {
      if (!b) return true;
      for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) > 1e-5) return a[i] < b[i];
      }
      return false;
    }
    const limitX = area.x + area.w - w;
    function positions(lo, hi, pin, prior, span, blockers, sizeKey, axis) {
      const values = [lo, hi, pin - span / 2, pin - span - 24, pin + 24, prior ?? pin];
      for (const rect of blockers) values.push(rect[axis] - span, rect[axis] + rect[sizeKey]);
      return [...new Set(values.map(value => clamp(value, lo, hi)))];
    }
    function closeness({ x, y, h }) {
      const prevDistance = previous ? Math.hypot(previous.x - x, previous.y - y) : 0;
      const lead = Math.hypot(Math.max(x - pin.x, pin.x - x - w, 0), Math.max(y - pin.y, pin.y - y - h, 0));
      return [previous && prevDistance > 0.5 ? 1 : 0, Math.abs(lead - 24) + prevDistance * 0.15];
    }
    function free(h) {
      const limitY = area.y + area.h - h;
      const rows = positions(area.y, limitY, pin.y, previous?.y, h, visible, "h", "y");
      let best;
      for (const y of rows) {
        const consider = (lo, hi) => {
          for (const x of positions(lo, hi, pin.x, previous?.x, w, [], "w", "x")) {
            const box = { x, y, w, h };
            const score = closeness(box);
            if (better(score, best?.score)) best = { box, score };
          }
        };
        // At each vertical boundary, sweep sorted open intervals of forbidden card-left positions.
        // Their endpoints are legal: touching a rectangle does not cover it.
        let next = area.x;
        for (const rect of visible) {
          if (rect.y >= y + h - 1e-6 || rect.y + rect.h <= y) continue;
          const start = rect.x - w;
          const end = rect.x + rect.w;
          if (end <= next) continue;
          if (start >= next) consider(next, Math.min(start, limitX));
          next = end;
          if (next > limitX) break;
        }
        if (next <= limitX) consider(next, limitX);
      }
      return best;
    }
    const normal = free(full);
    if (normal && (!normal.score[0] || compact === full)) return normal.box;
    const short = compact === full ? normal : free(compact);
    if (normal || short) return short && (!normal || short.score[0] < normal.score[0]) ? short.box : normal.box;

    // Dense view: protect the controls and selection before scoring obstruction of other nodes.
    // Sample their remaining obstacle boundaries only in this fallback, not during the free-space sweep.
    const critical = visible.filter(rect => order[rect.kind] <= 1);
    const stride = Math.max(1, Math.ceil(visible.length / 12));
    const sample = [...critical, ...visible.filter((_, i) => i % stride === 0)];
    const h = compact;
    let best;
    for (const y of positions(area.y, area.y + area.h - h, pin.y, previous?.y, h, sample, "h", "y")) {
      const row = visible.filter(rect => rect.y < y + h && y < rect.y + rect.h);
      for (const x of positions(area.x, limitX, pin.x, previous?.x, w, sample, "w", "x")) {
        const box = { x, y, w, h };
        const score = [0, 0, 0, 0];
        for (const rect of row) score[order[rect.kind]] += overlapArea(box, rect);
        score.push(...closeness(box));
        if (better(score, best?.score)) best = { box, score };
      }
    }
    return best.box;
  }

  function fitWindow(rect, area) {
    const w = Math.min(area.w, Math.max(224, rect.w));
    const h = Math.min(area.h, Math.max(128, rect.h));
    return { x: clamp(rect.x, area.x, area.x + area.w - w), y: clamp(rect.y, area.y, area.y + area.h - h), w, h };
  }

  function unprojectWindow(rect, camera) {
    return { x: (rect.x - camera.x) / camera.k, y: (rect.y - camera.y) / camera.k,
      w: rect.w / camera.k, h: rect.h / camera.k };
  }

  function unionBounds(a, b) {
    if (!b) return a;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }

  function adjustWindow(rect, minimum, edge, dx, dy, k) {
    dx /= k;
    dy /= k;
    if (edge === "move") return { ...rect, x: rect.x + dx, y: rect.y + dy };
    let { x, y, w, h } = rect;
    if (edge.includes("w")) {
      w = Math.max(minimum.w, rect.w - dx);
      x = rect.x + rect.w - w;
    } else if (edge.includes("e")) w = Math.max(minimum.w, rect.w + dx);
    if (edge.includes("n")) {
      h = Math.max(minimum.h, rect.h - dy);
      y = rect.y + rect.h - h;
    } else if (edge.includes("s")) h = Math.max(minimum.h, rect.h + dy);
    return { x, y, w, h };
  }

  const api = { layout, fitCamera, zoomCamera, clamp, overlapArea, findCardPlacement, fitWindow,
    unprojectWindow, unionBounds, adjustWindow };
  if (typeof module !== "undefined") module.exports = api;
  else window.HarvestGraph = api;
})();
