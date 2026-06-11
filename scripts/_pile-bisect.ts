import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { chromium } from 'playwright';
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome'].find((p) => existsSync(p));
const SCAN = `(() => {
  const out = [];
  window.__scene.updateMatrixWorld(true);
  window.__scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.visible) return;
    if (!o.parent || !o.parent.name || !o.parent.name.startsWith('level-')) return;  // DIRECT level children only
    if (o.name) return;   // unnamed only
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const c = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
    if (Math.hypot(c.x, c.z) > 4) return;   // near world origin
    out.push({
      geo: o.geometry.type, r: +o.geometry.boundingSphere.radius.toFixed(2),
      pos: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
      mat: o.material.type, color: o.material.color ? o.material.color.getHexString() : null,
      emissive: o.material.emissive ? o.material.emissive.getHexString() : null,
    });
  });
  return out;
})()`;
async function main() {
  const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { stdio: 'pipe', detached: true });
  let out = ''; vite.stdout.on('data', (d) => out += d); vite.stderr.on('data', (d) => out += d);
  const t0 = Date.now(); while (!out.includes('Local:') && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 250));
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
  await page.goto('http://localhost:5199/?autostart=descend&seed=1781181675477&depth=2&dev=1&god=1');
  await page.waitForFunction(() => (window as any).__smite !== undefined, { timeout: 30000 });
  await page.waitForTimeout(6000);
  const before = await page.evaluate(SCAN);
  console.log('BEFORE kills:', JSON.stringify(before));
  const killed = await page.evaluate('window.__smite(100)');
  console.log('smitten:', JSON.stringify(killed));
  await page.waitForTimeout(8000);
  const after = await page.evaluate(SCAN);
  console.log('AFTER kills: ' + after.length + ' meshes');
  for (const m of after) console.log('  ', JSON.stringify(m));
  await browser.close();
  try { process.kill(-vite.pid!, 'SIGTERM'); } catch { vite.kill(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
