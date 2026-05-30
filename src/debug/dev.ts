// Single source of truth for "is this a developer build?".
//
// Vite statically replaces `import.meta.env.DEV` with a literal: `true` under
// the dev server (`npm run dev`) and `false` under `vite build` — which is
// what the GitHub Actions deploy runs to publish the live site. So every
// `if (DEV) { … }` block collapses to `if (false) { … }` in the production
// bundle and is dead-code-eliminated by the minifier.
//
// THE RULE: every cheat or debug-only affordance — godmode, scenario jumps,
// `window.__*` inspection hooks, debug-only URL flags — must sit behind this
// gate (either an `if (DEV)` guard or a `DEV && …` short-circuit). That way
// it cannot be reached, toggled, or even shipped in the live build. Diagnostic
// tooling that's safe for players (and already inert on the static deploy,
// like the dev-server `/__debug/capture` endpoint) is the only exception.
//
// Prefer guarding with the literal `import.meta.env.DEV` at the call site when
// you specifically want a whole module tree-shaken out (the bundler is most
// aggressive when it sees the literal). Use this re-exported `DEV` for plain
// readable runtime checks; esbuild inlines it to the same literal.
export const DEV: boolean = import.meta.env.DEV;
