/**
 * AGGRO CHECK — does every hostile on a floor actually come at you?
 *
 *   npm run aggro                          (seed 7, depth 3)
 *   npm run aggro -- --seeds 7,31,99 --depth 6
 *
 * The bug this exists for (#173): enemies in ONE room stand on their spawn
 * points, track the player, and never charge — while the rest of the floor is
 * fine. Per-room, so it needs a REAL procgen floor, not a combat scenario, and
 * a way to stand in front of every enemy on it.
 *
 * For each hostile: find a spot 3m away with line of sight, teleport there,
 * take a step, let the world run 4s, and measure how far the enemy moved.
 * One that stays in `idle` having never closed is the report, as a number.
 *
 * ── THREE WAYS THIS MEASUREMENT LIED BEFORE IT WORKED ──────────────────────
 * Each one made a HEALTHY floor look broken, which is how a previous "fix"
 * for #173 got written against a phantom. Keep all three guards:
 *
 *  1. THE HARNESS PAUSES THE WORLD. A wall-clock sleep advances nothing —
 *     every mob read idle/0m. `harness.act({kind:'wait'})` is what steps it.
 *  2. ARRIVAL GRACE (player/arrival.ts) makes mob sight refuse the player for
 *     up to 45s until they ACT. A teleport is not an act, so a ghoul 3m away
 *     stayed idle and looked broken. One step ends it, as a real player does.
 *  3. LINE OF SIGHT IS NOT STANDING ROOM. A fixed 2.5m offset put the player
 *     through a wall — los=false, nothing saw anything. Pick the spot BY los,
 *     then confirm the teleport actually arrived.
 *
 * Known non-bugs it will still flag: the act boss (arena-gated, waits for you
 * to cross its fog wall) and maggots (never hostile — excluded outright).
 */
import { chromium, type Page } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
];
const CHROMIUM_PATH = CANDIDATES.find((p) => existsSync(p));
const argv = process.argv.slice(2);
const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const port = Number(get('--port') ?? 5600 + Math.floor(Math.random() * 200));
const seeds = (get('--seeds') ?? '7').split(',');
const depth = get('--depth') ?? '3';
// --reverse: same floor, enemies tested last-first. THE control for
// "is this enemy broken, or is it just the FIRST one tested?" — a probe
// that only ever fails on index 0 is measuring its own warm-up.
const reverse = argv.includes('--reverse');

