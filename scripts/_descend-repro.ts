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
  await page.goto('http://localhost:5199/?autostart=descend&seed=7&dev=1');
  await page.waitForFunction(() => (window as any).__descend !== undefined, { timeout: 30000 });
  await page.waitForTimeout(6000);
  // descend repeatedly, snapping each arrival — hunting the safe-floor
  // transition where Josh sees the pile (the bonfire room).
  for (let i = 0; i < 6; i++) {
    const target = await page.evaluate(() => (window as any).__descend());
    console.log(`descended to: ${target}`);
    if (!target) break;
    await page.waitForTimeout(4500);
    if (target.startsWith('safe-')) {
      // dismiss the rest overlay, then LOOK at the bonfire room + scan it
      await page.mouse.click(640, 300);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `/tmp/safe-arrival.png` });
      const scan = await page.evaluate(() => {
        const lux = (window as any).__lux;
        return lux.measure().then((r: any) => {
          const all = (window as any).__sceneScan(r.at.x, r.at.z, 6.0);
          return { at: r.at, meshes: all.filter((m: any) => !m.chain.includes('PerspectiveCamera') && m.visible) };
        });
      });
      console.log('SAFE SCAN: ' + JSON.stringify(scan.meshes.filter((m: any) => m.chain.includes('joint') || m.chain.includes('mob') || m.name.includes('merged') || m.type === 'InstancedMesh' || m.name.includes('bone')), null, 1).slice(0, 2500));
    }
    await page.screenshot({ path: `/tmp/floor-${i}.png` });
  }
  // scan around the player spawn for meshes
  const scan = await page.evaluate(() => {
    const lux = (window as any).__lux;
    return lux.measure().then((r: any) => {
      const all = (window as any).__sceneScan(r.at.x, r.at.z, 4.0);
      return { at: r.at, meshes: all.filter((m: any) => !m.chain.includes('PerspectiveCamera') && m.visible) };
    });
  });
  console.log(JSON.stringify(scan, null, 1).slice(0, 3500));
  await page.screenshot({ path: '/tmp/descend-repro.png' });
  await browser.close();
  try { process.kill(-vite.pid!, 'SIGTERM'); } catch { vite.kill(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
