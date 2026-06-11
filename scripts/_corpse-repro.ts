import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { chromium } from 'playwright';
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome', process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
async function main() {
  const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { stdio: 'pipe', detached: true });
  let out = ''; vite.stdout.on('data', (d) => out += d); vite.stderr.on('data', (d) => out += d);
  const t0 = Date.now(); while (!out.includes('Local:') && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 250));
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
  await page.goto('http://localhost:5199/?autostart=descend&seed=7&depth=2&dev=1&god=1');
  await page.waitForFunction(() => (window as any).__smite !== undefined, { timeout: 30000 });
  await page.waitForTimeout(6000);
  // THE TRANSITION: descend one floor first — Josh's pile only appears
  // from the second floor onward.
  const target = await page.evaluate(() => (window as any).__descend());
  console.log('descended to:', target);
  await page.waitForTimeout(5000);
  // Teleport the camera to the first living enemy and smite it.
  const result = await page.evaluate(async () => {
    const w = window as any;
    // tour-style: borrow lux's camera access via measure (it reports cam pos)
    // find enemy positions through sceneScan? Use the level directly via __smite + a wide radius after teleporting with lux... simplest: smite with huge radius from spawn.
    const killed = w.__smite(100);
    return killed;
  });
  console.log('smitten:', JSON.stringify(result));
  // Wait for the dissolve to fully play out.
  await page.waitForTimeout(9000);
  // Audit BOTH ends: are corpses at their death spots, and is anything
  // creature-like at the spawn/camera position?
  const auditFn = `(async (killedList) => {
    const w = window;
    const r = await w.__lux.measure();
    const creatureish = (m) => !m.chain.includes('PerspectiveCamera') && m.visible &&
      !/floor|ceiling|walls-merged|trim-merged|fixtures-merged|soffit|decal/.test(m.name + m.chain);
    const atSpawn = w.__sceneScan(r.at.x, r.at.z, 6.0).filter(creatureish);
    const deaths = {};
    for (const k of killedList) {
      const coords = k.split('@')[1];
      const x = Number(coords.split(',')[0]);
      const z = Number(coords.split(',')[1]);
      deaths[k] = w.__sceneScan(x, z, 2.0).filter(creatureish).length;
    }
    return { spawnPos: r.at, atSpawn, deathSpotMeshCounts: deaths };
  })(${JSON.stringify(result)})`;
  const audit = await page.evaluate(auditFn);
  const a = audit as any;
  console.log('SPAWN POS: ' + JSON.stringify(a.spawnPos));
  console.log('AT-SPAWN creature-ish meshes: ' + a.atSpawn.length);
  const byChain = new Map<string, number>();
  for (const m of a.atSpawn) {
    const k = `${m.name}|${m.chain}|y≈${Math.round(m.center[1] * 2) / 2}|r${m.radius}`;
    byChain.set(k, (byChain.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...byChain.entries()].sort((x, y) => y[1] - x[1]).slice(0, 18)) {
    console.log(`  ${n}× ${k}`);
  }
  console.log('DEATH-SPOT mesh counts: ' + JSON.stringify(a.deathSpotMeshCounts));
  await page.screenshot({ path: '/tmp/corpse-origin.png' });
  // Stand at the first kill's death spot and look at it — corpse there?
  // blood stain on the floor? Both bugs answered in one frame.
  const firstKill = (result[0] ?? '').split('@')[1];
  if (firstKill) {
    const [kx, kz] = firstKill.split(',').map(Number);
    for (let i = 0; i < 4; i++) {
      const yaw = (i * Math.PI) / 2;
      await page.evaluate(`window.__teleport(${kx + Math.cos(yaw) * 2.5}, ${kz + Math.sin(yaw) * 2.5}, ${yaw + Math.PI / 2 + Math.PI / 4})`);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `/tmp/death-spot-${i}.png` });
    }
  }
  await browser.close();
  try { process.kill(-vite.pid!, 'SIGTERM'); } catch { vite.kill(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
