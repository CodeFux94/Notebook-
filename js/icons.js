// Inline SVG icons (24×24, stroke = currentColor).
const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  pencil: svg('<path d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M4 20l4.6-1.2"/><path d="M13.8 6.8l3.4 3.4"/><path d="M4.6 17.8l1.6 1.6" stroke-width="2.4"/>'),
  pen: svg('<path d="M14.5 4.5l5 5L10 19l-5.5.5L5 14z"/><path d="M12.5 6.5l5 5"/><path d="M4.5 19.5l3-3"/>'),
  eraser: svg('<path d="M8.5 20H20"/><path d="M4.4 14.6l9.2-9.2a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12.3 18.7a4 4 0 0 1-2.8 1.2H8.6a2 2 0 0 1-1.4-.6l-2.8-2.8a2 2 0 0 1 0-2.8z"/><path d="M9 10l5.5 5.5"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  prev: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  pages: svg('<rect x="4" y="4" width="6.5" height="7.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="7.5" rx="1"/><rect x="4" y="14.5" width="6.5" height="5.5" rx="1"/><rect x="13.5" y="14.5" width="6.5" height="5.5" rx="1"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>'),
  more: svg('<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};
