// Bundle scripts/replay-run.ts for Node with esbuild (handles Vite-isms the
// game code uses: import.meta.env defines + virtual: modules). Builds to
// /tmp/replay-run.mjs. With CLI args, also runs it (passing them through);
// the verifier builds once then runs the bundle per tape.
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

// Asset imports (fonts/images/css, incl. Vite's `?url` suffix) — the headless
// replay never renders, so resolve them to an empty string. esbuild has no
// loader for .woff2 etc.; without this the UI graph (fonts.ts) fails the build.
const stubAssets = {
  name: 'stub-assets',
  setup(b) {
    b.onResolve({ filter: /\.(woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|css)(\?\S*)?$/ }, (a) => ({
      path: a.path, namespace: 'asset',
    }));
    b.onLoad({ filter: /.*/, namespace: 'asset' }, () => ({ contents: 'export default "";' }));
  },
};

export const OUT = '/tmp/replay-run.mjs';

export async function buildReplayer() {
  await build({
    entryPoints: ['scripts/replay-run.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
      'import.meta.env.MODE': '"production"',
      'import.meta.env.SSR': 'false',
      'import.meta.env.BASE_URL': '"/"',
    },
    plugins: [stubVirtuals, stubAssets],
    outfile: OUT,
    logLevel: 'error',
  });
}

// Run directly (build + optionally execute with passed args) when invoked as a
// script, not when imported by the verifier.
if (import.meta.url === `file://${process.argv[1]}`) {
  await buildReplayer();
  const args = process.argv.slice(2);
  if (args.length) {
    const r = spawnSync('node', [OUT, ...args], { stdio: 'inherit' });
    process.exit(r.status ?? 0);
  }
}
