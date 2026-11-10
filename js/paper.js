// Paper background. Always drawn on its own canvas layer, never into the ink.

export const PAGE_W = 210; // mm, A4 portrait
export const PAGE_H = 297;

export const PAPER_COLOR = '#F6F1E4';
export const DESK_COLOR = '#E4DFD3';
const LINE_COLOR = 'rgba(112, 140, 168, 0.42)';
const MARGIN_COLOR = 'rgba(196, 112, 104, 0.45)';

export const GRID_MM = 5;
export const LINE_MM = 8;
const LINED_TOP = 26;
const LINED_BOTTOM = 12;
export const MARGIN_X = 25;

export const PAPER_LABEL = { grid: 'Kariert', lined: 'Liniert' };

/** Line positions in mm for a paper type. */
export function paperLines(paper) {
  const h = [];
  const v = [];
  let margin = null;
  if (paper.type === 'grid') {
    // Center the grid so the leftover is split evenly at both edges.
    const offX = (PAGE_W % GRID_MM) / 2 || GRID_MM;
    const offY = (PAGE_H % GRID_MM) / 2 || GRID_MM;
    for (let x = offX; x < PAGE_W - 0.01; x += GRID_MM) v.push(round2(x));
    for (let y = offY; y < PAGE_H - 0.01; y += GRID_MM) h.push(round2(y));
  } else {
    for (let y = LINED_TOP; y <= PAGE_H - LINED_BOTTOM; y += LINE_MM) h.push(y);
    if (paper.margin) margin = MARGIN_X;
  }
  return { h, v, margin };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Draws page + lines in device pixels so that hairlines can be pixel-snapped.
 * s: device px per mm, ox/oy: device offset of the page origin.
 */
export function drawPaper(ctx, paper, s, ox, oy) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const x0 = ox, y0 = oy, x1 = ox + PAGE_W * s, y1 = oy + PAGE_H * s;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  const { h, v, margin } = paperLines(paper);
  const lw = Math.max(1, Math.round(s * 0.1));
  const half = lw % 2 ? 0.5 : 0;
  const snap = (p) => Math.round(p - half) + half;
  // Tiny previews: fade the lines instead of letting them turn into a grey wash.
  ctx.globalAlpha = Math.min(1, s / 2.5);
  ctx.lineWidth = lw;
  ctx.strokeStyle = LINE_COLOR;
  ctx.beginPath();
  const lx0 = Math.max(x0, 0), lx1 = Math.min(x1, cw);
  const ly0 = Math.max(y0, 0), ly1 = Math.min(y1, ch);
  for (const y of h) {
    const Y = snap(oy + y * s);
    if (Y < -lw || Y > ch + lw) continue;
    ctx.moveTo(lx0, Y);
    ctx.lineTo(lx1, Y);
  }
  for (const x of v) {
    const X = snap(ox + x * s);
    if (X < -lw || X > cw + lw) continue;
    ctx.moveTo(X, ly0);
    ctx.lineTo(X, ly1);
  }
  ctx.stroke();
  if (margin !== null) {
    ctx.strokeStyle = MARGIN_COLOR;
    ctx.beginPath();
    const X = snap(ox + margin * s);
    ctx.moveTo(X, ly0);
    ctx.lineTo(X, ly1);
    ctx.stroke();
  }
  ctx.restore();
}
