// WebGPU renderer readiness.
//
// WebGPURenderer is the ONLY renderer now (its built-in WebGL2 fallback covers
// devices without WebGPU). Its init() is async, so nothing may render until it
// resolves — render-target.ts's renderWithStyle gates on isWebGPUReady().

let ready = false;

/** WebGPURenderer.init() is async; nothing may render until it resolves. */
export function setWebGPUReady(on: boolean): void { ready = on; }
export function isWebGPUReady(): boolean { return ready; }
