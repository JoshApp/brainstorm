/**
 * Bench CLI — headless capture from the standalone asset bench (bench.html).
 * Unlike `snap`, this renders the subject in an isolated editor scene (no game,
 * no HUD, no fog, no PSX post) and prints a structured JSON readout alongside
 * the image. This is the fast author→render→look loop for models/items.
 *
 *   npm run bench mob-ghoul                  hero shot → /tmp/bench-mob-ghoul.png
 *   npm run bench viewmodel-reapers-toll     a weapon's held model
 *   npm run bench item-healing-potion        an item's drop model
 *   npm run bench mob-wraith --grid=12       12-angle turntable contact sheet
 *   npm run bench mob-ghoul --anim=8         telegraph windup→strike→recover sheet
 *   npm run bench mob-ghoul --az=60 --el=25  explicit camera angle
 *
 *   ── Debug-iteration flags (compose freely) ─────────────────────────
 *   npm run bench viewmodel-rusted --ortho   FRONT/SIDE/TOP/ISO 2×2 contact sheet
 *   npm run bench viewmodel-rusted --gnomon  overlay an RGB axis at origin
 *   npm run bench viewmodel-rusted --debug   color-by-part + slot markers + bbox
 *   npm run bench viewmodel-rusted --ortho --debug    both at once (recommended)
 *
 *   ── Composition (weapon subjects only) ─────────────────────────────
 *   npm run bench viewmodel-rusted --hand    drop the weapon into the hand
 *                                            (same composition as the game
 *                                            viewmodel — grip aligned to palm,
 *                                            finger curl adapted to grip radius)
 *   npm run bench viewmodel-rusted --hand --ortho --debug    the full iteration view
 *
 *   ── Targeted call-outs ─────────────────────────────────────────────
 *   npm run bench model-hand-right --debug --highlight=finger_thumb,finger_index
 *                                            magenta-flag the named slots/parts,
 *                                            dim the rest
 *
 *   ── Live edit (browser only) ───────────────────────────────────────
 *   npm run dev — then visit /brainstorm/bench.html?subject=model-hand-right&edit=1
 *   for sliders on every slot's pos/rot, with a "Copy spec" button that
 *   dumps the edited values to the dev console. (NOT supported via the
 *   CLI — needs an interactive browser session.)
 *
 *   npm run bench --list                     print every subject id
 *
 * Output: /tmp/bench-<subject>.png (+ -grid.png in grid mode, -ortho/-debug as needed).
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
].find((p) => existsSync(p));

async function main() {
  const subject = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  const listOnly = process.argv.includes('--list');
  const gridN = Number(process.argv.find((a) => a.startsWith('--grid='))?.split('=')[1] ?? 0);
  const animN = Number(process.argv.find((a) => a.startsWith('--anim='))?.split('=')[1] ?? 0);
  const az = process.argv.find((a) => a.startsWith('--az='))?.split('=')[1];
  const el = process.argv.find((a) => a.startsWith('--el='))?.split('=')[1];
  const orthoMode = process.argv.includes('--ortho');
  const lightsMode = process.argv.includes('--lights');
  const gnomonMode = process.argv.includes('--gnomon');
  const debugMode = process.argv.includes('--debug');
  const handMode = process.argv.includes('--hand');
  const highlight = process.argv.find((a) => a.startsWith('--highlight='))?.split('=')[1] ?? '';
  const light = process.argv.find((a) => a.startsWith('--light='))?.split('=')[1] ?? '';
  const port = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 5190 + Math.floor(Math.random() * 60));

  if (!subject && !listOnly) {
    console.error('usage: npm run bench <subject-id> [--grid=N] [--az=deg] [--el=deg]\n       npm run bench --list');
    process.exit(1);
  }
  if (!CHROMIUM) { console.error('Chromium not found in known locations'); process.exit(1); }
  if (!existsSync('/tmp')) mkdirSync('/tmp');

  // 1. Vite dev server (process-group leader so we can kill the whole tree).
  const vite = spawn('node_modules/.bin/vite', ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  vite.stdout?.on('data', (c: Buffer) => (out += c));
  vite.stderr?.on('data', (c: Buffer) => (out += c));
  const ready = await new Promise<boolean>((res) => {
    const t = setInterval(() => { if (/Local:\s+http/.test(out)) { clearInterval(t); res(true); } }, 100);
    setTimeout(() => { clearInterval(t); res(false); }, 20000);
  });
  if (!ready) { console.error('Vite did not start:\n' + out); vite.kill(); process.exit(1); }

  const kill = () => { try { process.kill(-vite.pid!, 'SIGKILL'); } catch {} };

  // 2. Headless Chromium.
  const browser = await chromium.launch({
    executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900, deviceScaleFactor: 1 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));

    const q = new URLSearchParams();
    if (subject) q.set('subject', subject);
    if (gridN > 0) q.set('grid', String(gridN));
    if (animN > 0) q.set('anim', String(animN));
    if (az) q.set('az', az);
    if (el) q.set('el', el);
    if (orthoMode) q.set('ortho', '1');
    if (lightsMode) q.set('lights', '1');
    if (gnomonMode) q.set('gnomon', '1');
    if (debugMode) q.set('debug', '1');
    if (handMode) q.set('hand', '1');
    if (highlight) q.set('highlight', highlight);
    if (light) q.set('light', light);
    const url = `http://127.0.0.1:${port}/brainstorm/bench.html?${q.toString()}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__bench?.ready === true, { timeout: 10000 });
    await page.waitForTimeout(250);   // let the on-demand render settle

    if (listOnly) {
      const subjects = await page.evaluate(() => window.__bench.subjects());
      console.log(subjects.join('\n'));
      console.log(`\n${subjects.length} subjects`);
    } else {
      const readout = await page.evaluate(() => window.__bench.readout());
      // Suffix mirrors the active mode so different debug snaps don't clobber
      // each other when you run them back-to-back.
      const suffix =
        animN > 0 ? '-anim'
        : lightsMode ? '-lights'
        : handMode && orthoMode && debugMode ? '-hand-ortho-debug'
        : handMode && orthoMode ? '-hand-ortho'
        : handMode && debugMode ? '-hand-debug'
        : handMode ? '-hand'
        : orthoMode && debugMode ? '-ortho-debug'
        : orthoMode ? '-ortho'
        : debugMode ? '-debug'
        : gridN > 0 ? '-grid'
        : '';
      const outPath = `/tmp/bench-${subject}${suffix}.png`;
      // Screenshot the FULL PAGE instead of just the canvas — the new
      // ortho mode paints per-tile labels via DOM overlay, and we want
      // those baked into the capture too. Debug snaps also benefit from
      // catching the gnomon HUD if we add one later.
      await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 1200, height: 900 } });
      console.log(JSON.stringify(readout, null, 2));
      console.log(`\nSaved ${outPath}`);
    }
  } finally {
    await browser.close();
    kill();
  }
  process.exit(0);
}

main();
