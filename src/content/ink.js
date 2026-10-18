// Ink engine: pointer sampling with smoothing + pressure, variable-width pen outlines,
// highlighter strokes, shape geometry and eraser hit-testing. Pure geometry, no DOM.
(() => {
  const lerp = (a, b, t) => a + (b - a) * t;
  const r2 = n => Math.round(n * 100) / 100;
  const clampP = p => (p > 0 ? Math.min(1, Math.max(0.05, p)) : 0.5);
  const fmt = p => `${r2(p[0])},${r2(p[1])}`;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  // Collects raw pointer samples into smoothed [x, y, pressure] points.
  // Mice/touch have no pressure, so it is simulated from speed (fast = thinner).
  class StrokeBuilder {
    constructor({ size, simulatePressure, streamline = 0.3 }) {
      this.size = size;
      this.sim = simulatePressure;
      this.streamline = streamline;
      this.points = [];
      this.last = null;
    }

    add(x, y, pressure) {
      const pts = this.points;
      if (!pts.length) {
        pts.push([r2(x), r2(y), this.sim ? 0.5 : clampP(pressure)]);
        this.last = [x, y];
        return;
      }
      const t = 1 - this.streamline;
      const nx = lerp(this.last[0], x, t);
      const ny = lerp(this.last[1], y, t);
      const d = Math.hypot(nx - this.last[0], ny - this.last[1]);
      if (d < 0.6) return;
      const lp = pts[pts.length - 1][2];
      let p;
      if (this.sim) {
        const speed = Math.min(1, d / (this.size * 6));
        p = lerp(lp, 1 - speed, 0.3);
      } else {
        p = lerp(lp, clampP(pressure), 0.5);
      }
      pts.push([r2(nx), r2(ny), r2(p)]);
      this.last = [nx, ny];
    }

    // Lands the stroke exactly where the pointer was lifted.
    finish(x, y) {
      const l = this.points[this.points.length - 1];
      if (l && Math.hypot(l[0] - x, l[1] - y) > 0.6) this.points.push([r2(x), r2(y), l[2]]);
      return this.points;
    }
  }

  function closedSmoothPath(loop) {
    const n = loop.length;
    let d = `M${fmt(mid(loop[0], loop[1]))}`;
    for (let i = 1; i <= n; i++) {
      const p = loop[i % n];
      d += `Q${fmt(p)} ${fmt(mid(p, loop[(i + 1) % n]))}`;
    }
    return d + 'Z';
  }

  function circlePath(x, y, r) {
    return `M${r2(x - r)},${r2(y)}a${r2(r)},${r2(r)} 0 1,0 ${r2(2 * r)},0a${r2(r)},${r2(r)} 0 1,0 ${r2(-2 * r)},0Z`;
  }

  // Filled outline of a pressure-sensitive pen stroke, with round caps.
  function penPath(pts, size, thinning = 0.5) {
    const n = pts.length;
    if (!n) return '';
    const rad = p => Math.max(0.4, (size / 2) * (1 + thinning * (p * 2 - 1)));
    let length = 0;
    for (let i = 1; i < n; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (n === 1 || length < 1) return circlePath(pts[0][0], pts[0][1], rad(pts[0][2]));

    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0];
      let dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const r = rad(pts[i][2]);
      const [x, y] = pts[i];
      left.push([x - dy * r, y + dx * r]);
      right.push([x + dy * r, y - dx * r]);
    }

    // Half-circle around point c, bulging away from `from`. Pointing it backwards at the
    // tail flips both tangent and normal, so the same sweep connects right[0] -> left[0].
    const cap = (c, from) => {
      let tx = c[0] - from[0];
      let ty = c[1] - from[1];
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      const r = rad(c[2]);
      const out = [];
      for (let k = 1; k < 8; k++) {
        const th = (k * Math.PI) / 8;
        out.push([c[0] + r * (-ty * Math.cos(th) + tx * Math.sin(th)), c[1] + r * (tx * Math.cos(th) + ty * Math.sin(th))]);
      }
      return out;
    };
    const endCap = cap(pts[n - 1], pts[n - 2]);
    const startCap = cap(pts[0], pts[1]);
    return closedSmoothPath([...left, ...endCap, ...right.reverse(), ...startCap]);
  }

  // Centre-line path for the translucent highlighter (rendered as a wide round stroke).
  function markerPath(pts) {
    const n = pts.length;
    if (!n) return '';
    if (n === 1) return `M${fmt(pts[0])}l0.01,0`;
    let d = `M${fmt(pts[0])}`;
    for (let i = 1; i < n - 1; i++) d += `Q${fmt(pts[i])} ${fmt(mid(pts[i], pts[i + 1]))}`;
    return d + `L${fmt(pts[n - 1])}`;
  }

  function arrowPath(x1, y1, x2, y2, size) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const L = Math.max(10, size * 4);
    const s = Math.PI / 7;
    const h1 = [x2 - L * Math.cos(a - s), y2 - L * Math.sin(a - s)];
    const h2 = [x2 - L * Math.cos(a + s), y2 - L * Math.sin(a + s)];
    return `M${fmt([x1, y1])}L${fmt([x2, y2])}M${fmt(h1)}L${fmt([x2, y2])}L${fmt(h2)}`;
  }

  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function polyHit(pts, x, y, tol) {
    if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= tol;
    for (let i = 1; i < pts.length; i++) {
      if (segDist(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= tol) return true;
    }
    return false;
  }

  // Does an eraser of radius r at (x, y) touch this item? (text boxes are hit-tested via the DOM)
  function hit(item, x, y, r) {
    const tol = r + (item.size || 2) / 2;
    const { x1, y1, x2, y2 } = item;
    switch (item.kind) {
      case 'pen':
      case 'marker':
        return polyHit(item.pts, x, y, tol);
      case 'line':
      case 'arrow':
        return segDist(x, y, x1, y1, x2, y2) <= tol;
      case 'rect':
        return polyHit([[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]], x, y, tol);
      case 'ellipse': {
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;
        const pts = [];
        for (let k = 0; k <= 48; k++) {
          const t = (k / 48) * Math.PI * 2;
          pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
        }
        return polyHit(pts, x, y, tol);
      }
      default:
        return false;
    }
  }

  globalThis.CFNInk = { StrokeBuilder, penPath, markerPath, arrowPath, hit };
})();
