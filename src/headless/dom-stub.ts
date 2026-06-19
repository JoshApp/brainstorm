// Minimal browser/DOM/canvas stub so the SIM core imports + runs under Node
// (no browser). The sim modules transitively pull UI/scene code that touches
// window/document/canvas-2d at module-load time; this satisfies those without a
// real DOM. The renderer is never constructed and render systems never run, so
// no WebGL/GL context is needed — only object construction + 2D-canvas no-ops.
//
// IMPORT THIS FIRST, before any game module, in a Node entry point.
//
//   import './headless/dom-stub'; // must precede the game imports below
//   const { buildLevel } = await import('../level/builder');
//
// It only installs itself when there's no real document (i.e. in Node) — a
// no-op in the browser.

if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  const noop = () => {};
  const g = globalThis as Record<string, unknown>;

  // A no-op 2D canvas context — enough for modules that paint procedural
  // textures / splat maps at load time without rendering anything real.
  const ctx2d = new Proxy(
    {
      canvas: null as unknown,
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createPattern: () => null,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, (w || 1) * (h || 1) * 4)), width: w || 1, height: h || 1,
      }),
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, (w || 1) * (h || 1) * 4)), width: w || 1, height: h || 1,
      }),
      measureText: () => ({ width: 0 }),
    },
    { get: (t: Record<string | symbol, unknown>, k) => (k in t ? t[k] : noop), set: () => true },
  );

  const fakeEl: unknown = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === 'style') return new Proxy({}, {
          // CSSStyleDeclaration METHODS must be callable (setProperty etc.);
          // plain property reads return '' like a real empty inline style.
          get: (_t, p) => (p === 'setProperty' || p === 'removeProperty' || p === 'getPropertyValue') ? (() => '') : '',
          set: () => true,
        });
        if (k === 'classList') return { add: noop, remove: noop, toggle: noop, contains: () => false };
        if (k === 'getContext') return () => ctx2d;
        if (k === 'getBoundingClientRect') return () => ({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 });
        if (k === 'width' || k === 'height' || k === 'clientWidth' || k === 'clientHeight') return 800;
        // Layout reads (offsetHeight, scrollTop, …) — numbers so UI math headless
        // doesn't crash on the Proxy. 0 is fine; nothing is actually laid out.
        if (typeof k === 'string' && /^(offset|scroll)(Width|Height|Top|Left)$/.test(k)) return 0;
        return typeof k === 'string' && /^(append|remove|set|add|insert|replace|focus|blur|click|dispatch|prepend|after|before)/.test(k)
          ? noop : fakeEl;
      },
      set: () => true,
    },
  );
  (ctx2d as { canvas: unknown }).canvas = fakeEl;

  const localStorage = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
  const win = new Proxy(
    {
      innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
      addEventListener: noop, removeEventListener: noop, location: { search: '', href: '' },
      matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
      requestAnimationFrame: noop, cancelAnimationFrame: noop, localStorage,
      AudioContext: function () { return fakeEl; }, navigator: { userAgent: 'node', maxTouchPoints: 0 },
    },
    { get: (t: Record<string | symbol, unknown>, k) => (k in t ? t[k] : fakeEl), set: () => true },
  );
  const doc = new Proxy(
    {
      createElement: () => fakeEl, createElementNS: () => fakeEl,
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener: noop, removeEventListener: noop,
      body: fakeEl, documentElement: fakeEl, head: fakeEl,
      fonts: { add: noop, ready: Promise.resolve() },
    },
    { get: (t: Record<string | symbol, unknown>, k) => (k in t ? t[k] : fakeEl), set: () => true },
  );

  const def = (k: string, v: unknown) => {
    try { Object.defineProperty(g, k, { value: v, configurable: true }); } catch { /* read-only global */ }
  };
  def('window', win);
  def('document', doc);
  def('navigator', { userAgent: 'node', maxTouchPoints: 0 });
  def('localStorage', localStorage);
  g.requestAnimationFrame = noop;
  g.cancelAnimationFrame = noop;
  g.AudioContext = (win as { AudioContext: unknown }).AudioContext;
  g.matchMedia = (win as { matchMedia: unknown }).matchMedia;
}
