/**
 * Allocation-site profiler — answers "WHO is allocating the 9 MB/s?"
 *
 * The perf CLI measures allocation churn (heap sawtooth → GC stutter) but not
 * its source. This drives Chrome's sampling heap profiler over CDP while a
 * scenario runs unfrozen, then aggregates the sampled allocation stacks and
 * prints the top allocating call sites mapped back to src/ files.
 *
 *   npm run alloc-profile                      (defaults to "perf-max")
 *   npm run alloc-profile perf-horde --secs=12
 *   npm run alloc-profile spawn phone
 *
 * Allocation behaviour is engine-level (V8), so headless swiftshader numbers
 * ARE representative here — unlike FPS, which is not. Rates scale with frame
 * rate though: headless may run uncapped or slower than a phone's 60fps, so
 * treat the BREAKDOWN (% by site) as the signal, the absolute MB/s as a rough
 * cross-check against `npm run perf`'s alloc-churn line.
 *
 * Sampling, not instrumentation: V8 samples 1 allocation per ~`SAMPLING_BYTES`
 * allocated (Poisson), so small-but-hot sites show up in proportion to their
 * total bytes. selfSize values are statistical estimates of TOTAL bytes
 * allocated at that site over the window — they include memory that was
 * immediately collected, which is exactly what we want (churn, not residency).
 */

import { withHarness, parseCommonArgs, num, pad, padL } from './perf-core';

const SAMPLING_BYTES = 16384;   // avg bytes between samples — fine enough for per-frame churn

// CDP SamplingHeapProfile shapes (subset we read).
interface CallFrame {
  functionName: string;
  url: string;
  lineNumber: number;   // 0-based
}
interface ProfileNode {
  callFrame: CallFrame;
  selfSize: number;
  children: ProfileNode[];
}
interface SamplingProfile { head: ProfileNode; }

interface SiteRow {
  key: string;
  fn: string;
  loc: string;
  bytes: number;
  /** Example stack (callee-last), for the heaviest occurrence of this site. */
  stack: string[];
  stackBytes: number;
}

function shortLoc(url: string, line: number): string {
  if (!url) return '(native/anonymous)';
  // Vite dev URLs: http://127.0.0.1:PORT/brainstorm/src/foo/bar.ts?t=...
  const m = url.match(/\/brainstorm\/(.+?)(\?|$)/);
  const path = m ? m[1] : url.replace(/^https?:\/\/[^/]+\//, '');
  return `${path}:${line + 1}`;
}

function frameLabel(f: CallFrame): string {
  return `${f.functionName || '(anonymous)'} ${shortLoc(f.url, f.lineNumber)}`;
}

/** Flatten the profile tree into per-site rows (aggregated by fn@file:line),
 *  keeping the heaviest example stack per site for context. */
function aggregate(head: ProfileNode): { rows: SiteRow[]; total: number } {
  const rows = new Map<string, SiteRow>();
  let total = 0;
  const path: string[] = [];

  const walk = (node: ProfileNode): void => {
    const label = frameLabel(node.callFrame);
    path.push(label);
    if (node.selfSize > 0) {
      total += node.selfSize;
      const key = label;
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          fn: node.callFrame.functionName || '(anonymous)',
          loc: shortLoc(node.callFrame.url, node.callFrame.lineNumber),
          bytes: 0, stack: [], stackBytes: 0,
        };
        rows.set(key, row);
      }
      row.bytes += node.selfSize;
      if (node.selfSize > row.stackBytes) {
        row.stackBytes = node.selfSize;
        row.stack = path.slice(-5, -1);   // 4 callers above the site
      }
    }
    for (const c of node.children) walk(c);
    path.pop();
  };
  walk(head);
  return { rows: [...rows.values()].sort((a, b) => b.bytes - a.bytes), total };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { positionals, viewport, viewportName, secs, port } = parseCommonArgs(argv);
  const scenario = positionals[0] ?? 'perf-max';
  const windowSecs = Math.max(secs, 8);   // short windows under-sample rare-but-big sites

  // Scenario-shaping flags ride through (--n=16 → ?n=16). god=1 by default:
  // a player death mid-window freezes the world and zeroes the churn we're
  // here to measure (DEV-only flag; this only ever runs against the dev server).
  const flags: Record<string, string> = { god: '1' };
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const body = a.slice(2);
    if (body.startsWith('secs=') || body.startsWith('port=')) continue;
    const eq = body.indexOf('=');
    if (eq === -1) flags[body] = '1';
    else flags[body.slice(0, eq)] = body.slice(eq + 1);
  }

  await withHarness({ viewport, port, onLog: (l) => console.log(l) }, async (h) => {
    await h.withPage({ scenario, flags, secs: 0 }, async (page) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.enable');
      // Let the post-load settle pass (level build, shader warmup) finish so
      // we sample steady-state gameplay churn, not boot allocations.
      await page.waitForTimeout(2000);
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: SAMPLING_BYTES });
      await page.waitForTimeout(windowSecs * 1000);
      const { profile } = await cdp.send('HeapProfiler.stopSampling') as { profile: SamplingProfile };

      const { rows, total } = aggregate(profile.head);
      const mb = (b: number): string => (b / (1024 * 1024)).toFixed(2);

      console.log(`\nALLOC PROFILE · scenario "${scenario}" · ${viewportName} · ${windowSecs}s window`);
      console.log(`total sampled churn: ${mb(total)} MB  (~${mb(total / windowSecs)} MB/s)`);
      console.log('\nTOP ALLOCATION SITES (estimated total bytes allocated, incl. immediately-collected)');
      console.log('─'.repeat(96));
      console.log(`  ${padL('MB', 7)}  ${padL('%', 5)}  site`);
      console.log('─'.repeat(96));
      for (const r of rows.slice(0, 25)) {
        const pctS = total ? ((r.bytes / total) * 100).toFixed(1) : '0';
        console.log(`  ${padL(mb(r.bytes), 7)}  ${padL(pctS, 5)}  ${pad(r.fn, 28)} ${r.loc}`);
        // Caller chain for the heaviest occurrence — the "who called this" context.
        for (const s of r.stack.slice().reverse()) console.log(`${' '.repeat(19)}↳ ${s}`);
      }
      console.log('─'.repeat(96));
      console.log(`  sites: ${num(rows.length)} · sampling interval ${num(SAMPLING_BYTES)} bytes · headless (engine-level churn is representative; FPS-dependent rates are not)\n`);
    });
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
