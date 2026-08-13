/**
 * Headless Chromium for DELVE's tooling — including a REAL WebGPU device.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * Every headless script in `scripts/` used to hand-roll its own chromium path
 * lookup and its own `args: ['--no-sandbox', …, '--use-gl=swiftshader']`, and
 * they all carried the same wrong belief in a comment:
 *
 *   "Headless swiftshader has no working WebGPU: Chrome exposes navigator.gpu
 *    but the context provider fails."
 *
 * That was measured, but it measured the wrong thing. WebGPU headless failed
 * for two reasons that have nothing to do with SwiftShader:
 *
 *   1. **Secure context.** `navigator.gpu` is only exposed on a secure origin.
 *      Probes that ran against `data:` or `about:blank` saw NO `navigator.gpu`
 *      at all and concluded it was unsupported. `http://127.0.0.1:<port>` — the
 *      vite dev server every tool already boots — IS a secure context.
 *   2. **Too many flags.** `requestAdapter()` returns null under
 *      `--use-vulkan=swiftshader`, `--use-webgpu-adapter=swiftshader`, or
 *      `--enable-features=Vulkan`. Those look like they should help and they are
 *      precisely what breaks it. The ONLY flag needed is
 *      `--enable-unsafe-webgpu`, which is purely additive: WebGL2 behaves
 *      identically with it on, so one arg list serves both backends.
 *
 * Verified 2026-08-13 on the bundled Chromium 141 (`/opt/pw-browsers`): the game
 * boots on `WebGPUBackend`, renders, and Dawn's validation layer is live — which
 * is the whole point. Dawn validation is DEVICE-INDEPENDENT, so a
 * synchronization-scope or usage error that fires on Josh's phone fires here too.
 * We no longer have to reason about WebGPU bugs from the call graph.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync } from 'node:fs';

/** Chromium binaries this environment might have, best first. Pre-installed by
 *  the sandbox; Playwright's normal browser download is blocked, so probe the
 *  known install locations rather than hard-coding one version path. */
export const CHROMIUM_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  `${process.env.HOME}/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome`,
  `${process.env.HOME}/.cache/ms-playwright/chromium-1194/chrome-linux/chrome`,
  `${process.env.HOME}/.cache/ms-playwright/chromium-1161/chrome-linux/chrome`,
  `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`,
];

/** The pre-installed Chromium, or undefined to let Playwright resolve its own. */
export function chromiumPath(): string | undefined {
  return CHROMIUM_CANDIDATES.find((p) => existsSync(p));
}

/**
 * The canonical headless arg list.
 *
 * - `--no-sandbox` / `--disable-dev-shm-usage` — container hygiene.
 * - `--use-gl=swiftshader` — software GL. This is what makes the WebGL2 backend
 *   work at all headlessly; unchanged from before, so existing snaps are byte-
 *   identical.
 * - `--enable-unsafe-webgpu` — unlocks `requestAdapter()`. Additive: it does NOT
 *   change the WebGL2 path (measured). Do NOT add Vulkan/adapter-override flags
 *   alongside it — see the file header; they make the adapter NULL.
 */
export const HEADLESS_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--use-gl=swiftshader',
  '--enable-unsafe-webgpu',
];

/** Launch headless Chromium with DELVE's canonical args. `extraArgs` appends. */
export function launchHeadless(extraArgs: string[] = []): Promise<Browser> {
  const executablePath = chromiumPath();
  return chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...HEADLESS_ARGS, ...extraArgs],
  });
}

/**
 * Two patches that make headless WebGPU survive. Call on the CONTEXT before
 * opening a page; both are inert on a WebGL2 run.
 *
 * ── 1. `swizzle` ─────────────────────────────────────────────────────────────
 * three r185 sets `swizzle: 'rgba'` (a string) on every `GPUTextureViewDescriptor`
 * it hands to `createView`. The shipped spec models `GPUTextureComponentSwizzle`
 * as a DICTIONARY, so a string is a type error. Newer Chrome doesn't implement
 * the member at all and silently ignores it — which is why phones are fine and
 * this Chromium 141 is not: it knows the member and validates it. Dropping the
 * string restores the default (`rgba`), i.e. exactly what three meant.
 *
 * ── 2. The swap chain ────────────────────────────────────────────────────────
 * This is the one that actually blocked headless WebGPU for months, and it is
 * NOT about the device. Rendering to an OFFSCREEN target works under every flag
 * combination tried. Presenting to a CANVAS never does — the GPU process says:
 *
 *   Could not find SharedImageBackingFactory with params: usage: RasterRead|
 *   DisplayRead|WebgpuRead|WebgpuSwapChainTexture|… debug_label: WebGPUSwapBufferProvider
 *   SharedImageStub: Unable to create shared image
 *
 * Dawn and the software compositor share no SharedImage backing, so the very
 * first `getCurrentTexture()` present tears down the whole GPU connection: the
 * device is lost, the WebGL context goes with it, and DELVE's context-recovery
 * veil comes up ~3.5s into every boot. Measured across `--use-gl=swiftshader`,
 * `--use-angle=swiftshader`, `--use-gl=angle`, `--enable-features=Vulkan` and
 * `--disable-gpu-compositing`: the canvas dies by frame 4 in all of them.
 *
 * So we hand the page an offscreen texture where the swap-chain texture would
 * be. Nothing ever presents, the device lives indefinitely, and the game runs
 * a full session on a real WebGPU backend — WITH Dawn's validation layer, which
 * is the entire point (validation is device-independent, so a synchronization-
 * scope error from Josh's phone reproduces here).
 *
 * The frame is then read back out-of-band — see `paintHeadlessFrame`.
 */
