// Notebook page editor: canvas layers, Apple Pencil drawing, finger pan/zoom, tools, pages.
import * as db from './db.js';
import { PAGE_W, PAGE_H, DESK_COLOR, drawPaper } from './paper.js';
import { SIZES, SIZE_LABELS, COLORS, colorValue, normPressure, tiltAmount, renderStroke, eraseSegment } from './ink.js';
import { STRIDE, strokeBounds, boundsIntersect, hitPolyline, sampleSegment } from './geometry.js';
import { History } from './history.js';
import { fitView, fitScale, clampView, clampScale, zoomAround, pinchView, toPage } from './view.js';
import { confirmDialog } from './dialog.js';
import { ICONS } from './icons.js';
import { nextFrame, uid } from './util.js';

const SAVE_DELAY = 600;
const PALM_SIZE = 44; // touch contact (CSS px) from which a touch counts as palm
const PEN_GRACE = 600; // ms after pen-up in which a single finger does not pan
const PAN_REVERT = 400; // a pan younger than this is undone when the pen lands
const MIN_STEP_PX = 0.5; // minimum pointer travel between stored points
const CACHE_SCALE = 6; // px per mm of the low-res ink bitmap used during gestures
const SLOW_RENDER_MS = 10; // above this, gestures use the cached bitmap
const SETTINGS_KEY = 'notizbuch.werkzeug';

const DEFAULT_SETTINGS = {
  tool: 'pencil',
  size: { pencil: 1, pen: 1, eraser: 1 },
  color: { pencil: 'graphite', pen: 'black' },
  eraserMode: 'stroke',
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s && s.size && s.color) return { ...DEFAULT_SETTINGS, ...s };
  } catch { /* ignore */ }
  return structuredClone(DEFAULT_SETTINGS);
}

