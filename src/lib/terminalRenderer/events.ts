import type { Disposable } from "./types";
export function events<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    on(listener: (value: T) => void): Disposable { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; },
    emit(value: T) { for (const listener of [...listeners]) listener(value); },
    clear() { listeners.clear(); },
  };
}
