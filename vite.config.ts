import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from GitHub Pages at https://joshapp.github.io/brainstorm/
// so all built asset URLs need this sub-path prefix.
const BASE = '/brainstorm/';

export default defineConfig({
  base: BASE,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
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
