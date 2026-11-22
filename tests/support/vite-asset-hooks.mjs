// Node module hooks for running game code under tsx outside Vite. A Vite asset
// import (`./x.woff2?url`, `?raw`, `?worker`) resolves to its bare path string,
// the same stub scripts/build-replay-node.mjs applies under esbuild.
export async function resolve(specifier, context, next) {
  const m = /^(.*)\?(url|raw|worker)$/.exec(specifier);
  if (m) {
    const src = `export default ${JSON.stringify(m[1])};`;
    return { url: 'data:text/javascript,' + encodeURIComponent(src), shortCircuit: true };
  }
  return next(specifier, context);
}

// `import.meta.env` is Vite's; under plain Node it is undefined, so any game
// module that reads `.DEV` at top level throws on import. Give it the
// production values the live site is built with.
const ENV = '({ DEV: false, PROD: true, MODE: "production", BASE_URL: "/brainstorm/" })';
export async function load(url, context, next) {
  const r = await next(url, context);
  if (url.startsWith('file:') && url.includes('/src/') && r.source != null) {
    const src = typeof r.source === 'string' ? r.source : Buffer.from(r.source).toString('utf8');
    if (src.includes('import.meta.env')) return { ...r, source: src.replaceAll('import.meta.env', ENV) };
  }
  return r;
}
