// View transform: screen = page(mm) * s + (tx, ty), all in CSS pixels.
import { PAGE_W, PAGE_H } from './paper.js';

export const PAD = 16;
export const PAD_BOTTOM = 76; // room for the floating page bar

export function fitScale(vw) {
  return Math.max(0.5, (vw - 2 * PAD) / PAGE_W);
}

export function scaleLimits(vw, vh) {
  const whole = Math.min((vw - 2 * PAD) / PAGE_W, (vh - PAD - PAD_BOTTOM) / PAGE_H);
  return { min: Math.max(0.3, Math.min(whole, fitScale(vw)) * 0.85), max: fitScale(vw) * 6 };
}

export function clampScale(s, vw, vh) {
  const { min, max } = scaleLimits(vw, vh);
  return Math.min(max, Math.max(min, s));
}

function clampAxis(t, size, view, padStart, padEnd) {
  if (size + padStart + padEnd <= view) return padStart + (view - padStart - padEnd - size) / 2;
  return Math.min(padStart, Math.max(view - size - padEnd, t));
}

export function clampView(v, vw, vh) {
  return {
    s: v.s,
    tx: clampAxis(v.tx, PAGE_W * v.s, vw, PAD, PAD),
    ty: clampAxis(v.ty, PAGE_H * v.s, vh, PAD, PAD_BOTTOM),
  };
}

export function fitView(vw, vh) {
  const s = clampScale(fitScale(vw), vw, vh);
  return clampView({ s, tx: 0, ty: PAD }, vw, vh);
}

/** Zoom to scale s while keeping the page point under (cx, cy) fixed. */
export function zoomAround(v, s, cx, cy) {
  const px = (cx - v.tx) / v.s, py = (cy - v.ty) / v.s;
  return { s, tx: cx - px * s, ty: cy - py * s };
}

/** Two-finger gesture: start view v0, start points a0/b0, current points a1/b1. */
export function pinchView(v0, a0, b0, a1, b1, vw, vh) {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const s = clampScale(v0.s * (d1 / d0), vw, vh);
  const m0x = (a0.x + b0.x) / 2, m0y = (a0.y + b0.y) / 2;
  const m1x = (a1.x + b1.x) / 2, m1y = (a1.y + b1.y) / 2;
  const px = (m0x - v0.tx) / v0.s, py = (m0y - v0.ty) / v0.s;
  return clampView({ s, tx: m1x - px * s, ty: m1y - py * s }, vw, vh);
}

export function toPage(v, x, y) {
  return [(x - v.tx) / v.s, (y - v.ty) / v.s];
}
