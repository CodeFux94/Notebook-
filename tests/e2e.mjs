// End-to-end check in Chromium with synthetic Pencil/finger pointer events.
// Run: node tests/e2e.mjs   (serves the folder itself on a free port)
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const shots = process.env.SHOTS || null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

// Served below /notebook-/ like GitHub Pages project sites, to catch absolute paths.
const BASE = '/notebook-/';
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(BASE)) { res.writeHead(404).end(); return; }
  let p = normalize(url.pathname.slice(BASE.length) || 'index.html');
  if (p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(join(root, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const step = (name) => console.log('•', name);

/** Dispatches a pointer sequence on the stage. pts in CSS px relative to the stage. */
async function pointer(type, pts, opts = {}) {
  await page.evaluate(({ type, pts, opts }) => {
    const stage = document.getElementById('stage');
    const r = stage.getBoundingClientRect();
    const id = opts.id ?? (type === 'pen' ? 2 : 10);
    const ev = (name, [x, y], i) => stage.dispatchEvent(new PointerEvent(name, {
      bubbles: true, cancelable: true, pointerId: id, pointerType: type, isPrimary: true,
      clientX: r.left + x, clientY: r.top + y, pressure: name === 'pointerup' ? 0 : (opts.pressure ?? 0.4),
      tiltX: opts.tiltX ?? 20, tiltY: 0, width: opts.size ?? 10, height: opts.size ?? 10, buttons: name === 'pointerup' ? 0 : 1,
      timeStamp: performance.now() + i,
    }));
    ev('pointerdown', pts[0], 0);
    pts.slice(1).forEach((p, i) => ev('pointermove', p, i));
    ev('pointerup', pts.at(-1), pts.length);
  }, { type, pts, opts });
}

const line = (x0, y0, x1, y1, n = 20) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

async function dbPages() {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('notizbuch');
    req.onsuccess = () => {
      const tx = req.result.transaction(['notebooks', 'pages']);
      const out = {};
      tx.objectStore('notebooks').getAll().onsuccess = (e) => { out.notebooks = e.target.result; };
      tx.objectStore('pages').getAll().onsuccess = (e) => {
        out.pages = e.target.result.map((p) => ({ id: p.id, strokes: p.strokes.map((s) => ({ tool: s.tool, n: s.pts.length / 4, isF32: s.pts instanceof Float32Array })) }));
      };
      tx.oncomplete = () => { req.result.close(); resolve(out); };
    };
  }));
}
const currentStrokes = async () => {
  const d = await dbPages();
  const id = d.notebooks[0].pageIds[Number(page.url().split('/').at(-1)) - 1];
  return d.pages.find((p) => p.id === id).strokes;
};
const settle = () => page.waitForTimeout(900); // > SAVE_DELAY

step('Startscreen');
await page.goto(origin + BASE);
await page.waitForSelector('#library:not([hidden])');
assert.ok(await page.isVisible('#empty'));

step('Notizbuch anlegen (liniert)');
await page.click('#new-notebook');
await page.fill('dialog input[name=name]', 'Mathe <b>Test</b>');
await page.click('dialog .paper-choice label:nth-child(2)');
await page.click('dialog button[value=ok]');
await page.waitForSelector('#editor:not([hidden])');
assert.match(page.url(), /#\/nb\/[^/]+\/1$/);
assert.equal(await page.textContent('#nb-title'), 'Mathe <b>Test</b>');
await page.waitForTimeout(300);

step('Bleistift-Strich mit dem Pencil');
await pointer('pen', line(100, 200, 500, 260));
await settle();
let s = await currentStrokes();
assert.equal(s.length, 1);
assert.equal(s[0].tool, 'pencil');
assert.ok(s[0].n >= 15 && s[0].isF32, 'stroke stored as Float32Array with points');

step('Kugelschreiber in Rot, dick');
await page.click('[data-tool=pen]');
await page.click('[data-color=red]');
await page.click('[data-size="2"]');
await pointer('pen', line(100, 320, 500, 330), { pressure: 0.8 });
await pointer('pen', [[600, 300]]); // tap = dot
await settle();
s = await currentStrokes();
assert.deepEqual(s.map((x) => x.tool), ['pencil', 'pen', 'pen']);

step('Finger zeichnet nie, sondern verschiebt/zoomt');
const before = await page.textContent('#zoom-label');
await pointer('touch', line(400, 700, 400, 400));
await page.waitForTimeout(100);
// Two-finger pinch
await page.evaluate(() => {
  const st = document.getElementById('stage'), r = st.getBoundingClientRect();
  const e = (name, id, x, y) => st.dispatchEvent(new PointerEvent(name, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, width: 10, height: 10 }));
  e('pointerdown', 20, 300, 500); e('pointerdown', 21, 500, 500);
  for (let i = 1; i <= 10; i++) { e('pointermove', 20, 300 - i * 10, 500); e('pointermove', 21, 500 + i * 10, 500); }
  e('pointerup', 20, 200, 500); e('pointerup', 21, 600, 500);
});
await page.waitForTimeout(200);
const after = await page.textContent('#zoom-label');
assert.notEqual(after, before, 'pinch changed zoom');
assert.equal((await currentStrokes()).length, 3, 'touch created no strokes');
step('Handballen (große Kontaktfläche) wird ignoriert');
await pointer('touch', line(200, 900, 600, 600), { size: 80 });
await page.click('#zoom-label'); // reset zoom
await page.waitForTimeout(200);
assert.equal(await page.textContent('#zoom-label'), '100 %');

