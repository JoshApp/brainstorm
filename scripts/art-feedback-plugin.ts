// Vite dev-server plugin: the art suite's feedback channel.
//
// The art viewer (/art.html) lets Josh star runs, write a note, and DRAW on
// images, then Submit. That POSTs here; we write a submission folder to disk:
//
//   art-feedback/<id>/submission.json   note · selections · direction
//   art-feedback/<id>/draw-<runId>.png  each annotated image (base + strokes)
//
// A background watcher (started by Claude) blocks on new submissions and wakes
// Claude with the folder, who reads the note + opens the drawings as images and
// forks the next round from exactly what was marked. Dev-only; gitignored.
import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_ROOT = 'art-feedback';

interface Drawing { runId: string; dataUrl: string }
interface FeedbackPayload {
  note?: string;
  direction?: string;
  selections?: string[];          // run ids starred as "more of this"
  rejects?: string[];             // run ids marked "not this"
  drawings?: Drawing[];
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

export function artFeedbackPlugin(): Plugin {
  return {
    name: 'delve-art-feedback',
    configureServer(server) {
      server.middlewares.use('/__art/feedback', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const p = JSON.parse(body) as FeedbackPayload;
            const id = `${Date.now()}`;
            const dir = join(process.cwd(), OUT_ROOT, id);
            mkdirSync(dir, { recursive: true });

            const drawingFiles: string[] = [];
            for (const d of p.drawings ?? []) {
              const name = `draw-${sanitize(d.runId)}.png`;
              const b64 = d.dataUrl.replace(/^data:image\/png;base64,/, '');
              writeFileSync(join(dir, name), Buffer.from(b64, 'base64'));
              drawingFiles.push(name);
            }
            writeFileSync(join(dir, 'submission.json'), JSON.stringify({
              id,
              at: new Date().toISOString(),
              note: p.note ?? '',
              direction: p.direction ?? '',
              selections: p.selections ?? [],
              rejects: p.rejects ?? [],
              drawings: drawingFiles,
            }, null, 2));

            // eslint-disable-next-line no-console
            console.log(`\n[art-feedback] ${OUT_ROOT}/${id}/  ★${(p.selections ?? []).length} ✎${drawingFiles.length}  "${(p.note ?? '').slice(0, 60)}"`);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, id }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
          }
        });
      });
    },
  };
}
