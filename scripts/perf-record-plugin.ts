// Vite dev-server plugin: receives performance RECORDINGS from the in-game
// recorder and writes them to disk, plus serves them back to the review page.
//
// Flow: phone hits the dev server (vite --host) → records a session → the
// browser POSTs the timeline JSON here → this writes perf-recordings/<id>.json
// on the PC. Then the PC opens /brainstorm/perf-review.html, which lists +
// loads recordings through this same endpoint. That's the "play on the phone,
// review on the PC over WiFi" loop, no USB needed.
//
// Endpoints (all under the dev server, dev-only — absent on the static build):
//   POST /__perf            { id, recording }       → writes perf-recordings/<id>.json
//   GET  /__perf/list                                → [{ id, ...meta }] newest-first
//   GET  /__perf/get?id=<id>                         → the raw recording JSON

import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT_ROOT = 'perf-recordings';

interface RecordPayload {
  id: string;
  recording: unknown;
}

export function perfRecordPlugin(): Plugin {
  return {
    name: 'delve-perf-record',
    configureServer(server) {
      const dir = join(process.cwd(), OUT_ROOT);

      // POST a recording.
      server.middlewares.use('/__perf', (req, res, next) => {
        // Only handle the exact POST-to-root case here; GETs fall through to
        // the list/get handlers registered below.
        if (req.method !== 'POST' || (req.url && req.url !== '/' && req.url !== '')) {
          next();
          return;
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as RecordPayload;
            const id = sanitizeId(payload.id);
            mkdirSync(dir, { recursive: true });
            const file = join(dir, id + '.json');
            writeFileSync(file, JSON.stringify(payload.recording ?? {}));
            // eslint-disable-next-line no-console
            console.log(`\n[perf-record] wrote ${OUT_ROOT}/${id}.json`);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, id, dir: `${OUT_ROOT}/${id}.json` }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
          }
        });
      });

      // GET the list of recordings (id + meta summary), newest first.
      server.middlewares.use('/__perf/list', (req, res) => {
        try {
          const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
          const out = files.map((f) => {
            const id = f.replace(/\.json$/, '');
            let meta: unknown = {};
            try { meta = (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { meta?: unknown }).meta ?? {}; } catch { /* skip */ }
            return { id, meta };
          });
          out.sort((a, b) => (a.id < b.id ? 1 : -1));   // ids are timestamps → newest first
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(out));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
        }
      });

      // GET one recording by id.
      server.middlewares.use('/__perf/get', (req, res) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost');
          const id = sanitizeId(url.searchParams.get('id') ?? '');
          const file = join(dir, id + '.json');
          if (!existsSync(file)) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: 'not found' }));
            return;
          }
          res.setHeader('content-type', 'application/json');
          res.end(readFileSync(file, 'utf8'));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
        }
      });
    },
  };
}

function sanitizeId(s: string): string {
  return String(s).replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) || 'rec';
}
