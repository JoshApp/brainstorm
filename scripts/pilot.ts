/**
 * pilot.ts — Claude drives + inspects the live world, turn by turn.
 *
 * Same harness as play.ts, but the BRAIN is me, not the dumb-AI bot: I supply
 * an action script and read back the structured observation + an annotated
 * screenshot after each step. This is the "give Claude hands and eyes" tool —
 * walk into a room I authored, look around, poke an interactable, confirm an
 * enemy's state — instead of guessing from a single static snap.
 *
 *   npm run pilot -- --seed 42 --depth 7 --do "observe; turn 180; move N 1; interact"
 *
 * Flags:
 *   --seed N        run seed (default random)
 *   --depth M       start depth (default 1)
 *   --do "..."      ';'-separated action script (see VERBS below). Default: just observe.
 *   --out DIR       output dir (default /tmp/pilot-<ts>)
 *   --viewport NAME desktop|phone|... (default desktop)
 *   --port N        vite port (default randomized)
 *
 * Action verbs (';'-separated):
 *   observe              print the observation again (no world time)
 *   shot                 force an annotated screenshot here
 *   turn <deg>           rotate view by <deg> (right = positive)
 *   move <DIR> [sec]     walk DIR (N/NE/E/SE/S/SW/W/NW) for [sec] s (default 0.25)
 *   attack               swing
 *   interact             use the in-range interactable
 *   wait [sec]           let the world run [sec] s (default 0.5)
 *   inspect <id>         detailed read of entity/interactable <id>
 *
 * Output: observation text streamed to stdout (so I read it in the tool
 * result) + screenshots/step-NNN.png (annotated) for me to look at.
 */

import { chromium, type ConsoleMessage, type Page } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
  process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
];
const CHROMIUM_PATH = CANDIDATES.find((p) => existsSync(p));
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  desktop: { width: 1280, height: 600 },
  phone: { width: 844, height: 390 },
  'phone-portrait': { width: 390, height: 844 },
  tablet: { width: 1024, height: 768 },
};

const argv = process.argv.slice(2);
const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const seed = Number(get('--seed') ?? Math.floor(Math.random() * 1e9));
const depth = Number(get('--depth') ?? 1);
const doScript = get('--do') ?? 'observe';
const viewport = get('--viewport') ?? 'desktop';
const port = Number(get('--port') ?? 5180 + Math.floor(Math.random() * 200));
const out = get('--out') ?? `/tmp/pilot-${Date.now()}`;
const vp = VIEWPORTS[viewport] ?? VIEWPORTS.desktop;

type Step =
  | { meta: 'observe' | 'shot' }
  | { action: Record<string, unknown> };

/** Parse the ';'-separated --do script into steps. */
function parseScript(s: string): Step[] {
  const steps: Step[] = [];
  for (const raw of s.split(';').map((t) => t.trim()).filter(Boolean)) {
    const [verb, ...rest] = raw.split(/\s+/);
    switch (verb) {
      case 'observe': steps.push({ meta: 'observe' }); break;
      case 'shot':    steps.push({ meta: 'shot' }); break;
      case 'turn':    steps.push({ action: { kind: 'turn', angle: (Number(rest[0]) || 0) * Math.PI / 180 } }); break;
      case 'move':    steps.push({ action: { kind: 'move', dir: rest[0] ?? 'N', seconds: rest[1] ? Number(rest[1]) : undefined } }); break;
      case 'attack':  steps.push({ action: { kind: 'attack' } }); break;
      case 'interact':steps.push({ action: { kind: 'interact' } }); break;
      case 'wait':    steps.push({ action: { kind: 'wait', seconds: rest[0] ? Number(rest[0]) : 0.5 } }); break;
      case 'inspect': steps.push({ action: { kind: 'inspect', id: rest[0] } }); break;
      default: console.log(`  (skipping unknown verb '${verb}')`);
    }
  }
  return steps;
}

async function shot(page: Page, label: string): Promise<void> {
  const s = await page.evaluate(async () => (window as { harness?: { screenshot(o: { annotated: boolean }): Promise<{ pngDataUrl: string; annotations: unknown }> } }).harness!.screenshot({ annotated: true }));
  const buf = Buffer.from(s.pngDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  writeFileSync(join(out, `${label}.png`), buf);
}

async function observeText(page: Page): Promise<string> {
  return page.evaluate(() => (window as { harness?: { observeText(): string } }).harness!.observeText());
}

async function main() {
  mkdirSync(out, { recursive: true });
  const repoRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
  const vite = spawn('node_modules/.bin/vite', ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let viteOut = '';
  vite.stdout?.on('data', (c: Buffer) => { viteOut += c.toString(); });
  vite.stderr?.on('data', (c: Buffer) => { viteOut += c.toString(); });
  const killVite = () => { try { process.kill(-vite.pid!, 'SIGTERM'); } catch { /* ignore */ } };
  const ready = await new Promise<boolean>((resolve) => {
    const t = setInterval(() => { if (/Local:\s+http:\/\/.+:\d+/.test(viteOut)) { clearInterval(t); resolve(true); } }, 100);
    setTimeout(() => { clearInterval(t); resolve(false); }, 20_000);
  });
  if (!ready) { console.error('vite failed to start:\n' + viteOut); killVite(); process.exit(1); }

  const browser = await chromium.launch({
    ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
  });
  try {
    const page = await (await browser.newContext({ viewport: vp })).newPage();
    page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') console.log(`  [browser error] ${m.text()}`); });
    page.on('pageerror', (e) => console.log(`  [browser pageerror] ${e.message}`));

    const url = `http://127.0.0.1:${port}/brainstorm/?harness=1&autostart=1&seed=${seed}&depth=${depth}&freeze=false`;
    console.log(`pilot — seed ${seed} depth ${depth}  (${url})\n`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForFunction(() => Boolean((window as { harness?: unknown }).harness), { timeout: 10_000 });
    await page.evaluate(async () => { await (window as { harness: { ready: Promise<void> } }).harness.ready; });

    console.log('── initial ──');
    console.log(await observeText(page));
    await shot(page, 'step-000');

    const steps = parseScript(doScript);
    let n = 0;
    for (const step of steps) {
      n++;
      const label = `step-${String(n).padStart(3, '0')}`;
      if ('meta' in step) {
        if (step.meta === 'observe') { console.log(`\n── observe ──`); console.log(await observeText(page)); }
        else { await shot(page, label); console.log(`\n── shot → ${label}.png ──`); }
        continue;
      }
      const r = await page.evaluate(
        async (action) => { const h = (window as { harness: { act(a: unknown): Promise<{ ok: boolean; reason?: string }> } }).harness; return h.act(action); },
        step.action,
      );
      console.log(`\n── ${JSON.stringify(step.action)} → ${r.ok ? 'ok' : 'FAILED: ' + r.reason} ──`);
      console.log(await observeText(page));
      await shot(page, label);
    }
    console.log(`\nScreenshots in ${out}/`);
  } finally {
    await browser.close();
    killVite();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
