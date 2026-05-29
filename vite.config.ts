import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { debugCapturePlugin } from './scripts/debug-capture-plugin';

// Served from GitHub Pages at https://joshapp.github.io/brainstorm/
// so all built asset URLs need this sub-path prefix.
const BASE = '/brainstorm/';

export default defineConfig({
  base: BASE,
  plugins: [
    // Dev-only: receives in-game debug captures → debug-captures/<id>/.
    debugCapturePlugin(),
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
});
