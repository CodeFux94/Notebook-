// IndexedDB storage. Stores: notebooks (metadata + page order), pages (strokes).
import { uid } from './util.js';

const DB_NAME = 'notizbuch';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pages')) {
        db.createObjectStore('pages', { keyPath: 'id' }).createIndex('notebookId', 'notebookId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgraded the schema: release the connection, reopen lazily.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error);
});
const result = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function store(name, mode = 'readonly') {
  const db = await open();
  const tx = db.transaction(name, mode);
  return { tx, os: tx.objectStore(name) };
}

export async function listNotebooks() {
  const { os } = await store('notebooks');
  const all = await result(os.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getNotebook(id) {
  const { os } = await store('notebooks');
  return result(os.get(id));
}

export async function putNotebook(nb) {
  const { tx, os } = await store('notebooks', 'readwrite');
  os.put(nb);
  return done(tx);
}

export function newPage(notebookId) {
  return { id: uid(), notebookId, strokes: [], updatedAt: Date.now() };
}

export async function createNotebook({ name, paper, margin, cover }) {
  const now = Date.now();
  const nb = { id: uid(), name, paper, margin: !!margin, cover, pageIds: [], createdAt: now, updatedAt: now };
  const page = newPage(nb.id);
  nb.pageIds.push(page.id);
  const db = await open();
  const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
  tx.objectStore('notebooks').put(nb);
  tx.objectStore('pages').put(page);
  await done(tx);
  return nb;
}

export async function deleteNotebook(id) {
  const db = await open();
  const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
  tx.objectStore('notebooks').delete(id);
  const pages = tx.objectStore('pages');
  // Delete inside the request callback so the transaction is guaranteed to still be active.
  pages.index('notebookId').getAllKeys(id).onsuccess = (e) => {
    for (const k of e.target.result) pages.delete(k);
  };
  return done(tx);
}

export async function getPage(id) {
  const { os } = await store('pages');
  return result(os.get(id));
}

/** Saves page and notebook atomically (notebook carries page order and updatedAt). */
export async function savePage(page, nb) {
  const db = await open();
  const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
  if (page) tx.objectStore('pages').put(page);
  if (nb) tx.objectStore('notebooks').put(nb);
  return done(tx);
}

export async function deletePage(pageId, nb) {
  const db = await open();
  const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
  tx.objectStore('pages').delete(pageId);
  tx.objectStore('notebooks').put(nb);
  return done(tx);
}
