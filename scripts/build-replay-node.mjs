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
  },
  plugins: [stubVirtuals],
  outfile: '/tmp/replay-node.mjs',
  logLevel: 'error',
});
const r = spawnSync('node', ['/tmp/replay-node.mjs', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 0);
