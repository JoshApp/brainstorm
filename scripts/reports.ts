// Bug-report PULLER — fetch player-filed reports from the collector into a
// triage list (and optionally dump each report's JSON + screenshot to disk).
//
//   npm run delve reports              # list the most recent reports
//   npm run delve reports -- --limit 50
//   npm run delve reports -- --dump    # also write JSON + PNG per report to ./reports-dump/
//
// Reads the collector from the environment (NOT embedded in the game — this is
// the READ side, which uses a privileged key):
//   REPORT_ENDPOINT   e.g. https://<project>.supabase.co/rest/v1/reports
//   REPORT_READ_KEY   a service_role key (or a key whose RLS allows SELECT)
//
// ── One-time collector setup (Supabase, free tier) ──────────────────────────
//   1. Create a project. In the SQL editor:
//        create table reports (
//          id bigint generated always as identity primary key,
//          created_at timestamptz default now(),
//          data jsonb
//        );
//        alter table reports enable row level security;
//        create policy "anon insert" on reports for insert to anon with check (true);
//   2. Game build env (embedded, safe — insert-only): set in .env / CI:
//        VITE_REPORT_ENDPOINT = https://<project>.supabase.co/rest/v1/reports
//        VITE_REPORT_KEY      = <the project's anon public key>
//   3. Pull env (local, privileged — never commit):
//        REPORT_ENDPOINT  = https://<project>.supabase.co/rest/v1/reports
//        REPORT_READ_KEY  = <the project's service_role key>

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface Row {
  id: number | string;
  created_at?: string;
  data?: Record<string, unknown>;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name: string) => process.argv.includes(name);

async function main() {
  const endpoint = process.env.REPORT_ENDPOINT;
  const key = process.env.REPORT_READ_KEY;
  if (!endpoint || !key) {
    console.error('Set REPORT_ENDPOINT + REPORT_READ_KEY (see the header of scripts/reports.ts for the one-time collector setup).');
    process.exit(1);
  }
  const limit = Number(arg('--limit', '25'));
  const url = `${endpoint}?select=*&order=created_at.desc&limit=${limit}`;
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.error(`Collector returned ${res.status} ${res.statusText}\n${await res.text()}`);
    process.exit(1);
  }
  const rows = (await res.json()) as Row[];
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('No reports.');
    return;
  }

  console.log(`\n${rows.length} report(s), newest first:\n`);
  for (const row of rows) {
    const d = (row.data ?? {}) as Record<string, any>;
    const when = row.created_at ?? (d.at ? new Date(d.at).toISOString() : '?');
    const text = String(d.userText ?? '').replace(/\s+/g, ' ').trim() || '(no description)';
    const run = d.run ?? {};
    const shot = d.screenshot ? 'shot✓' : 'no-shot';
    console.log(`#${row.id}  ${when}`);
    console.log(`   build ${d.build ?? '?'} · depth ${run.depth ?? '?'} · floor ${run.floorId ?? '?'} · seed ${run.seed ?? '?'} · ${shot}`);
    console.log(`   "${text.length > 160 ? text.slice(0, 157) + '…' : text}"\n`);
  }

  if (has('--dump')) {
    const dir = arg('--dump-dir', 'reports-dump')!;
    mkdirSync(dir, { recursive: true });
    for (const row of rows) {
      const d = (row.data ?? {}) as Record<string, any>;
      const base = `report-${row.id}`;
      writeFileSync(join(dir, `${base}.json`), JSON.stringify(row, null, 2));
      // Decode the screenshot data URL to a PNG next to the JSON.
      if (typeof d.screenshot === 'string') {
        const m = d.screenshot.match(/^data:image\/png;base64,(.*)$/);
        if (m) writeFileSync(join(dir, `${base}.png`), Buffer.from(m[1], 'base64'));
      }
    }
    console.log(`Dumped ${rows.length} report(s) → ${dir}/`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