export class Editor {
  constructor(root) {
    this.root = root;
    this.stage = root.querySelector('#stage');
    this.canvases = ['paper', 'ink', 'live'].map((id) => root.querySelector(`#cv-${id}`));
    this.paperCtx = this.canvases[0].getContext('2d', { alpha: false });
    this.inkCtx = this.canvases[1].getContext('2d');
    // desynchronized lowers latency where supported (falls back silently elsewhere).
    this.liveCtx = this.canvases[2].getContext('2d', { desynchronized: true });

    this.settings = loadSettings();
    this.histories = new Map();
    this.strokes = [];
    this.touches = new Map();
    this.ignoredTouches = new Set();
    this.gesture = null;
    this.drawing = null;
    this.hover = null;
    this.penUpAt = 0;
    this.needs = { paper: false, ink: false, live: false };
    this.moving = false;
    this.lastInkMs = 0;
    this.cache = null;
    this.cacheValid = false;
    this.saveTimer = 0;
    this.dirty = false;

    this.buildToolbar();
    this.bindInput();
    new ResizeObserver(() => this.isOpen && this.resize()).observe(this.stage);
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => document.hidden && this.flush());
  }

  // ---------------------------------------------------------------- open / close / pages

  async open(notebookId, pageIndex = 0) {
    const nb = await db.getNotebook(notebookId);
    if (!nb) return false;
    if (this.nb?.id !== nb.id) this.histories.clear();
    this.nb = nb;
    this.isOpen = true;
    this.root.querySelector('#nb-title').textContent = nb.name;
    this.view = null;
    this.resize();
    await this.showPage(pageIndex);
    return true;
  }

  async close() {
    if (!this.isOpen) return;
    await this.flush();
    this.isOpen = false;
    this.closeOverview();
    this.nb = null;
    this.strokes = [];
  }

  get history() {
    const id = this.page?.id;
    if (!this.histories.has(id)) this.histories.set(id, new History());
    return this.histories.get(id);
  }

  async showPage(index) {
    await this.flush();
    index = Math.max(0, Math.min(this.nb.pageIds.length - 1, index | 0));
    let page = await db.getPage(this.nb.pageIds[index]);
    if (!page) {
      // Self-heal a missing page record instead of failing.
      page = db.newPage(this.nb.id);
      this.nb.pageIds[index] = page.id;
      await db.savePage(page, this.nb);
    }
    this.pageIdx = index;
    this.page = page;
    this.strokes = page.strokes || [];
    this.cacheValid = false;
    this.view = fitView(this.vw, this.vh);
    window.history.replaceState(null, '', `#/nb/${this.nb.id}/${index + 1}`);
    this.updatePagebar();
    this.updateUndo();
    this.invalidate('paper', 'ink', 'live');
  }

  async addPage(atEnd = false) {
    await this.flush();
    const page = db.newPage(this.nb.id);
    const at = atEnd ? this.nb.pageIds.length : this.pageIdx + 1;
    this.nb.pageIds.splice(at, 0, page.id);
    this.nb.updatedAt = Date.now();
    await db.savePage(page, this.nb);
    await this.showPage(at);
  }

  async deletePage(index) {
    if (this.nb.pageIds.length <= 1) return false;
    const ok = await confirmDialog({ title: `Seite ${index + 1} löschen?`, message: 'Die Seite wird endgültig entfernt.' });
    if (!ok) return false;
    await this.flush();
    const [id] = this.nb.pageIds.splice(index, 1);
    this.histories.delete(id);
    this.nb.updatedAt = Date.now();
    await db.deletePage(id, this.nb);
    const next = index < this.pageIdx || this.pageIdx >= this.nb.pageIds.length ? this.pageIdx - 1 : this.pageIdx;
    if (id === this.page.id || next !== this.pageIdx) await this.showPage(Math.max(0, next));
    else this.updatePagebar();
    return true;
  }

  // ---------------------------------------------------------------- saving

  scheduleSave() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY);
  }

  async flush() {
    clearTimeout(this.saveTimer);
    if (!this.dirty || !this.page) return;
    this.dirty = false;
    const now = Date.now();
    this.page.strokes = this.strokes;
    this.page.updatedAt = now;
    this.nb.updatedAt = now;
    try {
      await db.savePage(this.page, this.nb);
    } catch (err) {
      this.dirty = true;
      console.error('Speichern fehlgeschlagen', err);
    }
  }

  // ---------------------------------------------------------------- layout & rendering

  resize() {
    const r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const old = this.view && { v: this.view, vw: this.vw, vh: this.vh };
    this.rect = r;
    this.vw = r.width;
    this.vh = r.height;
    this.dpr = window.devicePixelRatio || 1;
    for (const c of this.canvases) {
      c.width = Math.round(this.vw * this.dpr);
      c.height = Math.round(this.vh * this.dpr);
      c.style.width = `${this.vw}px`;
      c.style.height = `${this.vh}px`;
    }
    if (old) {
      // Keep the relative zoom and the page point at the top centre (e.g. on rotation).
      const ratio = old.v.s / fitScale(old.vw);
      const [px, py] = toPage(old.v, old.vw / 2, 0);
      const s = clampScale(fitScale(this.vw) * ratio, this.vw, this.vh);
      this.view = clampView({ s, tx: this.vw / 2 - px * s, ty: -py * s }, this.vw, this.vh);
    } else {
      this.view = fitView(this.vw, this.vh);
    }
    this.invalidate('paper', 'ink', 'live');
  }

  invalidate(...what) {
    for (const w of what) this.needs[w] = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  frame() {
    this.raf = 0;
    if (!this.isOpen || !this.page) return;
    const n = this.needs;
    if (n.paper) this.renderPaper();
    if (n.ink) {
      if (this.moving && this.lastInkMs > SLOW_RENDER_MS) this.drawCache();
      else this.renderInk();
    }
    if (n.live) this.renderLive();
    this.needs = { paper: false, ink: false, live: false };
  }

  /** Sets ctx to map page mm → device pixels. */
  pageTransform(ctx) {
    const { s, tx, ty } = this.view;
    const d = this.dpr;
    ctx.setTransform(s * d, 0, 0, s * d, tx * d, ty * d);
  }

  renderPaper() {
    const c = this.paperCtx;
    const d = this.dpr, { s, tx, ty } = this.view;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = DESK_COLOR;
    c.fillRect(0, 0, c.canvas.width, c.canvas.height);
    const x = tx * d, y = ty * d, w = PAGE_W * s * d, h = PAGE_H * s * d;
    // Soft shadow from a few translucent rects (cheaper than shadowBlur on every gesture frame).
    for (let i = 1; i <= 4; i++) {
      const e = i * d;
      c.fillStyle = `rgba(70, 58, 40, ${0.05 - i * 0.009})`;
      c.fillRect(x - e, y - e + d, w + 2 * e, h + 2 * e);
    }
    drawPaper(c, { type: this.nb.paper, margin: this.nb.margin }, s * d, x, y);
  }

  visibleBounds() {
    const [x0, y0] = toPage(this.view, 0, 0);
    const [x1, y1] = toPage(this.view, this.vw, this.vh);
    return { minX: x0, minY: y0, maxX: x1, maxY: y1 };
  }

  clipToPage(ctx) {
    ctx.beginPath();
    ctx.rect(0, 0, PAGE_W, PAGE_H);
    ctx.clip();
  }

  renderInk() {
    const t0 = performance.now();
    const c = this.inkCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.save();
    this.pageTransform(c);
    this.clipToPage(c);
    const vis = this.visibleBounds();
    for (const st of this.strokes) {
      if (boundsIntersect(strokeBounds(st), vis, st.width * 3)) renderStroke(c, st);
    }
    c.restore();
    this.lastInkMs = performance.now() - t0;
    // A pixel-eraser stroke in progress is not in this.strokes yet: re-apply it.
    if (this.drawing) this.drawing.erasedUpTo = 0;
  }

  ensureCache() {
    if (!this.cache) {
      const cv = document.createElement('canvas');
      cv.width = Math.round(PAGE_W * CACHE_SCALE);
      cv.height = Math.round(PAGE_H * CACHE_SCALE);
      this.cache = cv.getContext('2d');
    }
    if (!this.cacheValid) {
      const c = this.cache;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, c.canvas.width, c.canvas.height);
      c.setTransform(CACHE_SCALE, 0, 0, CACHE_SCALE, 0, 0);
      for (const st of this.strokes) renderStroke(c, st);
      this.cacheValid = true;
    }
  }

  drawCache() {
    this.ensureCache();
    const c = this.inkCtx, d = this.dpr, { s, tx, ty } = this.view;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.drawImage(this.cache.canvas, tx * d, ty * d, PAGE_W * s * d, PAGE_H * s * d);
  }

  /** Adds a finished stroke to the visible ink and the cache without a full redraw. */
  paintStroke(st) {
    const c = this.inkCtx;
    c.save();
    this.pageTransform(c);
    this.clipToPage(c);
    renderStroke(c, st);
    c.restore();
    if (this.cache && this.cacheValid) {
      this.cache.setTransform(CACHE_SCALE, 0, 0, CACHE_SCALE, 0, 0);
      renderStroke(this.cache, st);
    }
  }

  renderLive() {
    const c = this.liveCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    const d = this.drawing;
    if (d && d.stroke.tool !== 'eraser' && !d.strokeErase) {
      c.save();
      this.pageTransform(c);
      this.clipToPage(c);
      const pts = d.predicted.length ? d.pts.concat(d.predicted) : d.pts;
      renderStroke(c, d.stroke, pts);
      c.restore();
    }
    if (d && d.stroke.tool === 'eraser' && !d.strokeErase) this.applyLiveErase();
    const cur = (d && d.cursor) || this.hover;
    if (cur && this.settings.tool === 'eraser') {
      const r = SIZES.eraser[this.settings.size.eraser] * this.view.s * this.dpr;
      c.beginPath();
      c.arc(cur[0] * this.dpr, cur[1] * this.dpr, Math.max(r, 3), 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fill();
      c.lineWidth = this.dpr;
      c.strokeStyle = 'rgba(40,50,64,0.6)';
      c.stroke();
    }
  }

  /** Pixel eraser: cut the newly added segments directly out of the ink layer. */
  applyLiveErase(d = this.drawing) {
    const pts = d.pts;
    const c = this.inkCtx;
    c.save();
    this.pageTransform(c);
    this.clipToPage(c);
    let i = d.erasedUpTo;
    if (i === 0 && pts.length) eraseSegment(c, pts[0], pts[1], pts[0], pts[1], d.stroke.width);
    for (; i + STRIDE < pts.length; i += STRIDE) {
      eraseSegment(c, pts[i], pts[i + 1], pts[i + STRIDE], pts[i + STRIDE + 1], d.stroke.width);
    }
    d.erasedUpTo = i;
    c.restore();
  }

  // ---------------------------------------------------------------- input

  bindInput() {
    const s = this.stage;
    s.addEventListener('pointerdown', (e) => this.onDown(e));
    s.addEventListener('pointermove', (e) => this.onMove(e));
    s.addEventListener('pointerup', (e) => this.onUp(e));
    s.addEventListener('pointercancel', (e) => this.onUp(e, true));
    s.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch' && this.hover) { this.hover = null; this.invalidate('live'); }
    });
    // Belt and braces against iOS selection, magnifier, double-tap zoom and callouts.
    for (const t of ['touchstart', 'touchmove', 'gesturestart', 'gesturechange', 'contextmenu', 'selectstart', 'dblclick']) {
      s.addEventListener(t, (e) => e.preventDefault(), { passive: false });
    }
    s.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || document.querySelector('dialog[open]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? this.redo() : this.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      }
    });
  }

  local(e) {
    return [e.clientX - this.rect.left, e.clientY - this.rect.top];
  }

  onDown(e) {
    if (!this.page || this.overviewOpen) return;
    if (e.pointerType === 'touch') return this.touchDown(e);
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.penDown(e);
  }

  onMove(e) {
    if (e.pointerType === 'touch') return this.touchMove(e);
    if (this.drawing && e.pointerId === this.drawing.id) return this.penMove(e);
    // Hover (Apple Pencil hover / mouse): show the eraser outline before touching down.
    if (this.settings.tool === 'eraser' && !this.drawing) {
      this.hover = this.local(e);
      this.invalidate('live');
    }
  }

  onUp(e, cancelled = false) {
    if (e.pointerType === 'touch') return this.touchUp(e);
    if (this.drawing && e.pointerId === this.drawing.id) this.penUp(e, cancelled);
  }

  // -- Pencil

  penDown(e) {
    if (this.drawing) return;
    this.stopInertia();
    if (this.gesture) {
      // The palm or a finger touched shortly before the pencil: undo that accidental pan.
      if (performance.now() - this.gesture.start < PAN_REVERT) this.view = this.gesture.viewBefore;
      this.cancelGesture();
    }
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    const st = this.settings;
    const tool = st.tool;
    const strokeErase = tool === 'eraser' && st.eraserMode === 'stroke';
    const stroke = {
      id: uid(),
      tool,
      color: tool === 'eraser' ? null : colorValue(st.color[tool]),
      width: tool === 'eraser' ? SIZES.eraser[st.size.eraser] * 2 : SIZES[tool][st.size[tool]],
    };
    this.drawing = {
      id: e.pointerId, stroke, strokeErase, pts: [], predicted: [], removed: [],
      lastScreen: null, lastP: null, erasedUpTo: 0, cursor: null,
    };
    this.hover = null;
    this.addPoint(e);
    this.invalidate('live');
  }

  penMove(e) {
    const events = e.getCoalescedEvents?.() || [];
    for (const ev of events.length ? events : [e]) this.addPoint(ev);
    const d = this.drawing;
    d.predicted = [];
    if (!d.strokeErase && d.stroke.tool !== 'eraser' && e.getPredictedEvents) {
      for (const ev of e.getPredictedEvents()) {
        const [x, y] = toPage(this.view, ...this.local(ev));
        d.predicted.push(x, y, d.lastP ?? 0.5, tiltAmount(ev));
      }
    }
    this.invalidate('live');
  }

  addPoint(ev, force = false) {
    const d = this.drawing;
    const sp = this.local(ev);
    if (d.lastScreen && !force && Math.hypot(sp[0] - d.lastScreen[0], sp[1] - d.lastScreen[1]) < MIN_STEP_PX) return;
    const [x, y] = toPage(this.view, sp[0], sp[1]);
    d.cursor = sp;
    if (d.strokeErase) {
      const r = SIZES.eraser[this.settings.size.eraser];
      const prev = d.lastScreen ? toPage(this.view, ...d.lastScreen) : [x, y];
      for (const [px, py] of sampleSegment(prev[0], prev[1], x, y, r / 2)) this.eraseAt(px, py, r);
      d.lastScreen = sp;
      return;
    }
    let p = normPressure(ev.pressure, ev.pointerType);
    // Light smoothing so pressure noise does not make the width flicker.
    if (d.lastP !== null) p = d.lastP + (p - d.lastP) * 0.45;
    d.lastP = p;
    d.pts.push(x, y, p, ev.pointerType === 'pen' ? tiltAmount(ev) : 0);
    d.lastScreen = sp;
  }

  eraseAt(x, y, r) {
    const d = this.drawing;
    const probe = { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r };
    let changed = false;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const st = this.strokes[i];
      if (st.tool === 'eraser') continue;
      if (!boundsIntersect(strokeBounds(st), probe, st.width)) continue;
      if (hitPolyline(st.pts, x, y, r + st.width / 2)) {
        this.strokes.splice(i, 1);
        d.removed.push({ stroke: st, index: i });
        changed = true;
      }
    }
    if (changed) {
      this.cacheValid = false;
      this.invalidate('ink');
    }
  }

  penUp(e, cancelled) {
    const d = this.drawing;
    if (!cancelled && d.stroke.tool !== 'eraser') this.addPoint(e);
    this.drawing = null;
    this.penUpAt = performance.now();
    if (d.strokeErase) {
      if (d.removed.length) {
        this.history.push({ type: 'remove', items: d.removed });
        this.changed(false);
      }
    } else if (d.pts.length) {
      const st = d.stroke;
      st.pts = Float32Array.from(d.pts);
      if (st.tool === 'eraser') this.applyLiveErase(d);
      this.strokes.push(st);
      this.history.push({ type: 'add', stroke: st });
      if (st.tool === 'eraser') {
        // Ink already erased live; just keep the gesture cache in sync.
        if (this.cache && this.cacheValid) {
          this.cache.setTransform(CACHE_SCALE, 0, 0, CACHE_SCALE, 0, 0);
          renderStroke(this.cache, st);
        }
      } else {
        this.paintStroke(st);
      }
      this.changed(false);
    }
    if (e.pointerType !== 'touch' && this.settings.tool === 'eraser' && !cancelled) this.hover = d.cursor;
    this.invalidate('live');
  }

  // -- Fingers: pan & pinch zoom, never draw

  touchDown(e) {
    e.preventDefault();
    const big = e.width > PALM_SIZE && e.height > PALM_SIZE;
    if (this.drawing || big) {
      this.ignoredTouches.add(e.pointerId);
      return;
    }
    this.stopInertia();
    const [x, y] = this.local(e);
    this.touches.set(e.pointerId, { x, y });
    this.rebaseGesture(true);
  }

  rebaseGesture(added) {
    const now = performance.now();
    const pts = [...this.touches.values()].map((p) => ({ ...p }));
    const g = this.gesture;
    this.gesture = {
      start: g?.start ?? now,
      viewBefore: g?.viewBefore ?? { ...this.view },
      view0: { ...this.view },
      p0: pts,
      samples: [],
      // A lone finger right after writing is most likely the resting hand.
      blocked: pts.length === 1 && added && !g && now - this.penUpAt < PEN_GRACE,
    };
  }

  touchMove(e) {
    const t = this.touches.get(e.pointerId);
    if (!t || !this.gesture) return;
    [t.x, t.y] = this.local(e);
    const g = this.gesture;
    const pts = [...this.touches.values()];
    let v;
    if (pts.length === 1) {
      if (g.blocked) return;
      const p0 = g.p0[0];
      v = clampView({ s: g.view0.s, tx: g.view0.tx + t.x - p0.x, ty: g.view0.ty + t.y - p0.y }, this.vw, this.vh);
      g.samples.push({ t: e.timeStamp, x: t.x, y: t.y });
      if (g.samples.length > 8) g.samples.shift();
    } else {
      v = pinchView(g.view0, g.p0[0], g.p0[1], pts[0], pts[1], this.vw, this.vh);
      g.samples = [];
    }
    this.view = v;
    this.moving = true;
    this.updateZoomLabel();
    this.invalidate('paper', 'ink');
  }

  touchUp(e) {
    if (this.ignoredTouches.delete(e.pointerId)) return;
    if (!this.touches.delete(e.pointerId)) return;
    if (this.touches.size > 0) {
      this.rebaseGesture(false);
      return;
    }
    const g = this.gesture;
    this.gesture = null;
    const s = g?.samples || [];
    if (!g?.blocked && s.length >= 2 && e.timeStamp - s[s.length - 1].t < 60) {
      const a = s[0], b = s[s.length - 1];
      const dt = Math.max(1, b.t - a.t);
      this.startInertia((b.x - a.x) / dt, (b.y - a.y) / dt);
    } else {
      this.settle();
    }
  }

  cancelGesture() {
    for (const id of this.touches.keys()) this.ignoredTouches.add(id);
    this.touches.clear();
    this.gesture = null;
    this.settle();
  }

  startInertia(vx, vy) {
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(32, now - last);
      last = now;
      const k = Math.pow(0.996, dt);
      vx *= k;
      vy *= k;
      const prev = this.view;
      this.view = clampView({ ...prev, tx: prev.tx + vx * dt, ty: prev.ty + vy * dt }, this.vw, this.vh);
      const stuck = Math.abs(this.view.tx - prev.tx) + Math.abs(this.view.ty - prev.ty) < 0.05;
      if (Math.hypot(vx, vy) < 0.02 || stuck) {
        this.inertia = 0;
        this.settle();
        return;
      }
      this.moving = true;
      this.invalidate('paper', 'ink');
      this.inertia = requestAnimationFrame(step);
    };
    this.inertia = requestAnimationFrame(step);
  }

  stopInertia() {
    if (this.inertia) {
      cancelAnimationFrame(this.inertia);
      this.inertia = 0;
      this.settle();
    }
  }

  /** Gesture ended: render everything sharp again. */
  settle() {
    this.moving = false;
    this.updateZoomLabel();
    this.invalidate('paper', 'ink', 'live');
  }

  onWheel(e) {
    e.preventDefault();
    const [x, y] = this.local(e);
    if (e.ctrlKey) {
      const s = clampScale(this.view.s * Math.exp(-e.deltaY * 0.01), this.vw, this.vh);
      this.view = clampView(zoomAround(this.view, s, x, y), this.vw, this.vh);
    } else {
      this.view = clampView({ ...this.view, tx: this.view.tx - e.deltaX, ty: this.view.ty - e.deltaY }, this.vw, this.vh);
    }
    this.moving = true;
    this.invalidate('paper', 'ink');
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => this.settle(), 140);
  }

  resetZoom() {
    this.view = fitView(this.vw, this.vh);
    this.settle();
  }

  // ---------------------------------------------------------------- undo / redo

  undo() {
    if (this.drawing || !this.history.undo(this.strokes)) return;
    this.changed(true);
  }

  redo() {
    if (this.drawing || !this.history.redo(this.strokes)) return;
    this.changed(true);
  }

  changed(redraw) {
    if (redraw) {
      this.cacheValid = false;
      this.invalidate('ink');
    }
    this.scheduleSave();
    this.updateUndo();
  }

  // ---------------------------------------------------------------- toolbar & page bar

  buildToolbar() {
    const $ = (sel) => this.root.querySelector(sel);
    $('#btn-back').innerHTML = ICONS.back + '<span>Notizbücher</span>';
    for (const t of ['pencil', 'pen', 'eraser']) $(`[data-tool="${t}"]`).innerHTML = ICONS[t];
    $('#btn-undo').innerHTML = ICONS.undo;
    $('#btn-redo').innerHTML = ICONS.redo;
    $('#btn-prev').innerHTML = ICONS.prev;
    $('#btn-next').innerHTML = ICONS.next;
    $('#btn-pages').innerHTML = ICONS.pages;
    $('#btn-add').innerHTML = ICONS.plus;
    $('#ov-close').innerHTML = ICONS.close;

    $('#sizes').innerHTML = [0, 1, 2]
      .map((i) => `<button class="size-btn" data-size="${i}" aria-label="${SIZE_LABELS[i]}" title="${SIZE_LABELS[i]}"><span style="--d:${4 + i * 4}px"></span></button>`)
      .join('');
    $('#colors').innerHTML = COLORS
      .map((c) => `<button class="color-btn" data-color="${c.id}" aria-label="${c.name}" title="${c.name}"><span style="background:${c.value}"></span></button>`)
      .join('');

    $('#btn-back').addEventListener('click', () => { location.hash = '#/'; });
    $('#tools').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tool]');
      if (b) this.setTool(b.dataset.tool);
    });
    $('#eraser-mode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) this.update({ eraserMode: b.dataset.mode });
    });
    $('#sizes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-size]');
      if (b) this.update({ size: { ...this.settings.size, [this.settings.tool]: +b.dataset.size } });
    });
    $('#colors').addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      const tool = this.settings.tool === 'eraser' ? 'pen' : this.settings.tool;
      this.update({ tool, color: { ...this.settings.color, [tool]: b.dataset.color } });
    });
    $('#btn-undo').addEventListener('click', () => this.undo());
    $('#btn-redo').addEventListener('click', () => this.redo());
    $('#btn-prev').addEventListener('click', () => this.pageIdx > 0 && this.showPage(this.pageIdx - 1));
    $('#btn-next').addEventListener('click', () => this.pageIdx < this.nb.pageIds.length - 1 && this.showPage(this.pageIdx + 1));
    $('#btn-add').addEventListener('click', () => this.addPage());
    $('#btn-pages').addEventListener('click', () => this.openOverview());
    $('#page-label').addEventListener('click', () => this.openOverview());
    $('#zoom-label').addEventListener('click', () => this.resetZoom());
    $('#ov-close').addEventListener('click', () => this.closeOverview());
    $('#ov-grid').addEventListener('click', (e) => this.onOverviewClick(e));
    // Toolbar and page bar are never a drawing surface: no callouts, no selection.
    for (const el of [$('.toolbar'), $('.pagebar')]) el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.syncToolbar();
  }

  setTool(tool) {
    if (tool === 'eraser' && this.settings.tool === 'eraser') {
      this.update({ eraserMode: this.settings.eraserMode === 'stroke' ? 'pixel' : 'stroke' });
    } else {
      this.update({ tool });
    }
  }

  update(patch) {
    Object.assign(this.settings, patch);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* private mode */ }
    if (this.settings.tool !== 'eraser') this.hover = null;
    this.syncToolbar();
    this.invalidate('live');
  }

  syncToolbar() {
    const st = this.settings, r = this.root;
    const eraser = st.tool === 'eraser';
    for (const b of r.querySelectorAll('[data-tool]')) {
      const on = b.dataset.tool === st.tool;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    }
    r.querySelector('[data-tool="eraser"]').title = eraser
      ? `Radierer (${st.eraserMode === 'stroke' ? 'Strich' : 'Pixel'}) – erneut tippen zum Umschalten`
      : 'Radierer';
    r.querySelector('#eraser-mode').hidden = !eraser;
    r.querySelector('#colors').hidden = eraser;
    for (const b of r.querySelectorAll('[data-mode]')) b.classList.toggle('active', b.dataset.mode === st.eraserMode);
    for (const b of r.querySelectorAll('[data-size]')) b.classList.toggle('active', +b.dataset.size === st.size[st.tool]);
    const colorTool = eraser ? null : st.tool;
    for (const b of r.querySelectorAll('[data-color]')) b.classList.toggle('active', colorTool && b.dataset.color === st.color[colorTool]);
  }

  updateUndo() {
    const h = this.page ? this.history : null;
    this.root.querySelector('#btn-undo').disabled = !h?.canUndo;
    this.root.querySelector('#btn-redo').disabled = !h?.canRedo;
  }

  updatePagebar() {
    const n = this.nb.pageIds.length;
    this.root.querySelector('#page-label').textContent = `Seite ${this.pageIdx + 1} von ${n}`;
    this.root.querySelector('#btn-prev').disabled = this.pageIdx === 0;
    this.root.querySelector('#btn-next').disabled = this.pageIdx >= n - 1;
    this.updateZoomLabel();
  }

  updateZoomLabel() {
    if (!this.view) return;
    const pct = Math.round((this.view.s / fitScale(this.vw)) * 100);
    const el = this.root.querySelector('#zoom-label');
    el.textContent = `${pct} %`;
    el.classList.toggle('dim', Math.abs(pct - 100) < 2);
  }

  // ---------------------------------------------------------------- page overview

  async openOverview() {
    await this.flush();
    this.overviewOpen = true;
    const ov = this.root.querySelector('#overview');
    ov.hidden = false;
    await this.renderOverview();
  }

  closeOverview() {
    this.overviewOpen = false;
    this.root.querySelector('#overview').hidden = true;
    this.root.querySelector('#ov-grid').innerHTML = '';
  }

  async renderOverview() {
    const grid = this.root.querySelector('#ov-grid');
    const ids = this.nb.pageIds;
    const single = ids.length <= 1;
    grid.innerHTML = ids
      .map((id, i) => `<div class="thumb ${i === this.pageIdx ? 'current' : ''}" data-index="${i}">
        <button class="thumb-open" data-index="${i}" aria-label="Seite ${i + 1} öffnen"><canvas></canvas></button>
        <div class="thumb-foot"><span>${i + 1}</span>
          <button class="icon-btn small" data-delete="${i}" ${single ? 'disabled' : ''} aria-label="Seite ${i + 1} löschen">${ICONS.trash}</button>
        </div></div>`)
      .join('') + `<button class="thumb add" data-add="1"><span>${ICONS.plus}</span>Neue Seite</button>`;

    const token = (this.ovToken = {});
    const canvases = grid.querySelectorAll('canvas');
    for (let i = 0; i < ids.length; i++) {
      if (token !== this.ovToken) return; // overview closed or re-rendered meanwhile
      const strokes = ids[i] === this.page.id ? this.strokes : (await db.getPage(ids[i]))?.strokes || [];
      this.drawThumb(canvases[i], strokes);
      if (i % 4 === 3) await nextFrame();
    }
  }

  drawThumb(cv, strokes) {
    const cssW = cv.parentElement.clientWidth || 150;
    const dpr = this.dpr || 1;
    const s = (cssW / PAGE_W) * dpr;
    cv.width = Math.round(PAGE_W * s);
    cv.height = Math.round(PAGE_H * s);
    const c = cv.getContext('2d');
    drawPaper(c, { type: this.nb.paper, margin: this.nb.margin }, s, 0, 0);
    // Ink goes on its own canvas so the pixel eraser cannot punch through the paper.
    const ink = document.createElement('canvas');
    ink.width = cv.width;
    ink.height = cv.height;
    const ic = ink.getContext('2d');
    ic.setTransform(s, 0, 0, s, 0, 0);
    for (const st of strokes) renderStroke(ic, st);
    c.drawImage(ink, 0, 0);
  }

  async onOverviewClick(e) {
    const del = e.target.closest('[data-delete]');
    if (del) {
      if (await this.deletePage(+del.dataset.delete)) await this.renderOverview();
      return;
    }
    if (e.target.closest('[data-add]')) {
      await this.addPage(true);
      this.closeOverview();
      return;
    }
    const open = e.target.closest('.thumb-open');
    if (open) {
      this.closeOverview();
      await this.showPage(+open.dataset.index);
    }
  }
}
