// Pure geometry helpers for strokes. Points are flat arrays: x, y, pressure, tilt.

export const STRIDE = 4;

export function pointCount(pts) {
  return Math.floor(pts.length / STRIDE);
}

export function computeBounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += STRIDE) {
    const x = pts[i], y = pts[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

const boundsCache = new WeakMap();

/** Bounds of a finished stroke (cached; finished strokes are immutable). */
export function strokeBounds(stroke) {
  let b = boundsCache.get(stroke);
  if (!b) {
    b = computeBounds(stroke.pts);
    boundsCache.set(stroke, b);
  }
  return b;
}

export function boundsIntersect(a, b, pad = 0) {
  return !(a.maxX + pad < b.minX || a.minX - pad > b.maxX || a.maxY + pad < b.minY || a.minY - pad > b.maxY);
}

export function distSqToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** True if the circle (x, y, r) touches the polyline of pts. */
export function hitPolyline(pts, x, y, r) {
  const n = pointCount(pts);
  if (n === 0) return false;
  const r2 = r * r;
  if (n === 1) {
    const dx = pts[0] - x, dy = pts[1] - y;
    return dx * dx + dy * dy <= r2;
  }
  for (let i = 0; i < (n - 1) * STRIDE; i += STRIDE) {
    if (distSqToSegment(x, y, pts[i], pts[i + 1], pts[i + STRIDE], pts[i + STRIDE + 1]) <= r2) return true;
  }
  return false;
}

/** Samples along a segment so a fast-moving eraser does not skip strokes. */
export function sampleSegment(x0, y0, x1, y1, step) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d / step));
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
  }
  return out;
}
