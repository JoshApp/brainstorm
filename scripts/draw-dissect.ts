/**
 * Draw dissection — reads window.__drawData() across a count sweep and shows
 * the per-unit delta of BOTH "drawables" (actual visible meshes/sprites/points
 * = the scene pass) and "draws" (renderer.info.render.calls = scene + shadow +
 * bloom/blit). When the draws delta exceeds the drawables delta, the gap is the
 * shadow/post passes, not geometry — the calibration every absolute count needs.
 *
 *   npm run draw-dissect perf-items phone n=1 n=2
 *   npm run draw-dissect perf-creatures phone n=1 n=2 n=4
 *
 * First token after the viewport is the baseline; deltas are vs the previous.
 */

import { withHarness, parseCommonArgs, num, pad, padL } from './perf-core';

interface DrawData {
  draws: number; rtris: number; drawables: number;
  meshes: number; sprites: number; points: number;
  shadowCasters: number; transparent: number; sceneTris: number;
  programs: number; geometries: number; textures: number;
  lightsActive: number; lightsShadow: number;
  bySource: Record<string, number>;
  mergedDraws: number; mergeableNow: number; dynamicDraws: number;
}

function flagsOf(token: string): { flags: Record<string, string>; label: string } {
  if (token === 'base' || token === '-') return { flags: {}, label: 'base' };
  const flags: Record<string, string> = {};
  for (const piece of token.split(',')) {
    const eq = piece.indexOf('=');
    if (eq === -1) flags[piece] = '1'; else flags[piece.slice(0, eq)] = piece.slice(eq + 1);
  }
  return { flags, label: token };
}

async function main() {
  const argv = process.argv.slice(2);
  const { positionals, viewport, viewportName, port } = parseCommonArgs(argv);
  const scenario = positionals[0] ?? 'perf-items';
  const tokens = positionals.slice(1).length ? positionals.slice(1) : ['n=1', 'n=2'];
  const variants = tokens.map(flagsOf);

  console.log(`\nDRAW DISSECT · "${scenario}" · ${viewportName} ${viewport.width}×${viewport.height}`);

  await withHarness({ viewport, port, onLog: (l) => console.log('  ' + l) }, async (h) => {
    const rows: Array<{ label: string; d: DrawData }> = [];
    for (const v of variants) {
      const d = await h.read<DrawData | null>({ scenario, flags: v.flags }, '__drawData');
      if (!d || d.drawables === undefined) {
        console.error(`  __drawData returned: ${JSON.stringify(d)} (DEV server? probe wired?)`);
        return;
      }
      rows.push({ label: v.label, d });
    }
    const cols = ['drawables', 'draws', 'shadowCasters', 'transparent', 'meshes', 'sprites'] as const;
    const W = 13;
    console.log('\n  ' + pad('variant', 16) + cols.map((c) => padL(c, W)).join(''));
    console.log('  ' + '─'.repeat(16 + cols.length * W));
    let prev: DrawData | null = null;
    for (const { label, d } of rows) {
      const cells = cols.map((c) => {
        const v = d[c as keyof DrawData] as number;
        const delta = prev ? v - (prev[c as keyof DrawData] as number) : null;
        return padL(num(v) + (delta !== null ? ` (${delta >= 0 ? '+' : ''}${num(delta)})` : ''), W);
      });
      console.log('  ' + pad(label, 16) + cells.join(''));
      prev = d;
    }
    console.log('  ' + '─'.repeat(16 + cols.length * W));
    console.log('  drawables = scene-pass objects · draws = all passes (scene+shadow+post)');

    // Per-owner breakdown of the LAST variant — "where do the draws go".
    const last = rows[rows.length - 1].d;
    const srcEntries = Object.entries(last.bySource).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    console.log(`\n  WHERE THE DRAWABLES GO (${rows[rows.length - 1].label}):`);
    console.log('  ' + srcEntries.map(([k, n]) => `${n} ${k}`).join('  ·  '));
    console.log(`  MERGEABILITY: ${last.mergedDraws} merged · ${last.mergeableNow} loose-static (mergeable now) · ${last.dynamicDraws} dynamic\n`);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
