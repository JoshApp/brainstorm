// Vite dev-server plugin: receives debug captures from the in-game
// CAPTURE button and writes them to disk so Claude can read them by id.
//
// Flow: phone hits the dev server (vite --host) → taps CAPTURE → the
// browser POSTs the bundle here → this writes debug-captures/<id>/ with
// report.txt, snapshot.json, and the PNG layers. Josh pastes "read
// debug capture <id>" and Claude reads the folder.
//
// Dev-only: this middleware exists only on the Vite dev server. On the
// static GitHub Pages build there's no backend, so the client falls
// back to clipboard + download (see src/debug/debug-button.ts).

import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_ROOT = 'debug-captures';

interface CapturePayload {
  id: string;
  report: string;
  snapshot: unknown;
  images: Array<{ name: string; dataUrl: string }>;
}

export function debugCapturePlugin(): Plugin {
  return {
    name: 'delve-debug-capture',
    configureServer(server) {
      server.middlewares.use('/__debug/capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as CapturePayload;
            const id = sanitizeId(payload.id);
            const dir = join(process.cwd(), OUT_ROOT, id);
            mkdirSync(dir, { recursive: true });

            writeFileSync(join(dir, 'report.txt'), payload.report ?? '');
            writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(payload.snapshot ?? {}, null, 2));
            for (const img of payload.images ?? []) {
              const b64 = img.dataUrl.replace(/^data:image\/png;base64,/, '');
              writeFileSync(join(dir, sanitizeId(img.name) + '.png'), Buffer.from(b64, 'base64'));
            }

            // eslint-disable-next-line no-console
            console.log(`\n[debug-capture] wrote ${OUT_ROOT}/${id}/ (${(payload.images ?? []).length} images)`);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, id, dir: `${OUT_ROOT}/${id}` }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
          }
        });
      });
    },
  };
}

function sanitizeId(s: string): string {
  return String(s).replace(/[^a-z0-9_-]/gi, '_').slice(0, 60) || 'capture';
}
