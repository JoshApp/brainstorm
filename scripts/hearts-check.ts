import { chromium } from 'playwright';
const CR = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const base = 'http://127.0.0.1:5394/brainstorm/';
const b = await chromium.launch({ executablePath: CR, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
const errs: string[] = []; page.on('pageerror', e => errs.push(e.message));
// fakesave seeds hp:4 (=> 2 full hearts with the new 2-HP-per-heart hearts).
await page.goto(base + '?fakesave=1', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#start-screen', { timeout: 40000 });
await page.click('text=CONTINUE').catch(()=>{});
await page.waitForTimeout(5000);
const info = await page.evaluate(() => {
  const el = document.getElementById('health-hearts');
  return { present: !!el, svgs: el ? el.querySelectorAll('svg').length : 0, opacity: el?.style.opacity };
});
console.log('hearts:', JSON.stringify(info), '| pageerrors:', errs.slice(0,2));
await page.screenshot({ path: '/tmp/hearts-4hp.png' });
console.log('saved /tmp/hearts-4hp.png');
await b.close(); process.exit(0);
