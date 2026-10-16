'use client';

/**
 * Global escape-stack: registers an open overlay; only the topmost one
 * responds to Escape, so nested dialogs / selects close one at a time.
 */
type EscHandler = () => void;
const stack: { id: number; onClose: EscHandler }[] = [];
let nextId = 1;
let bound = false;

function ensureListener() {
  if (bound || typeof window === 'undefined') return;
  bound = true;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      const top = stack[stack.length - 1];
      if (top) {
        e.stopPropagation();
        top.onClose();
      }
    },
    true, // capture: run before per-component document listeners
  );
}

export function registerEsc(onClose: EscHandler): () => void {
  ensureListener();
  const id = nextId++;
  stack.push({ id, onClose });
  return () => {
    const idx = stack.findIndex((entry) => entry.id === id);
    if (idx >= 0) stack.splice(idx, 1);
  };
}
