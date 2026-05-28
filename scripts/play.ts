/**
 * play.ts — drive a full autonomous episode via the harness bot.
 *
 *   npm run play -- [flags]
 *
 * Flags:
 *   --seed N           run seed (default: a random 32-bit int)
 *   --depth M          start depth (default 1; uses ?harness=1 to allow jumps)
 *   --turns T          max bot turns (default 100)
 *   --out DIR          output directory (default /tmp/play-<timestamp>)
 *   --screenshot-every K  capture every K turns (default 10)
 *   --viewport NAME    desktop|phone|phone-portrait|phone-large|tablet (default desktop)
 *   --port N           vite port (default randomized)
 *
 * Output bundle:
 *   transcript.jsonl    one JSON per line: {turn, action, result.observation, result.events?}
 *   screenshots/        turn-NNN.png at periodic + interesting turns
 *   summary.json        end-of-episode metrics
 *   final.png           annotated screenshot of the final frame
 */

import { chromium, type ConsoleMessage, type Page } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
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
  'phone-large': { width: 915, height: 412 },
  tablet: { width: 1024, height: 768 },
};

interface Args {
  seed: number;
  depth: number;
  turns: number;
  out: string;
  screenshotEvery: number;
  viewport: string;
  port: number;
  headed: boolean;
  slowMo: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
    return undefined;
  };
  const has = (flag: string): boolean => argv.includes(flag);
  const seed = Number(get('--seed') ?? Math.floor(Math.random() * 1e9));
  const depth = Number(get('--depth') ?? 1);
  const turns = Number(get('--turns') ?? 100);
  const screenshotEvery = Number(get('--screenshot-every') ?? 10);
  const viewport = get('--viewport') ?? 'desktop';
  const port = Number(get('--port') ?? 5180 + Math.floor(Math.random() * 100));
  const headed = has('--headed');
  // slow-mo (ms between Playwright actions) is helpful in headed mode to
  // actually see the bot's pulses — defaults to 0 in headless, 250 in
  // headed so the eye can follow.
  const slowMo = Number(get('--slow-mo') ?? (headed ? 250 : 0));
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = get('--out') ?? `/tmp/play-${ts}-seed${seed}-d${depth}`;
  return { seed, depth, turns, out, screenshotEvery, viewport, port, headed, slowMo };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const vp = VIEWPORTS[args.viewport];
  if (!vp) {
    console.error(`Unknown viewport "${args.viewport}". Available: ${Object.keys(VIEWPORTS).join(', ')}`);
    process.exit(1);
  }

  // Output bundle directory layout.
  mkdirSync(args.out, { recursive: true });
  mkdirSync(join(args.out, 'screenshots'), { recursive: true });
  const transcriptPath = join(args.out, 'transcript.jsonl');
  writeFileSync(transcriptPath, '');

  console.log('play.ts — autonomous bot episode');
  console.log(`  seed:    ${args.seed}`);
  console.log(`  depth:   ${args.depth}`);
  console.log(`  turns:   ${args.turns}`);
  console.log(`  out:     ${args.out}`);
  console.log(`  viewport: ${args.viewport} ${vp.width}x${vp.height}`);
  if (args.headed) console.log(`  mode:    HEADED (browser window visible) — slowMo ${args.slowMo}ms`);
  console.log();

  // Start vite.
  const repoRoot = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
  const vite = spawn(
    'node_modules/.bin/vite',
    ['--port', String(args.port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let viteOutput = '';
  vite.stdout?.on('data', (c: Buffer) => { viteOutput += c.toString(); });
  vite.stderr?.on('data', (c: Buffer) => { viteOutput += c.toString(); });
  const viteReady = await new Promise<boolean>((resolve) => {
    const t = setInterval(() => {
      if (/Local:\s+http:\/\/.+:\d+/.test(viteOutput)) { clearInterval(t); resolve(true); }
    }, 100);
    setTimeout(() => { clearInterval(t); resolve(false); }, 20_000);
  });
  if (!viteReady) {
    console.error('Vite did not start within 20s:\n' + viteOutput);
    killVite();
    process.exit(1);
  }

  let exitCode = 0;
  let browser;
  const startedAt = Date.now();
  try {
    browser = await chromium.launch({
      ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
      headless: !args.headed,
      slowMo: args.slowMo,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
    });
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('console', (m: ConsoleMessage) => {
      const type = m.type();
      if (type === 'error') console.log(`  [browser ${type}] ${m.text()}`);
    });
    page.on('pageerror', (e) => console.log(`  [browser pageerror] ${e.message}`));

    const url = `http://127.0.0.1:${args.port}/brainstorm/?harness=1&autostart=1&seed=${args.seed}&depth=${args.depth}&freeze=false`;
    console.log(`Opening ${url}\n`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => Boolean((window as any).harness),
      { timeout: 10_000 },
    );
    await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => { await (window as any).harness.ready; },
    );

    // Capture initial annotated frame
    await dumpScreenshot(page, args.out, 0, 'init');

    // Run the bot. We use a sentinel exposed by the bot's `onStep` to
    // stream per-turn data out of the browser without keeping the
    // whole transcript in browser memory.
    const initialObs = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).harness.observe(),
    );
    appendFileSync(transcriptPath, JSON.stringify({ turn: -1, action: 'init', observation: initialObs }) + '\n');
    console.log(`Initial: depth=${initialObs.depth} floor=${initialObs.floorId} room=${initialObs.roomId} HP=${initialObs.player.hp.current}/${initialObs.player.hp.max}`);

    let prevDepth = initialObs.depth;
    let metricsLightSum = 0;
    let metricsLightSamples = 0;
    let metricsDarkTurns = 0;
    let metricsCombatTurns = 0;
    let lastTurn = -1;

    for (let t = 0; t < args.turns; t++) {
      // Single-step the bot from outside so we can dump per turn.
      const result = await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const h = (window as any).harness;
          const obs = h.observe();
          const action = h.bot.step(obs);
          const r = await h.act(action);
          return { action, result: r };
        },
      );
      lastTurn = t;
      const obs = result.result.observation;
      appendFileSync(transcriptPath, JSON.stringify({ turn: t, action: result.action, observation: obs }) + '\n');

      // Live progress
      const enemyCount = obs.visible.enemies.length;
      const inCombat = obs.visible.enemies.some((e: { distance: number; inSight: boolean }) => e.inSight && e.distance < 6);
      if (inCombat) metricsCombatTurns++;
      metricsLightSum += obs.light.atPlayer;
      metricsLightSamples++;
      if (obs.light.atPlayer < 1) metricsDarkTurns++;

      const tag =
        obs.depth !== prevDepth ? ' DESCEND' :
        result.action.kind === 'attack' ? ' SWING' :
        result.action.kind === 'interact' ? ' INTERACT' :
        '';
      console.log(
        `  t=${String(t).padStart(3)}  ${result.action.kind.padEnd(9)}` +
        `  hp=${obs.player.hp.current}/${obs.player.hp.max}` +
        `  depth=${obs.depth}  light=${obs.light.atPlayer.toFixed(1)}` +
        `  enemies=${enemyCount}${tag}`,
      );

      // Interesting screenshot moments: every K turns OR on depth change
      if ((t + 1) % args.screenshotEvery === 0 || obs.depth !== prevDepth) {
        const tag2 = obs.depth !== prevDepth ? 'descend' : 'tick';
        await dumpScreenshot(page, args.out, t + 1, tag2);
      }
      prevDepth = obs.depth;

      // Stop conditions
      if (obs.player.hp.current <= 0) {
        console.log('\n  → player died');
        await dumpScreenshot(page, args.out, t + 1, 'died');
        break;
      }
    }

    // Final
    await dumpScreenshot(page, args.out, lastTurn + 1, 'final');

    // Write summary
    const finalObs = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).harness.observe(),
    );
    const summary = {
      seed: args.seed,
      startDepth: args.depth,
      turnsRun: lastTurn + 1,
      finalDepth: finalObs.depth,
      finalFloorId: finalObs.floorId,
      finalHp: finalObs.player.hp.current,
      finalHpMax: finalObs.player.hp.max,
      died: finalObs.player.hp.current <= 0,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      metrics: {
        avgLight: metricsLightSamples > 0 ? metricsLightSum / metricsLightSamples : 0,
        darkTurnRatio: metricsLightSamples > 0 ? metricsDarkTurns / metricsLightSamples : 0,
        combatTurnRatio: metricsLightSamples > 0 ? metricsCombatTurns / metricsLightSamples : 0,
      },
    };
    writeFileSync(join(args.out, 'summary.json'), JSON.stringify(summary, null, 2));

    console.log('\n──────────────────────────────────────────');
    console.log(`Summary:`);
    console.log(`  turns: ${summary.turnsRun}`);
    console.log(`  depth: ${args.depth} → ${summary.finalDepth}`);
    console.log(`  HP:    ${summary.finalHp}/${summary.finalHpMax}${summary.died ? ' (died)' : ''}`);
    console.log(`  avg light: ${summary.metrics.avgLight.toFixed(2)}`);
    console.log(`  dark turns: ${(summary.metrics.darkTurnRatio * 100).toFixed(0)}%`);
    console.log(`  combat turns: ${(summary.metrics.combatTurnRatio * 100).toFixed(0)}%`);
    console.log(`  output: ${args.out}`);
  } catch (err) {
    console.error('✗ play failed:', err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    killVite();
  }
  process.exit(exitCode);

  function killVite() {
    if (vite.pid) {
      try { process.kill(-vite.pid, 'SIGKILL'); } catch { /* ignore */ }
    }
    try { vite.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

async function dumpScreenshot(page: Page, outDir: string, turn: number, tag: string): Promise<void> {
  const shot = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async () => (window as any).harness.screenshot({ annotated: true }),
  );
  const b64 = shot.pngDataUrl.replace(/^data:image\/png;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  const num = String(turn).padStart(4, '0');
  const path = join(outDir, 'screenshots', `t${num}-${tag}.png`);
  writeFileSync(path, buf);
  const annoPath = join(outDir, 'screenshots', `t${num}-${tag}.annotations.json`);
  writeFileSync(annoPath, JSON.stringify(shot.annotations, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
