// Minimal reactive store. The one primitive the HUD + derived state bind to,
// replacing the per-frame "poll a getter, diff against a hand-kept lastX
// cache, rewrite the DOM" pattern scattered across the UI.
//
// A writable holds a value; set() only notifies subscribers when the value
// actually changes (gated by an equality fn, Object.is by default), so a
// caller can recompute every frame and subscribers still only fire on real
// change. subscribe() fires immediately with the current value so a binding
// renders its initial state without a separate call.
//
// Deliberately tiny — no batching, no async, no dependency graph. Module
// state is synchronous and single-threaded at our scale; that's all we need.

export type Listener<T> = (value: T) => void;

export interface ReadableStore<T> {
  get(): T;
  /** Subscribe to changes. Fires once immediately with the current value.
   *  Returns an unsubscribe closure. */
  subscribe(fn: Listener<T>): () => void;
}

export interface WritableStore<T> extends ReadableStore<T> {
  set(value: T): void;
}

export function writable<T>(
  initial: T,
  equals: (a: T, b: T) => boolean = Object.is,
): WritableStore<T> {
  let value = initial;
  const listeners = new Set<Listener<T>>();

  return {
    get: () => value,
    set(next: T) {
      if (equals(value, next)) return;
      value = next;
      for (const fn of listeners) fn(value);
    },
    subscribe(fn: Listener<T>) {
      listeners.add(fn);
      fn(value);
      return () => listeners.delete(fn);
    },
  };
}
