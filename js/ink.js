// Stroke model and rendering. Rendering functions expect ctx to map page mm → device px
// (scale + translate only).
import { STRIDE, pointCount, computeBounds } from './geometry.js';

export const SIZES = {
  pencil: [0.35, 0.6, 1.0], // base line width in mm
  pen: [0.35, 0.55, 0.9],
  eraser: [1.5, 3.5, 8], // eraser radius in mm
};
export const SIZE_LABELS = ['Dünn', 'Mittel', 'Dick'];

export const COLORS = [
  { id: 'graphite', name: 'Graphit', value: '#4F5056' },
  { id: 'black', name: 'Schwarz', value: '#1C1C1E' },
  { id: 'blue', name: 'Dunkelblau', value: '#1F3A78' },
  { id: 'red', name: 'Rot', value: '#B3261E' },
  { id: 'green', name: 'Grün', value: '#2D6A3B' },
];
export const colorValue = (id) => (COLORS.find((c) => c.id === id) || COLORS[1]).value;

/** Maps raw pointer pressure to 0..1 with a curve tuned for normal handwriting (~0.3 → ~0.5). */
export function normPressure(p, pointerType) {
  if (pointerType !== 'pen' || !(p > 0)) return 0.5;
  return Math.min(1, Math.pow(p, 0.7) * 1.15);
}

/** 0 for a normal writing angle, rising to 1 when the pencil lies almost flat (shading). */
export function tiltAmount(e) {
  let altitude = e.altitudeAngle;
  if (typeof altitude !== 'number') {
    const tx = Math.tan(((e.tiltX || 0) * Math.PI) / 180);
    const ty = Math.tan(((e.tiltY || 0) * Math.PI) / 180);
    const r = Math.hypot(tx, ty);
    altitude = r === 0 ? Math.PI / 2 : Math.atan(1 / r);
  }
  const incline = 1 - altitude / (Math.PI / 2);
  return Math.min(1, Math.max(0, (incline - 0.5) / 0.4));
}

export function widthAt(stroke, p, t) {
  if (stroke.tool === 'pen') return stroke.width * (0.8 + 0.4 * p);
  if (stroke.tool === 'pencil') return stroke.width * (0.55 + 0.9 * p) * (1 + 3 * t);
  return stroke.width;
}

export function maxWidth(stroke) {
  if (stroke.tool === 'pen') return stroke.width * 1.2;
  if (stroke.tool === 'pencil') return stroke.width * 1.45 * 4;
  return stroke.width;
}

export function pencilAlpha(pts) {
  const n = pointCount(pts);
  if (!n) return 0.7;
  let p = 0, t = 0;
  for (let i = 0; i < pts.length; i += STRIDE) { p += pts[i + 2]; t += pts[i + 3]; }
  return (0.42 + 0.55 * (p / n)) * (1 - 0.4 * (t / n));
}

/**
 * Smoothed variable-width path: quadratic curves through the midpoints between samples,
 * with consecutive segments of (nearly) equal width batched into one path.
 */
function drawVariable(ctx, stroke, pts) {
  const n = pointCount(pts);
  if (n === 0) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (n === 1 || (n === 2 && pts[0] === pts[STRIDE] && pts[1] === pts[STRIDE + 1])) {
    const w = widthAt(stroke, pts[2], pts[3]);
    ctx.beginPath();
    ctx.arc(pts[0], pts[1], w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const q = stroke.width * 0.04;
  let curW = -1;
  let sx = pts[0], sy = pts[1];
  for (let k = 0; k < n; k++) {
    const i = k * STRIDE;
    const last = k === n - 1;
    const ex = last ? pts[i] : (pts[i] + pts[i + STRIDE]) / 2;
    const ey = last ? pts[i + 1] : (pts[i + 1] + pts[i + STRIDE + 1]) / 2;
    const w = Math.max(q, Math.round(widthAt(stroke, pts[i + 2], pts[i + 3]) / q) * q);
    if (w !== curW) {
      if (curW > 0) ctx.stroke();
      ctx.beginPath();
      ctx.lineWidth = w;
      ctx.moveTo(sx, sy);
      curW = w;
    }
    if (k === 0) ctx.lineTo(ex, ey);
    else ctx.quadraticCurveTo(pts[i], pts[i + 1], ex, ey);
    sx = ex;
    sy = ey;
  }
  ctx.stroke();
}

// ---- Pencil grain -------------------------------------------------------------------

const GRAIN_MM = 0.07; // size of one grain cell on the paper
let scratch = null, sctx = null, grain = null;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function grainPattern() {
  if (grain) return grain;
  const N = 96;
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < N * N; i++) {
    const r = rnd();
    // Mostly dense graphite with some "paper tooth" gaps.
    const a = r < 0.1 ? 0.12 + r : 0.55 + 0.45 * rnd();
    img.data[i * 4 + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  grain = g.createPattern(c, 'repeat');
  return grain;
}

function getScratch(w, h) {
  if (!scratch) {
    scratch = makeCanvas(Math.max(w, 256), Math.max(h, 256));
    sctx = scratch.getContext('2d');
  } else if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, w);
    scratch.height = Math.max(scratch.height, h);
  }
  return sctx;
}

/** Pencil: opaque shape on a scratch canvas, masked by grain, composited with pressure-based alpha. */
function renderPencil(ctx, stroke, pts) {
  const m = ctx.getTransform();
  const b = computeBounds(pts);
  const pad = maxWidth(stroke) / 2 + 0.3;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const x0 = Math.max(0, Math.floor(m.a * (b.minX - pad) + m.e));
  const y0 = Math.max(0, Math.floor(m.d * (b.minY - pad) + m.f));
  const x1 = Math.min(cw, Math.ceil(m.a * (b.maxX + pad) + m.e));
  const y1 = Math.min(ch, Math.ceil(m.d * (b.maxY + pad) + m.f));
  if (x1 <= x0 || y1 <= y0) return;
  const w = x1 - x0, h = y1 - y0;
  const s = getScratch(w, h);
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = 'source-over';
  s.globalAlpha = 1;
  s.clearRect(0, 0, w, h);
  s.setTransform(m.a, 0, 0, m.d, m.e - x0, m.f - y0);
  s.strokeStyle = s.fillStyle = stroke.color;
  drawVariable(s, stroke, pts);
  s.globalCompositeOperation = 'destination-in';
  const pat = grainPattern();
  pat.setTransform(new DOMMatrix([GRAIN_MM, 0, 0, GRAIN_MM, 0, 0]));
  s.fillStyle = pat;
  s.fillRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad);
  s.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= pencilAlpha(pts);
  ctx.drawImage(scratch, 0, 0, w, h, x0, y0, w, h);
  ctx.restore();
}

export function renderStroke(ctx, stroke, pts = stroke.pts) {
  if (!pts.length) return;
  if (stroke.tool === 'pencil') return renderPencil(ctx, stroke, pts);
  ctx.save();
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = ctx.fillStyle = '#000';
  } else {
    ctx.strokeStyle = ctx.fillStyle = stroke.color;
  }
  drawVariable(ctx, stroke, pts);
  ctx.restore();
}

/** Draws one segment of a pixel-eraser stroke (used live while erasing). */
export function eraseSegment(ctx, x0, y0, x1, y1, width) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}
