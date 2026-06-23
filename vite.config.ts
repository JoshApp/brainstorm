import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { VitePWA } from 'vite-plugin-pwa';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Short commit SHA, stamped into the bundle as __BUILD_SHA__ so every crash /
// telemetry report is tied to the exact deploy it happened on (regression
// tracking + "did my fix land"). Falls back to 'dev' where git isn't available
// (some cloud build envs); CI builds from a checkout so it resolves there.
function buildSha(): string {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
}

// Source-map upload to Sentry — ONLY when all three env vars are present (set as
// CI secrets/vars in the deploy workflow). Absent → no plugin, builds untouched.
// It uploads the hidden .map files tagged with the release (build SHA) so prod
// stacks symbolicate, then DELETES them from dist so they're never served
// publicly. A no-op locally and for anyone without the Sentry secrets.
const SENTRY_UPLOAD = process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT;
const sentryPlugins = SENTRY_UPLOAD
  ? [sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: buildSha() },
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    })]
  : [];
import { debugCapturePlugin } from './scripts/debug-capture-plugin';
import { perfRecordPlugin } from './scripts/perf-record-plugin';
import { artFeedbackPlugin } from './scripts/art-feedback-plugin';

// Served from GitHub Pages at https://joshapp.github.io/brainstorm/
// so all built asset URLs need this sub-path prefix.
const BASE = '/brainstorm/';

export default defineConfig({
  base: BASE,
  // Replaced as a literal at build + dev-serve, so the identifier always exists.
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
  plugins: [
    ...sentryPlugins,
    // Dev-only: receives in-game debug captures → debug-captures/<id>/.
    debugCapturePlugin(),
    // Dev-only: receives perf recordings from the phone → perf-recordings/<id>.json,
    // and serves them back to /brainstorm/perf-review.html.
    perfRecordPlugin(),
    // Dev-only: receives art-suite feedback (stars · notes · drawings) → art-feedback/<id>/.
    artFeedbackPlugin(),
    VitePWA({
      // 'prompt' registration: new SWs install into the WAITING state and
      // do NOT auto-activate. src/pwa-update.ts decides when it's safe
      // to apply (title screen, explicit consent, harness.applyUpdate())
      // so a mid-floor deploy can't yank the game out from under a
      // running run. See src/pwa-update.ts for the policy.
      registerType: 'prompt',
      workbox: {
        // skipWaiting / clientsClaim deliberately OFF — the prompt-style
        // update flow is exactly what they would defeat.
        //
        // Precache the UI ASSET types too, not just code. The default glob is
        // `**/*.{js,css,html}`, which leaves fonts, the woodcut textures, and the
        // baked cards to re-fetch on every weak connection. Listing them here puts
        // them in the install-time precache → available offline and instant after
        // the first install. They're tiny (webp ~12–90KB, woff2 ~12–31KB), so the
        // precache stays small.
        globPatterns: ['**/*.{js,css,html,woff2,webp,svg,png,ico}'],
        // NEVER precache the gitignored art-exploration runs (public/art/runs/*.png
        // — ~1MB each, hundreds of them on a dev box). They're not in the repo so
        // CI never sees them, but a local build would otherwise balloon the
        // precache to hundreds of MB. Shipped card art lives in public/cards/.
        globIgnores: ['**/art/**'],
      },
      manifest: {
        name: 'Delve',
        short_name: 'Delve',
        description: 'Descend.',
        theme_color: '#0a0a0a',
        background_color: '#000000',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    // Runtime AI calls hit /api/ai. In dev, vite proxies that to the local
    // voice-shim (server/voice-shim); in prod the same path is the Cloudflare
    // Worker. Run `npm run voice-shim` alongside `npm run dev` (or `npm run dev:all`).
    proxy: {
      '/api/ai': 'http://localhost:8787',
    },
  },
  build: {
    // 'hidden' = emit .map files (so a captured minified stack can be
    // symbolicated, or uploaded to an error backbone later) WITHOUT advertising
    // them via sourceMappingURL — they're tooling, not in-browser exposure.
    sourcemap: 'hidden',
    rollupOptions: {
      // Ship the perf-review viewer alongside the game so a recording made on
      // the live build (which downloads a JSON, no dev server to POST to) can
      // be reviewed at /brainstorm/perf-review.html — just drag the JSON onto
      // it. (bench.html stays dev-only — not listed, so it isn't built.)
      input: {
        main: 'index.html',
        'perf-review': 'perf-review.html',
      },
    },
  },
});
