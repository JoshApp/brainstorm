import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { debugCapturePlugin } from './scripts/debug-capture-plugin';
import { perfRecordPlugin } from './scripts/perf-record-plugin';
import { artFeedbackPlugin } from './scripts/art-feedback-plugin';

// Served from GitHub Pages at https://joshapp.github.io/brainstorm/
// so all built asset URLs need this sub-path prefix.
const BASE = '/brainstorm/';

export default defineConfig({
  base: BASE,
  plugins: [
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
  },
  build: {
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
