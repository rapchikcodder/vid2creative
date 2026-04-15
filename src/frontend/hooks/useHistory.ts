import { useState } from 'react';

export function useHistory<T>(initial: T) {
  const [past, setPast] = useState<T[]>([]);
  const [present, setPresent] = useState<T>(initial);
  const [future, setFuture] = useState<T[]>([]);

  function push(next: T) {
    setPast(p => [...p, present]);
    setPresent(next);
    setFuture([]);
  }

  function undo() {
    if (past.length === 0) return;
    setFuture(f => [present, ...f]);
    setPresent(past[past.length - 1]);
    setPast(p => p.slice(0, -1));
  }

  function redo() {
    if (future.length === 0) return;
    setPast(p => [...p, present]);
    setPresent(future[0]);
    setFuture(f => f.slice(1));
  }

  return {
    state: present,
    push,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
