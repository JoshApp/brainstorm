// Bundle scripts/replay-node.ts for Node with esbuild, handling the two
// Vite-isms the game code uses: import.meta.env (define) and virtual: modules
// (stub), then run the bundle (passing through CLI args: seed, steps).
//   npm run replay-node            (defaults)
//   npm run replay-node -- 777 600 (seed 777, 600 steps)
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';

const stubVirtuals = {
  name: 'stub-virtuals',
  setup(b) {
    b.onResolve({ filter: /^virtual:/ }, (a) => ({ path: a.path, namespace: 'virt' }));
    b.onLoad({ filter: /.*/, namespace: 'virt' }, () => ({
      contents: 'export const registerSW = () => {}; export default {};',
    }));
  },
};

// Vite asset imports (`import url from './x.woff2?url'`, ?raw, ?worker) resolve
// to a string URL under Vite; esbuild can't load them. The headless sim never
// renders fonts/assets, so stub every `?url`/`?raw` import to its bare path
// string. Keeps the Node bundle building as the app grows Vite-isms (e.g. the
// Grimoire UI's self-hosted fonts) without dragging real asset bytes in.
const stubAssetUrls = {
  name: 'stub-asset-urls',
  setup(b) {
    b.onResolve({ filter: /\?(url|raw|worker)$/ }, (a) => ({ path: a.path, namespace: 'asset-url' }));
    b.onLoad({ filter: /.*/, namespace: 'asset-url' }, (a) => ({
      contents: `export default ${JSON.stringify(a.path.replace(/\?(url|raw|worker)$/, ''))};`,
    }));
  },
};

await build({
  entryPoints: ['scripts/replay-node.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'import.meta.env.MODE': '"production"',
    'import.meta.env.SSR': 'false',
    // Vite serves the app under /brainstorm/; some modules read BASE_URL at load
    // (card-drop, card-reading, art viewer) to build asset URLs. Define it so the
    // headless Node bundle doesn't deref an undefined import.meta.env.
    'import.meta.env.BASE_URL': '"/brainstorm/"',
  },
  plugins: [stubVirtuals, stubAssetUrls],
  outfile: '/tmp/replay-node.mjs',
  logLevel: 'error',
});
const r = spawnSync('node', ['/tmp/replay-node.mjs', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 0);
