// Unit tests for the DOM-free modules. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBounds, hitPolyline, distSqToSegment, sampleSegment, boundsIntersect } from '../js/geometry.js';
import { History } from '../js/history.js';
import { fitView, clampView, zoomAround, pinchView, toPage, scaleLimits, fitScale, PAD } from '../js/view.js';
import { paperLines, PAGE_W, PAGE_H } from '../js/paper.js';
import { normPressure, tiltAmount, widthAt, pencilAlpha } from '../js/ink.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const pts = (...xy) => xy.flatMap(([x, y]) => [x, y, 0.5, 0]);

test('bounds and hit testing', () => {
  const p = pts([0, 0], [10, 0], [10, 10]);
  assert.deepEqual(computeBounds(p), { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  assert.ok(hitPolyline(p, 5, 0.9, 1));
  assert.ok(!hitPolyline(p, 5, 1.1, 1));
  assert.ok(hitPolyline(p, 10.5, 5, 0.6));
  assert.ok(hitPolyline(pts([3, 3]), 3.5, 3, 0.6), 'single-point stroke');
  assert.ok(!hitPolyline([], 0, 0, 10));
  close(distSqToSegment(0, 5, -1, 0, 1, 0), 25);
  close(distSqToSegment(3, 0, -1, 0, 1, 0), 4);
  assert.ok(boundsIntersect({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { minX: 1.5, minY: 0, maxX: 2, maxY: 1 }, 0.6));
  assert.ok(!boundsIntersect({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { minX: 1.5, minY: 0, maxX: 2, maxY: 1 }, 0.4));
});

test('sampleSegment covers fast eraser moves', () => {
  const s = sampleSegment(0, 0, 10, 0, 1);
  assert.equal(s.length, 10);
  assert.deepEqual(s.at(-1), [10, 0]);
  assert.equal(sampleSegment(0, 0, 0, 0, 1).length, 1);
});

test('history: add, stroke-erase, undo, redo keep order', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  const strokes = [];
  const h = new History();
  for (const s of [a, b, c]) { strokes.push(s); h.push({ type: 'add', stroke: s }); }
  // Erase a then c (indices at removal time).
  strokes.splice(0, 1); strokes.splice(1, 1);
  h.push({ type: 'remove', items: [{ stroke: a, index: 0 }, { stroke: c, index: 1 }] });
  assert.deepEqual(strokes.map((s) => s.id), ['b']);
  h.undo(strokes);
  assert.deepEqual(strokes.map((s) => s.id), ['a', 'b', 'c']);
  h.redo(strokes);
  assert.deepEqual(strokes.map((s) => s.id), ['b']);
  h.undo(strokes); h.undo(strokes);
  assert.deepEqual(strokes.map((s) => s.id), ['a', 'b']);
  assert.ok(h.canRedo);
  strokes.push({ id: 'd' }); h.push({ type: 'add', stroke: strokes.at(-1) });
  assert.ok(!h.canRedo, 'new action clears redo');
  while (h.undo(strokes));
  assert.deepEqual(strokes, []);
  assert.equal(h.undo(strokes), false);
});

test('history limit', () => {
  const h = new History(3);
  for (let i = 0; i < 5; i++) h.push({ type: 'add', stroke: { id: i } });
  assert.equal(h.undoStack.length, 3);
});

test('view: fit, clamp, zoom, pinch', () => {
  const vw = 820, vh = 1000;
  const v = fitView(vw, vh);
  close(v.s, (vw - 2 * PAD) / PAGE_W);
  close(v.tx, PAD);
  close(v.ty, PAD);
  // Cannot scroll above the page top or far beyond the bottom.
  close(clampView({ ...v, ty: 500 }, vw, vh).ty, PAD);
  assert.ok(clampView({ ...v, ty: -1e6 }, vw, vh).ty > -PAGE_H * v.s);
  // Zoom keeps the anchor point fixed.
  const z = zoomAround(v, v.s * 2, 300, 400);
  const [a, b] = toPage(v, 300, 400), [c, d] = toPage(z, 300, 400);
  close(a, c); close(b, d);
  // Pinch: spreading fingers doubles the scale (within limits), midpoint stays on the same page point.
  const p = pinchView(v, { x: 300, y: 400 }, { x: 400, y: 400 }, { x: 250, y: 400 }, { x: 450, y: 400 }, vw, vh);
  close(p.s, v.s * 2);
  const [e, f] = toPage(p, 350, 400), [g, k] = toPage(v, 350, 400);
  close(e, g); close(f, k);
  // Limits
  const { min, max } = scaleLimits(vw, vh);
  const huge = pinchView(v, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 }, vw, vh);
  close(huge.s, max);
  assert.ok(min < fitScale(vw));
  // Small page (zoomed out) is centred.
  const small = clampView({ s: min, tx: 0, ty: 0 }, vw, vh);
  close(small.tx, (vw - PAGE_W * min) / 2);
});

test('paper lines', () => {
  const grid = paperLines({ type: 'grid' });
  assert.equal(grid.v.length, 41);
  for (let i = 1; i < grid.v.length; i++) close(grid.v[i] - grid.v[i - 1], 5);
  close(grid.h[0], (PAGE_H - 5 * Math.floor(PAGE_H / 5)) / 2);
  assert.ok(grid.h.at(-1) < PAGE_H);
  assert.equal(grid.margin, null);
  const lined = paperLines({ type: 'lined', margin: true });
  assert.equal(lined.v.length, 0);
  assert.equal(lined.margin, 25);
  for (let i = 1; i < lined.h.length; i++) assert.equal(lined.h[i] - lined.h[i - 1], 8);
  assert.equal(paperLines({ type: 'lined', margin: false }).margin, null);
});

test('pressure, tilt, width', () => {
  assert.equal(normPressure(0.7, 'mouse'), 0.5);
  assert.equal(normPressure(0, 'pen'), 0.5);
  close(normPressure(0.3, 'pen'), Math.pow(0.3, 0.7) * 1.15);
  assert.equal(normPressure(1, 'pen'), 1);
  assert.ok(normPressure(0.2, 'pen') < normPressure(0.6, 'pen'));
  assert.equal(tiltAmount({ tiltX: 0, tiltY: 0 }), 0);
  assert.equal(tiltAmount({ tiltX: 30, tiltY: 0 }), 0, 'normal writing angle: no shading');
  assert.ok(tiltAmount({ tiltX: 80, tiltY: 0 }) > 0.5);
  assert.ok(tiltAmount({ altitudeAngle: 0.1 }) > 0.9);
  const pen = { tool: 'pen', width: 0.5 };
  close(widthAt(pen, 0.5, 0), 0.5);
  assert.ok(widthAt(pen, 1, 0) / widthAt(pen, 0, 0) < 1.6, 'pen varies only slightly');
  const pencil = { tool: 'pencil', width: 0.5 };
  assert.ok(widthAt(pencil, 1, 0) / widthAt(pencil, 0, 0) > 2, 'pencil varies strongly');
  assert.ok(widthAt(pencil, 0.5, 1) > 3 * widthAt(pencil, 0.5, 0), 'tilted pencil shades wide');
  assert.ok(pencilAlpha([0, 0, 1, 0]) > pencilAlpha([0, 0, 0.1, 0]));
});
