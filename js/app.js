import { Library } from './library.js';
import { Editor } from './editor.js';

const libraryEl = document.getElementById('library');
const editorEl = document.getElementById('editor');
const library = new Library(libraryEl);
const editor = new Editor(editorEl);

let routing = Promise.resolve();

function route() {
  // Serialize route changes so a fast double tap cannot interleave open/close.
  routing = routing.then(async () => {
    const m = location.hash.match(/^#\/nb\/([^/]+)(?:\/(\d+))?/);
    if (m) {
      libraryEl.hidden = true;
      editorEl.hidden = false;
      const ok = await editor.open(decodeURIComponent(m[1]), m[2] ? Number(m[2]) - 1 : 0);
      if (!ok) location.replace('#/');
    } else {
      await editor.close();
      editorEl.hidden = true;
      libraryEl.hidden = false;
      await library.refresh();
    }
  }).catch((err) => console.error(err));
}

window.addEventListener('hashchange', route);
route();

// Ask iOS to keep our IndexedDB data instead of evicting it under storage pressure.
async function requestPersistence() {
  const note = document.getElementById('storage-note');
  if (!navigator.storage?.persist) return;
  try {
    const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    note.textContent = persisted
      ? 'Notizen werden dauerhaft auf diesem Gerät gespeichert.'
      : 'Notizen werden lokal gespeichert. Tipp: App zum Home-Bildschirm hinzufügen.';
  } catch { /* ignore */ }
}
requestPersistence();

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service Worker:', err));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, nothing to update
    const toast = document.getElementById('update-toast');
    toast.hidden = false;
    toast.onclick = () => location.reload();
  });
}

// Global guard: no long-press callouts outside text fields.
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});
