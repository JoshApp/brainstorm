import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { chromium } from 'playwright';
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome'].find((p) => existsSync(p));
async function main() {
  const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { stdio: 'pipe', detached: true });
  let out = ''; vite.stdout.on('data', (d) => out += d); vite.stderr.on('data', (d) => out += d);
  const t0 = Date.now(); while (!out.includes('Local:') && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 250));
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
  await page.goto('http://localhost:5199/?autostart=descend&seed=1781181675477&depth=2&dev=1');
  await page.waitForFunction(() => (window as any).__sceneScan !== undefined, { timeout: 30000 });
  await page.waitForTimeout(6000);
  const scan = await page.evaluate(`(() => {
    const all = window.__sceneScan(-0.7, 0, 1.2);
    return all.filter((m) => !m.chain.includes('PerspectiveCamera') && m.visible && !/floor|ceiling|walls-merged|trim-merged/.test(m.name));
  })()`);
  console.log(JSON.stringify(scan, null, 1));
  await page.evaluate('window.__teleport(-1.6, -0.1, 4.54)');
  await page.waitForTimeout(700);
  await page.screenshot({ path: '/tmp/lump-view.png' });
  await browser.close();
  try { process.kill(-vite.pid!, 'SIGTERM'); } catch { vite.kill(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