export async function installWebGPUShims(context: BrowserContext): Promise<void> {
  await context.addInitScript(`(() => {
    if (typeof GPUTexture === 'undefined') return;
    const createView = GPUTexture.prototype.createView;
    GPUTexture.prototype.createView = function (descriptor) {
      if (descriptor && typeof descriptor.swizzle === 'string') {
        const copy = {};
        for (const key in descriptor) if (key !== 'swizzle') copy[key] = descriptor[key];
        return createView.call(this, copy);
      }
      return createView.call(this, descriptor);
    };

    if (typeof GPUCanvasContext === 'undefined') return;
    const configure = GPUCanvasContext.prototype.configure;
    GPUCanvasContext.prototype.configure = function (descriptor) {
      this.__delveConfig = descriptor;
      this.__delveTexture = null;
      return configure.call(this, descriptor);
    };
    GPUCanvasContext.prototype.getCurrentTexture = function () {
      const config = this.__delveConfig;
      const w = Math.max(1, this.canvas.width);
      const h = Math.max(1, this.canvas.height);
      if (!this.__delveTexture || this.__delveTexture.width !== w || this.__delveTexture.height !== h) {
        if (this.__delveTexture) { try { this.__delveTexture.destroy(); } catch (e) { /* already gone */ } }
        this.__delveTexture = config.device.createTexture({
          label: 'headless-swapchain', size: [w, h, 1], format: config.format,
          usage: (config.usage || 0) | GPUTextureUsage.RENDER_ATTACHMENT
            | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
        });
      }
      return this.__delveTexture;
    };
    window.__delveHeadlessSwapchain = true;
  })()`);
}

/**
 * Make the rendered world visible to a page screenshot.
 *
 * With the swap-chain shim in place the canvas stays blank — the game's frames
 * go to an offscreen texture nobody composites. So ask the game for the frame
 * (`window.__captureFrame`, DEV-only, registered in main.ts: it re-renders once
 * through the real display pipeline into a render target and reads it back
 * async — the same path the bug-report screenshot uses) and lay the PNG over
 * the canvas as an <img>. The DOM HUD sits above it untouched, so a normal
 * `page.screenshot()` composites world + UI exactly as a phone would show them.
 *
 * Returns false when the hook isn't there (a WebGL2 run, a production build, or
 * a page with no game on it) — callers just screenshot as usual.
 */
export async function paintHeadlessFrame(page: Page): Promise<boolean> {
  return await page.evaluate(`(async () => {
    if (!window.__delveHeadlessSwapchain || typeof window.__captureFrame !== 'function') return false;
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    const png = await window.__captureFrame(canvas.width);
    if (!png) return false;
    let img = document.getElementById('__delve-headless-frame');
    if (!img) {
      img = document.createElement('img');
      img.id = '__delve-headless-frame';
      // Behind every HUD layer, in front of the (blank) canvas, click-through.
      img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;'
        + 'object-fit:fill;pointer-events:none;z-index:0;';
      document.body.insertBefore(img, document.body.firstChild);
    }
    img.src = png;
    await img.decode().catch(() => {});
    return true;
  })()`) as boolean;
}

/**
 * Print any Dawn validation errors the run collected, and return them.
 *
 * DELVE brackets every DEV frame in a `pushErrorScope('validation')` and stashes
 * what comes back on `window.__gpuErrors` (see render-webgpu.ts) — those errors
 * do NOT reliably reach the devtools console, so nothing surfaces them unless
 * something asks. This is the payoff of headless WebGPU: Dawn's validation is
 * DEVICE-INDEPENDENT, so a usage/synchronization-scope error that fires on a
 * phone fires here too, and a snap can now fail loudly on one instead of
 * quietly producing a pretty picture.
 */
export async function reportGpuErrors(page: Page): Promise<string[]> {
  const errors = await page.evaluate(`(window.__gpuErrors || []).slice(0, 12)`) as string[];
  if (errors.length) {
    console.log(`\n⚠ ${errors.length} WebGPU validation error(s):`);
    for (const e of errors) console.log('   ' + e.slice(0, 300));
  }
  return errors;
}
