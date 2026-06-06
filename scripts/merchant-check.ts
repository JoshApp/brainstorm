import { chromium } from 'playwright';
const CR = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const base = 'http://127.0.0.1:5360/brainstorm/';
const b = await chromium.launch({ executablePath: CR, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
const errs: string[] = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#start-screen', { timeout: 40000 });
await page.click('text=PROVING');
await page.waitForSelector('#proving-grounds', { timeout: 8000 });
// Event tab
await page.evaluate(() => ([...document.querySelectorAll('#proving-grounds button')] as HTMLButtonElement[]).find(x => x.textContent === 'Event')?.click());
await page.waitForTimeout(400);
// merchant chip
const sel = await page.evaluate(() => {
  const m = ([...document.querySelectorAll('#proving-grounds button')] as HTMLButtonElement[]).find(x => (x.textContent ?? '').includes('Wandering merchant'));
  m?.click(); return !!m;
});
await page.waitForTimeout(400);
// descend (separate tick, inspect state)
const dbg = await page.evaluate(() => {
  const d = ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find(x => (x.textContent ?? '').includes('DESCEND'));
  const info = { found: !!d, disabled: d?.disabled, text: d?.textContent };
  d?.click();
  return info;
});
console.log('merchant selected:', sel, '| descend:', JSON.stringify(dbg));
await page.waitForTimeout(4000);
console.log('proving gone?', (await page.locator('#proving-grounds').count()) === 0);
console.log('pageerrors:', errs.length ? errs.slice(0,3) : 'none');
await page.screenshot({ path: '/tmp/merchant-room.png' });
await b.close(); process.exit(0);
