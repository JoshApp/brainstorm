// WebGPU migration switch (the `webgpu` spike branch).
//
// During the transition the classic WebGLRenderer stays the DEFAULT so the game
// is always runnable; the WebGPURenderer path is gated behind ?webgpu=1 so each
// milestone is A/B-testable on the dev server. This module is the one place that
// answers "are we in WebGPU mode, and is the (async-initialised) renderer ready
// to render yet?" — render-target.ts and the boot guards read it.
//
// Collapses away once the pipeline is fully ported (then WebGPURenderer is the
// only renderer and its built-in WebGL2 fallback covers non-WebGPU devices).

let webgpu = false;
let ready = false;

/** Set once at boot from the ?webgpu=1 flag. */
export function setWebGPUMode(on: boolean): void { webgpu = on; }
export function isWebGPU(): boolean { return webgpu; }

/** WebGPURenderer.init() is async; nothing may render until it resolves. */
export function setWebGPUReady(on: boolean): void { ready = on; }
export function isWebGPUReady(): boolean { return ready; }

// WARMUP GATE. The node renderer compiles a render PIPELINE the first time a
// material/state combo is drawn — lazily, INSIDE the frame, which is the
// mid-combat freeze the warmup exists to prevent. The WebGPU warmup parents the
// whole spawnable roster into the LIVE scene and compiles it via compileAsync.
// While those warm subjects sit in the scene the main loop must NOT draw — they'd
// flash on-screen at the camera (the WebGL path dodges this by rendering into an
// offscreen target; the node pipeline renders the live scene to the screen). So
// the loop skips drawing while this is true, which doubles as the first-frame
// gate: the first real frame waits behind the compile instead of racing it.
let warming = false;
export function setWebGPUWarming(on: boolean): void { warming = on; }
export function isWebGPUWarming(): boolean { return warming; }