step('Rückgängig / Wiederholen');
await page.click('#btn-undo');
await settle();
assert.equal((await currentStrokes()).length, 2);
await page.click('#btn-redo');
await settle();
assert.equal((await currentStrokes()).length, 3);

step('Strichradierer entfernt ganzen Strich');
await page.click('[data-tool=eraser]');
assert.ok(await page.isVisible('#eraser-mode'));
assert.ok(await page.isHidden('#colors'));
await page.click('[data-mode=stroke]');
await pointer('pen', line(300, 300, 300, 350, 10));
await settle();
s = await currentStrokes();
assert.deepEqual(s.map((x) => x.tool), ['pencil', 'pen'], 'red line removed, dot kept');
await page.click('#btn-undo');
await settle();
assert.equal((await currentStrokes()).length, 3);

step('Pixelradierer als eigener Strich (Papier bleibt)');
await page.click('[data-tool=eraser]'); // second tap toggles mode
assert.ok(await page.$eval('[data-mode=pixel]', (b) => b.classList.contains('active')));
await pointer('pen', line(250, 150, 250, 400, 10));
await settle();
s = await currentStrokes();
assert.equal(s.at(-1).tool, 'eraser', JSON.stringify(errors));
// Paper layer untouched at the erased spot; ink layer transparent there.
const px = await page.evaluate(() => {
  const read = (id, x, y) => { const c = document.getElementById(id); return [...c.getContext('2d').getImageData(x * 2, y * 2, 1, 1).data]; };
  return { paper: read('cv-paper', 250, 205), ink: read('cv-ink', 250, 205), inkElsewhere: read('cv-ink', 150, 212) };
});
assert.equal(px.ink[3], 0, 'ink erased');
assert.ok(px.paper[0] > 200 && px.paper[3] === 255, 'paper still there');
if (shots) await page.screenshot({ path: `${shots}/editor.png` });

step('Seiten: hinzufügen, blättern, Übersicht, löschen');
await page.click('[data-tool=pencil]');
await page.click('#btn-add');
await page.waitForFunction(() => location.hash.endsWith('/2'));
assert.equal(await page.textContent('#page-label'), 'Seite 2 von 2');
await pointer('pen', line(100, 100, 300, 100));
await settle();
assert.equal((await currentStrokes()).length, 1);
await page.click('#btn-prev');
await page.waitForFunction(() => location.hash.endsWith('/1'));
assert.equal((await currentStrokes()).length, 4);
await page.click('#btn-pages');
await page.waitForSelector('#overview:not([hidden]) .thumb canvas');
await page.waitForTimeout(300);
assert.equal(await page.locator('.thumb-open').count(), 2);
if (shots) await page.screenshot({ path: `${shots}/overview.png` });
await page.click('[data-add]');
await page.waitForFunction(() => location.hash.endsWith('/3'));
await page.click('#btn-pages');
await page.waitForSelector('.thumb-open');
await page.click('[data-delete="1"]');
await page.click('dialog button[value=ok]');
await page.waitForFunction(() => document.querySelectorAll('.thumb-open').length === 2);
let d = await dbPages();
assert.equal(d.notebooks[0].pageIds.length, 2);
assert.equal(d.pages.length, 2);
await page.click('.thumb-open[data-index="0"]');
await page.waitForFunction(() => location.hash.endsWith('/1'));

step('Neu laden: Daten bleiben erhalten');
await page.reload();
await page.waitForSelector('#editor:not([hidden])');
await page.waitForTimeout(300);
assert.equal((await currentStrokes()).length, 4);
assert.equal(await page.textContent('#page-label'), 'Seite 1 von 2');

step('Offline-Start über Service Worker');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); // now controlled
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
await context.setOffline(true);
await page.goto(origin + BASE);
await page.waitForSelector('#library:not([hidden]) .nb-card');
await page.click('.nb-card .cover');
await page.waitForSelector('#editor:not([hidden])');
await page.waitForTimeout(300);
assert.equal((await currentStrokes()).length, 4);
await context.setOffline(false);

step('Umbenennen und Löschen');
await page.click('#btn-back');
await page.waitForSelector('#library:not([hidden]) .nb-card');
assert.match(await page.textContent('.nb-card .meta'), /Liniert · 2 Seiten/);
if (shots) await page.screenshot({ path: `${shots}/library.png` });
await page.click('.nb-card .more');
await page.click('dialog [data-value=rename]');
await page.fill('dialog input[name=name]', 'Physik');
await page.click('dialog button[value=ok]');
await page.waitForFunction(() => document.querySelector('.nb-card .name')?.textContent === 'Physik');
await page.click('.nb-card .more');
await page.click('dialog [data-value=delete]');
await page.click('dialog button[value=cancel]');
assert.equal(await page.locator('.nb-card').count(), 1, 'cancel keeps notebook');
await page.click('.nb-card .more');
await page.click('dialog [data-value=delete]');
await page.click('dialog button[value=ok]');
await page.waitForSelector('#empty:not([hidden])');
d = await dbPages();
assert.equal(d.notebooks.length, 0);
assert.equal(d.pages.length, 0, 'pages of deleted notebook removed');

assert.deepEqual(errors, [], 'no console errors');
console.log('\nAlle E2E-Prüfungen bestanden.');
await browser.close();
server.close();
