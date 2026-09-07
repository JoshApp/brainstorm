// Isolate the real floating HUD from GPU timing. Chrome's LayoutCount measures
// forced layouts while the camera moves; --check is the regression gate.
// npm exec tsx scripts/perf-floating-ui.ts [--check] [--portrait|--desktop] [--snap]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { launchHeadless } from './headless-browser';

const baseline = process.argv.find(a => a.startsWith('--baseline='))?.slice('--baseline='.length);
const sourceFiles = ['src/ui/item-preview.ts', 'src/ui/interact-label.ts', 'src/ui/item-overlay.ts'];
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
  plugins: baseline ? [{ name: 'floating-ui-baseline', enforce: 'pre', load(id) {
    const file = sourceFiles.find(file => id.endsWith('/' + file));
    if (file) return execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' });
  } }] : [],
});
await server.listen();
const browser = await launchHeadless();
try {
  const viewport = process.argv.includes('--portrait') ? { width: 390, height: 844 }
    : process.argv.includes('--desktop') ? { width: 1280, height: 720 }
    : { width: 844, height: 390 };
  const page = await browser.newPage({ viewport });
  // tsx's keepNames helper is referenced by serialized evaluate callbacks.
  await page.addInitScript('window.__name = (fn) => fn');
  await page.route('**/__floating_ui', route => route.fulfill({
    contentType: 'text/html',
    body: '<style>body{margin:0;background:#171310}canvas{position:fixed;inset:0;width:100%;height:100%}</style><canvas></canvas>',
  }));
  await page.goto(`${server.resolvedUrls!.local[0]}__floating_ui`);
  await page.evaluate(async () => {
    const preview = await import('/brainstorm/src/ui/item-preview.ts');
    const prompt = await import('/brainstorm/src/ui/interact-label.ts');
    const overlay = await import('/brainstorm/src/ui/item-overlay.ts');
    const interactions = await import('/brainstorm/src/interactables/system.ts');
    // Reuse the game's Three instance (no renderer or level needed).
    const THREE = await import('/brainstorm/node_modules/three/build/three.module.js');
    const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 30);
    camera.position.set(0, 1.6, 0);
    const canvas = document.querySelector('canvas')!;
    const { ITEMS } = await import('/brainstorm/src/content/items.ts');
    const item = ITEMS['rusted-sword'];
    for (let i = 0; i < 3; i++) {
      preview.registerItemPreview(`perf-${i}`, item);
      preview.setItemPreviewAnchor(`perf-${i}`, (i - 1) * 1.4, 1.5, -3, true);
    }
    const target = { id: 'perf-target', position: new THREE.Vector3(0, 0, -3),
      radius: 5, promptLabel: 'TAKE', onUse() {}, previewItem: item, cost: { gold: 10 } };
    interactions.registerInteractable(target);
    prompt.ensureInteractLabel();
    const forward = new THREE.Vector3(0, 0, -1);
    let frame = 0;
    const tick = () => {
      camera.position.x = Math.sin(frame++ * 0.05) * 0.3;
      camera.updateMatrixWorld();
      interactions.tickInteractables(1 / 60, camera.position, forward);
      prompt.updateInteractLabel(target, camera, canvas);
      preview.tickItemPreviews(camera, canvas);
      overlay.tickItemOverlay(camera, canvas);
    };
    Object.assign(window, { floatingAudit: { tick, target, preview, prompt, camera, canvas } });
    tick();
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  await page.evaluate(() => { for (let i = 0; i < 10; i++) (window as any).floatingAudit.tick(); });
  const before = await metrics();
  await page.evaluate(() => { for (let i = 0; i < 120; i++) (window as any).floatingAudit.tick(); });
  const after = await metrics();
  const layouts = after.LayoutCount - before.LayoutCount;
  console.log(JSON.stringify({ baseline, viewport, frames: 120, layouts, layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000 }));
  if (process.argv.includes('--check')) assert.ok(layouts <= 1, `camera movement forced ${layouts} layouts`);
  // A real content resize must still be measured, with the preview above TAKE.
  const placement = await page.evaluate(() => {
    const a = (window as any).floatingAudit;
    a.target.promptLabel = 'OFFER A VERY LONG INSCRIPTION';
    a.target.cost = { gold: 12345, hp: 4 };
    a.tick();
    const prompt = document.querySelector('#interact-label')!.getBoundingClientRect();
    const card = document.querySelector('.game-hud:not(#interact-label)')!.getBoundingClientRect();
    return { gap: prompt.top - card.bottom, left: card.left, right: card.right, top: card.top };
  });
  console.log(JSON.stringify({ placement }));
  assert.ok(placement.left >= 7 && placement.right <= viewport.width - 7 && placement.top >= 51, 'card must stay on screen');
  if (process.argv.includes('--snap')) {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `/tmp/delve-floating-${viewport.width}${baseline ? '-baseline' : ''}.png` });
  }
} finally {
  await browser.close();
  await server.close();
}
