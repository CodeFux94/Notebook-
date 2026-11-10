// Start screen: all notebooks as cards.
import * as db from './db.js';
import { PAPER_LABEL } from './paper.js';
import { ICONS } from './icons.js';
import { COVERS, notebookDialog, confirmDialog, actionSheet } from './dialog.js';
import { escapeHtml } from './util.js';

export class Library {
  constructor(root) {
    this.root = root;
    this.shelf = root.querySelector('#shelf');
    this.empty = root.querySelector('#empty');
    root.querySelector('#new-notebook').addEventListener('click', () => this.create());
    this.shelf.addEventListener('click', (e) => this.onClick(e));
  }

  async refresh() {
    this.notebooks = await db.listNotebooks();
    this.empty.hidden = this.notebooks.length > 0;
    this.shelf.innerHTML = this.notebooks.map((nb) => this.card(nb)).join('');
  }

  card(nb) {
    const pages = nb.pageIds.length;
    const paper = PAPER_LABEL[nb.paper] || PAPER_LABEL.grid;
    return `<article class="nb-card" data-id="${nb.id}">
      <button class="cover" data-action="open" style="--cover:${escapeHtml(nb.cover || COVERS[0])}" aria-label="${escapeHtml(nb.name)} öffnen">
        <span class="band"></span>
        <span class="label ${nb.paper}">
          <span class="name">${escapeHtml(nb.name)}</span>
          <span class="meta">${paper} · ${pages} ${pages === 1 ? 'Seite' : 'Seiten'}</span>
        </span>
      </button>
      <button class="icon-btn more" data-action="more" aria-label="Optionen für ${escapeHtml(nb.name)}">${ICONS.more}</button>
    </article>`;
  }

  async onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const nb = this.notebooks.find((n) => n.id === btn.closest('.nb-card').dataset.id);
    if (!nb) return;
    if (btn.dataset.action === 'open') {
      location.hash = `#/nb/${nb.id}`;
      return;
    }
    const choice = await actionSheet({
      title: nb.name,
      actions: [
        { id: 'rename', label: 'Umbenennen' },
        { id: 'delete', label: 'Löschen', danger: true },
      ],
    });
    if (choice === 'rename') {
      const res = await notebookDialog({ mode: 'rename', name: nb.name });
      if (!res) return;
      nb.name = res.name;
      nb.updatedAt = Date.now();
      await db.putNotebook(nb);
    } else if (choice === 'delete') {
      const ok = await confirmDialog({
        title: `„${nb.name}" löschen?`,
        message: `Alle ${nb.pageIds.length} Seiten werden endgültig entfernt.`,
      });
      if (!ok) return;
      await db.deleteNotebook(nb.id);
    } else return;
    await this.refresh();
  }

  async create() {
    const cover = COVERS[(this.notebooks?.length || 0) % COVERS.length];
    const res = await notebookDialog({ mode: 'create', cover });
    if (!res) return;
    const nb = await db.createNotebook(res);
    location.hash = `#/nb/${nb.id}`;
  }
}
