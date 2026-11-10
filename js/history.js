// Undo/redo for one page. Actions:
//   { type: 'add', stroke }                      – stroke appended at the end
//   { type: 'remove', items: [{ stroke, index }] } – in removal order, index valid at removal time

export class History {
  constructor(limit = 300) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }
  push(action) {
    this.undoStack.push(action);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo(strokes) {
    const a = this.undoStack.pop();
    if (!a) return false;
    revertAction(strokes, a);
    this.redoStack.push(a);
    return true;
  }
  redo(strokes) {
    const a = this.redoStack.pop();
    if (!a) return false;
    applyAction(strokes, a);
    this.undoStack.push(a);
    return true;
  }
}

function removeById(strokes, id) {
  const i = strokes.findIndex((s) => s.id === id);
  if (i >= 0) strokes.splice(i, 1);
}

export function applyAction(strokes, a) {
  if (a.type === 'add') strokes.push(a.stroke);
  else for (const it of a.items) removeById(strokes, it.stroke.id);
}

export function revertAction(strokes, a) {
  if (a.type === 'add') removeById(strokes, a.stroke.id);
  else {
    for (let i = a.items.length - 1; i >= 0; i--) {
      const it = a.items[i];
      strokes.splice(Math.min(it.index, strokes.length), 0, it.stroke);
    }
  }
}
