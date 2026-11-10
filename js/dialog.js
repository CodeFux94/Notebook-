// Small modal dialogs built on <dialog>; each returns a Promise.
import { escapeHtml } from './util.js';

export const COVERS = ['#3E4C5E', '#5B4636', '#4E5D47', '#7A3F3A', '#2F5157', '#5A5470'];

function showDialog(html, read) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = html;
    document.body.append(d);
    const form = d.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // Implicit submission (Enter key) has no submitter and counts as OK.
      const ok = e.submitter ? e.submitter.value : 'ok';
      d.close(ok);
    });
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (b) d.close(b.dataset.value);
    });
    d.addEventListener('close', () => {
      const value = d.returnValue;
      resolve(value && value !== 'cancel' ? read(value, form) : null);
      d.remove();
    });
    d.showModal();
  });
}

export function confirmDialog({ title, message, ok = 'Löschen' }) {
  return showDialog(
    `<form method="dialog">
      <h2>${escapeHtml(title)}</h2>
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
      <div class="actions">
        <button type="submit" value="cancel" class="btn">Abbrechen</button>
        <button type="submit" value="ok" class="btn danger">${escapeHtml(ok)}</button>
      </div>
    </form>`,
    () => true,
  ).then((v) => v === true);
}

export function actionSheet({ title, actions }) {
  return showDialog(
    `<form method="dialog">
      <h2>${escapeHtml(title)}</h2>
      <div class="action-list">
        ${actions.map((a) => `<button type="button" data-value="${a.id}" class="btn wide ${a.danger ? 'danger' : ''}">${escapeHtml(a.label)}</button>`).join('')}
        <button type="button" data-value="cancel" class="btn wide">Abbrechen</button>
      </div>
    </form>`,
    (v) => v,
  );
}

/** Create (with paper + cover choice) or rename (name only). */
export function notebookDialog({ mode, name = '', paper = 'grid', margin = true, cover = COVERS[0] }) {
  const create = mode === 'create';
  return showDialog(
    `<form method="dialog" class="nb-form">
      <h2>${create ? 'Neues Notizbuch' : 'Notizbuch umbenennen'}</h2>
      <label class="field">
        <span>Name</span>
        <input name="name" type="text" maxlength="60" autocomplete="off" value="${escapeHtml(name)}" placeholder="z. B. Mathe, Ideen, Tagebuch" autofocus>
      </label>
      ${create ? `
      <fieldset class="field">
        <legend>Papier</legend>
        <div class="paper-choice">
          <label><input type="radio" name="paper" value="grid" ${paper === 'grid' ? 'checked' : ''}><span class="swatch grid"></span>Kariert</label>
          <label><input type="radio" name="paper" value="lined" ${paper === 'lined' ? 'checked' : ''}><span class="swatch lined"></span>Liniert</label>
        </div>
        <label class="check"><input type="checkbox" name="margin" ${margin ? 'checked' : ''}> Rand links (bei liniert)</label>
      </fieldset>
      <fieldset class="field">
        <legend>Einband</legend>
        <div class="cover-choice">
          ${COVERS.map((c) => `<label><input type="radio" name="cover" value="${c}" ${c === cover ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}
        </div>
      </fieldset>` : ''}
      <div class="actions">
        <button type="submit" value="cancel" class="btn">Abbrechen</button>
        <button type="submit" value="ok" class="btn primary">${create ? 'Anlegen' : 'Speichern'}</button>
      </div>
    </form>`,
    (v, form) => {
      const f = new FormData(form);
      const out = { name: String(f.get('name') || '').trim() || 'Notizbuch' };
      if (create) {
        out.paper = f.get('paper') === 'lined' ? 'lined' : 'grid';
        out.margin = f.get('margin') === 'on';
        out.cover = f.get('cover') || cover;
      }
      return out;
    },
  );
}