async function main() {
  const repoRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
  const vite = spawn('node_modules/.bin/vite', ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let viteOut = '';
  vite.stdout?.on('data', (c: Buffer) => { viteOut += c.toString(); });
  vite.stderr?.on('data', (c: Buffer) => { viteOut += c.toString(); });
  const killVite = () => { try { process.kill(-vite.pid!, 'SIGTERM'); } catch { /* ignore */ } };
  const up = await new Promise<boolean>((r) => {
    const t = setInterval(() => { if (/Local:\s+http:\/\/.+:\d+/.test(viteOut)) { clearInterval(t); r(true); } }, 100);
    setTimeout(() => { clearInterval(t); r(false); }, 20_000);
  });
  if (!up) { console.error('vite failed:\n' + viteOut); killVite(); process.exit(1); }

  const browser = await chromium.launch({
    ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
  });
  const page: Page = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
  try {
    for (const seed of seeds) {
      const url = `http://127.0.0.1:${port}/brainstorm/?harness=1&autostart=1&seed=${seed}&depth=${depth}&dev=1&god=1&freeze=false`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 40_000 });
      await page.waitForFunction(() => Boolean((window as { harness?: unknown }).harness), { timeout: 20_000 });
      const ok = await page.evaluate(`(async () => Promise.race([
        window.harness.ready.then(() => true),
        new Promise((r) => setTimeout(() => r(false), 15000)),
      ]))()`);
      if (!ok) { console.log(`seed ${seed}: harness never ready`); continue; }

      const rooms = await page.evaluate(`(() => {
        const lvl = window.__level ? window.__level() : null;
        const spec = lvl && lvl.spec;
        if (!spec) return [];
        return spec.rooms.map((r) => ({ id: r.id, x: r.rect.x + r.rect.w / 2, z: r.rect.z + r.rect.d / 2 }));
      })()`) as Array<{ id: string; x: number; z: number }>;
      if (!rooms.length) { console.log(`seed ${seed}: no rooms readable (need window.__level)`); continue; }

      console.log(`\n── seed ${seed} · depth ${depth} · ${rooms.length} rooms ──`);
      void rooms;
      const res = await page.evaluate(`(async () => {
        const REVERSE = ${reverse};
        const lvl = window.__level();
        const W = lvl.walkable;
        const out = [];
        // Maggots never hunt (hostileToPlayer false) and dormant bosses wait for
        // their gate — neither is the reported behaviour, so neither is tested.
        const hostiles = lvl.enemies.filter((e) => e.alive && e.kind !== 'maggot' && e.aiState !== 'dormant');
        if (REVERSE) hostiles.reverse();
        // WARM-UP, DISCARDED. The first enemy measured is unreliable: the wake
        // ceremony (player/arrival.ts) can still be running, and while it is,
        // NOTHING is allowed to see the player. Measured: whichever hostile came
        // first failed, and --reverse moved the failure to a different enemy —
        // the sweep was reading its own start-up as a broken mob. So burn one
        // pass on the first hostile and throw the result away.
        if (hostiles.length) {
          const w = hostiles[0];
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            const px = w.position.x + Math.cos(a) * 3, pz = w.position.z + Math.sin(a) * 3;
            if (W.hasLineOfSight(w.position.x, w.position.z, px, pz)) { window.__teleport(px, pz, 0); break; }
          }
          await window.harness.act({ kind: 'move', dir: 'N', seconds: 0.12 });
          await window.harness.act({ kind: 'wait', seconds: 3 });
        }
        for (const e of hostiles) {
          const ex = e.position.x, ez = e.position.z;
          // STAND WHERE IT CAN SEE YOU. A fixed offset put the player through a
          // wall (los=false at 2.5m) and every hostile read as idle — the probe
          // was testing occlusion, not AI. Try 8 spots at 3m and keep one with
          // line of sight; if none has it, the enemy is unreachable from any
          // near-by standing spot and gets reported as such rather than as stuck.
          let spot = null;
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            const px = ex + Math.cos(a) * 3, pz = ez + Math.sin(a) * 3;
            if (W.hasLineOfSight(ex, ez, px, pz)) { spot = { x: px, z: pz }; break; }
          }
          if (!spot) { out.push({ kind: e.kind, state: e.aiState, moved: -1, note: 'no-los-spot' }); continue; }
          window.__teleport(spot.x, spot.z, 0);
          // A spot with LINE OF SIGHT is not necessarily a spot you can STAND
          // in — teleport can refuse or clamp. If the player did not actually
          // arrive, this enemy was never tested, and calling it stuck would be
          // the third probe artifact in a row.
          const pp = window.harness.observe().player.pos;
          const arrived = Math.hypot(pp.x - spot.x, pp.z - spot.z);
          // ARRIVAL GRACE (player/arrival.ts) refuses mob sight for up to 45s
          // until the player ACTS. A teleport is not an act — without this step
          // every hostile reads idle at 3m and the floor looks broken.
          await window.harness.act({ kind: 'move', dir: 'N', seconds: 0.12 });
          const x0 = e.position.x, z0 = e.position.z;
          await window.harness.act({ kind: 'wait', seconds: 4 });
          const moved = Math.hypot(e.position.x - x0, e.position.z - z0);
          const pp2 = window.harness.observe().player.pos;
          const distNow = Math.hypot(e.position.x - pp2.x, e.position.z - pp2.z);
          out.push({
            kind: e.kind, state: e.aiState, moved: +moved.toFixed(2),
            note: arrived > 1 ? 'teleport-missed(' + arrived.toFixed(1) + 'm)' : '',
            at: e.position.x.toFixed(1) + ',' + e.position.z.toFixed(1),
            dist: +distNow.toFixed(1),
          });
        }
        // RETEST THE FLAGGED ONES, LAST. The first enemy tested is also the one
        // where arrival grace is most likely still up — so "the first enemy never
        // noticed me" has a boring explanation that has to be excluded before a
        // real one is claimed. By the end of the sweep the player has moved,
        // fought and been seen; anything still rooted here is rooted for real.
        for (const r of out) {
          if (r.note || r.moved >= 0.25) continue;
          const e = hostiles.find((h) => h.position.x.toFixed(1) + ',' + h.position.z.toFixed(1) === r.at);
          if (!e) continue;
          const ex = e.position.x, ez = e.position.z;
          let spot = null;
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            const px = ex + Math.cos(a) * 3, pz = ez + Math.sin(a) * 3;
            if (W.hasLineOfSight(ex, ez, px, pz)) { spot = { x: px, z: pz }; break; }
          }
          if (!spot) continue;
          window.__teleport(spot.x, spot.z, 0);
          await window.harness.act({ kind: 'move', dir: 'N', seconds: 0.12 });
          const rx = e.position.x, rz = e.position.z;
          await window.harness.act({ kind: 'wait', seconds: 4 });
          r.retestMoved = +Math.hypot(e.position.x - rx, e.position.z - rz).toFixed(2);
          r.retestState = e.aiState;
        }
        return out;
      })()`) as Array<{ kind: string; state: string; moved: number; note: string; at?: string; dist?: number; retestMoved?: number; retestState?: string }>;
      const engaged = new Set(['alerted', 'chasing', 'winding', 'striking', 'recovering', 'searching']);
      let stuck = 0;
      for (const r of res) {
        const bad = !r.note && r.moved < 0.25 && !engaged.has(r.state);
        const eng = engaged.has(r.state) && r.moved < 0.25;
        if (bad || eng) stuck++;
        console.log(`  ${String(r.kind).padEnd(15)} ${String(r.state).padEnd(10)} moved ${String(r.moved).padStart(5)}m  at(${r.at ?? '?'}) dist=${r.dist ?? '?'} ${r.note}${r.retestState ? `  RETEST ${r.retestState}/${r.retestMoved}m` : ''}`
          + (eng ? '  ← ENGAGED BUT ROOTED' : bad ? '  ← NEVER NOTICED' : ''));
      }
      console.log(`  → ${stuck}/${res.length} suspicious`);
    }
  } finally {
    await browser.close();
    killVite();
  }
}
main();
