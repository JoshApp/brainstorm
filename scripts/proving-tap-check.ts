import { chromium } from 'playwright';
const CR = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const base = 'http://127.0.0.1:5362/brainstorm/';
const b = await chromium.launch({ executablePath: CR, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#start-screen', { timeout: 40000 });
await page.click('text=PROVING');
await page.waitForSelector('#proving-grounds', { timeout: 8000 });
try {
  await page.click('button:has-text("Back")', { timeout: 6000 });
  await page.waitForTimeout(400);
  console.log('BACK tap OK; proving closed?', (await page.locator('#proving-grounds').count()) === 0, '; title shown?', (await page.locator('#start-screen').count()) > 0);
} catch (e) { console.log('BACK tap FAILED:', (e as Error).message.split('\n')[0]); }
await b.close(); process.exit(0);
