// User settings — persisted to localStorage so they survive page reloads
// (including the death-sequence reload). One place to read/write user
// preferences; UI code goes through here.

import { CONFIG } from '../config';

export interface Settings {
  /** Mouse/touch look sensitivity (radians per pixel of drag). */
  lookSensitivity: number;
  /** When true, dragging past an aim-zone radius adds continuous rotation. */
  hybridLook: boolean;
  /** Master audio volume (0..1). Scales every audio output. */
  masterVolume: number;
  /** Music volume (0..1) — separate slider for the procedural music
   *  engine. Applied as an additional gain stage AFTER master, so the
   *  player can quiet the score independently of SFX. */
  musicVolume: number;
  /** Reverb on/off. The shared convolver gives sounds a sense of room,
   *  but ConvolverNode is the heaviest piece of the audio chain on
   *  mobile — convolving every sustained music layer + every
   *  positional SFX through a long impulse response can sap frame
   *  budget on weaker phones. Toggle off if performance drops. */
  reverb: boolean;
  /** Show the on-screen perf overlay (FPS / frame time / draw calls).
   *  For diagnosing frame drops on the phone in the field. */
  perfMeter: boolean;
  /** Auto-install new builds at safe moments (title screen + the next
   *  level-transition fade). When false, the player taps "INSTALL
   *  UPDATE" in the settings menu instead. */
  autoUpdate: boolean;
  /** DEV mode for the auto-updater — apply pending updates the instant
   *  the service worker detects one, without waiting for a level
   *  transition. Mid-floor state is lost on reload (player resumes at
   *  the current floor's entry), but iteration is fast: deploy → live
   *  on the phone in well under 30 seconds. Off by default; toggle on
   *  while iterating. */
  devAutoUpdate: boolean;
  /** DEVELOPER MODE — the master gate for every dev/debug affordance. OFF by
   *  default = the clean PROD surface a player sees: no DEBUG settings tab, no
   *  TEST/PROVING links on the title, no diagnostic overlays. ON reveals the
   *  DEBUG tab + dev menu links so the toggles below can be reached. Turning it
   *  OFF also clears the individual debug toggles, so a prod build can never
   *  leak a left-on overlay. */
  developerMode: boolean;
  /** Show the debug capture button (the ⊕ CAPTURE chip) during play.
   *  Same as the ?debug=1 URL flag, but persisted + toggleable in-menu. */
  debugMode: boolean;
  /** DEBUG tab readout toggles — independent on-screen diagnostic overlays.
   *  Each is its own panel so they can be turned on one at a time. */
  debugEyeAdapt: boolean;   // eye dark-adaptation readout (torch prox / adapt / ambient)
  debugBossReadout: boolean; // boss-encounter readout — only paints during a boss fight
  /** Attach RGB axis triads to every hand + weapon slot in the
   *  viewmodel so authors can name rotations by colour (red +X / green
   *  +Y / blue +Z) instead of guessing Euler signs. Off by default;
   *  ships in production so it works on the live URL where authoring
   *  iteration happens (deploy → look on phone → describe rotation by
   *  colour → edit spec). */
  debugHandAxes: boolean;
  /** Combat debug — draw the actual melee hit cones (the horizontal arc + reach
   *  the swing tests against) as a translucent fan each swing, so you can SEE
   *  exactly what a swing covers. Separate fans for the enemy cone and the wider
   *  destructible cone. Off by default. */
  debugHitCones: boolean;
  /** Gore debug — visualize every splash decision: the throw arrow,
   *  the wall-probe cone, the wall frame found, floor stamp rings. */
  debugGoreSplats: boolean;
  /** Profiler tools — the per-system CPU/GPU profiler HUD, the session
   *  recorder, and spector.js draw-call capture, plus their on-screen
   *  toolbar (so it's usable on a phone without function keys). A safe
   *  diagnostic (no gameplay effect), so it ships behind this toggle the
   *  same way the perf meter does — off by default; zero footprint until
   *  flipped on. */
  profilerTools: boolean;
  /** Touch control scheme. Only 'default' (left-joystick / right-aim,
   *  the current layout) ships today — the selector is a seam for
   *  alternate schemes (e.g. fixed-stick, swipe-move) we'll add later. */
  controlScheme: 'default';
  /** Dash/dodge gesture on touch. Two feels to try on the phone:
   *    'flick'     — a fast swipe on the move side dodges in the swipe
   *                  direction (directional, immediate; resolves intent at
   *                  the moment it fires).
   *    'doubleTap' — double-tap the move side to dodge; hold & steer the
   *                  second tap to pick a direction, or a quick neutral
   *                  double-tap backsteps.
   *  Either way, no clear direction (inside the deadzone) = a backstep. */
  dashGesture: 'flick' | 'doubleTap';
  /** Dynamic-shadow quality. PointLight shadows are the most expensive
   *  thing in the frame on mobile (each caster re-renders the scene as a
   *  cube map), so this is a deliberate, capped quality knob:
   *    off    — nothing casts. Zero GPU cost (the current baseline).
   *    hero   — only the player's lamp casts. One shadow that travels
   *             with you; cheapest real shadow.
   *    single — only the nearest world light (a wall torch / bonfire)
   *             casts, throwing the room across the floor.
   *    all    — lamp + the few nearest world lights cast. Richest, dearest.
   *  The caster COUNT is constant within a mode so the light pool never
   *  triggers a per-frame shader recompile (see setShadowMode). */
  shadows: ShadowMode;
  /** Adaptive resolution — auto-lower the scene-render scale on a struggling
   *  phone (and raise it back when it recovers) to hold framerate. On-aesthetic
   *  (a lower-res PS1 render reads as more PS1). Mobile only; no effect on
   *  desktop debug. */
  adaptiveResolution: boolean;
  /** Scene render scale — the fraction of native resolution the world is drawn
   *  at before the PSX blit upscales it (fill rate is the #1 mobile cost, so
   *  this is the biggest GPU knob; a lower scale reads as more PS1). This is the
   *  CEILING adaptive resolution scales down FROM on mobile, and the fixed scale
   *  when adaptive is off / on desktop. Default 0.4 (the authored look). */
  renderScale: number;
  /** Pixel-density cap (DPR) for the 3D view — the single biggest GPU-fill
   *  lever, because it scales EVERY pass including the full-res PSX blit that
   *  render-scale can't touch. Effective ratio = min(device DPR, this). Lower =
   *  fewer fragments = faster + softer; the DOM UI stays crisp regardless.
   *  Applies on mobile (the fill-bound target); desktop debug uses
   *  CONFIG.PIXEL_RATIO_CAP. Default = CONFIG.PIXEL_RATIO_CAP_MOBILE. */
  pixelRatioCap: number;
  /** Render frame-rate cap (fps). The SIM always runs at a fixed 60Hz; this
   *  only limits how often the world is DRAWN. 60 = match the sim (smooth on
   *  every display, including 120Hz — we never show a half-finished sim step);
   *  30 = battery saver (the game still runs at full real-time speed, it's just
   *  drawn half as often); 0 = uncapped. The biggest battery/heat knob on
   *  mobile (DELVE is GPU-bound), and what lets fixed-step look smooth without
   *  render interpolation. */
  frameCap: FrameCap;
  /** Bloom — the bright-pass + blur that bleeds glow off emissive cores (torch
   *  flames, hot rims). A few fullscreen passes of GPU fill; off is a real win
   *  on weak devices, at the cost of the soft glow. */
  bloom: boolean;
  /** Lean bloom (WebGPU) — replace the 5-mip bloom (~11 render targets) with a
   *  single low-res gaussian blur (~3). Fewer render-target switches = a tile-GPU
   *  bandwidth win on mobile; the subtle glow looks ~identical. No-op on WebGL. */
  leanBloom: boolean;
  /** Portal/room culling — skip rendering rooms hidden behind walls (only the
   *  room you're in + rooms visible through doorways draw). Big draw-call win
   *  in multi-room sightlines; experimental (watch for rooms popping in as you
   *  turn). Opt-in. */
  portalCulling: boolean;
  /** Banded (cel/posterized) direct lighting — steps the light-to-dark falloff
   *  into hard bands for a graphic PSX-chiaroscuro look. Subtle in the dark
   *  dungeon; a stylistic taste toggle. */
  bandedLighting: boolean;
  /** Surface AO strength — scales the baked corner/base darkening on walls +
   *  floors live (0 = off/flat, 1 = as baked, up to 2 = amplified). */
  aoStrength: number;
  /** Procedural surface detail — world-space normal perturbation + grime on the
   *  big stone surfaces, so torchlight catches fake roughness. No texture maps. */
  surfaceDetail: boolean;
  /** Master output brightness — a post-chain multiplier (1 = neutral). */
  brightness: number;
  /** The wick — the player's calibrated floor of visibility, set by the
   *  wick ritual (tend a bonfire). Unlike `brightness` (a flat gamma
   *  dial), the wick RE-TARGETS the dark: it raises the darkness-
   *  weighted floor and the ambient fills together while torch pools
   *  and signal lights stay at authored levels, so the chiaroscuro
   *  hierarchy survives sunlight. 1 = authored darkness. */
  wick: number;
  /** Let the phone's ambient-light sensor LIFT the wick when you're playing in
   *  a bright room (settings/ambient-light.ts). Rides on top of your own
   *  calibration rather than replacing it, and does nothing at all on a device
   *  with no readable sensor — which today is most of them, iOS included. */
  autoWick: boolean;
  /** Live tuning multipliers for ALL environment lights (torches,
   *  sconces, chandeliers). Debug/feel dials — 1 = the authored values. */
  torchStrengthMul: number;
  torchRangeMul: number;
  /** HUD style preset — controls which HUD elements render and how
   *  loud the diegetic feedback (vignette, heartbeat, breath) is. Use
   *  with the registry in src/ui/hud-style.ts. Default 'minimal'. */
  hudStyle: 'classic' | 'minimal' | 'diegetic';
  /** Internal one-time-migration marker (not a user toggle). Set once portal
   *  culling flipped to default-on, so existing saves that carried the old
   *  explicit `false` get force-enabled exactly once — see load(). */
  migratedPortalCulling?: boolean;
  /** One-time marker: saved 'single'/'all' shadows rebaselined to 'hero' when
   *  env-torch shadows became real (they were silently dead before). */
  migratedShadowRebaseline?: boolean;
  /** Internal one-shot flag (not a user toggle): set true once the player
   *  has been shown the first-run "calibrate the dark" nudge, so it never
   *  fires twice. See src/ui/calibrate-hint.ts. */
  calibrateHintSeen?: boolean;
}

export type ShadowMode = 'off' | 'hero' | 'single' | 'all';

/** fps cap as a string id ('0' = uncapped) — string so it slots into the
 *  shared makeSelect control; parsed to a number in the loop. */
export type FrameCap = '60' | '30' | '0';

/** Source of truth for the FRAME RATE selector. */
export const FRAME_CAPS: { id: FrameCap; label: string }[] = [
  { id: '60', label: '60 fps' },
  { id: '30', label: '30 fps — battery saver' },
  { id: '0', label: 'Uncapped' },
];

/** Source of truth for the SHADOWS selector in the graphics settings. */
export const SHADOW_MODES: { id: ShadowMode; label: string }[] = [
  { id: 'off',    label: 'Off' },
  { id: 'hero',   label: 'Hero — lamp only' },
  { id: 'single', label: 'Single — nearest light' },
  { id: 'all',    label: 'All — nearby lights' },
];

/** Selectable touch control schemes. One entry for now; the list is the
 *  source of truth for the settings dropdown. */
export const CONTROL_SCHEMES: { id: Settings['controlScheme']; label: string }[] = [
  { id: 'default', label: 'Default (joystick + aim)' },
];

export const DASH_GESTURES: { id: Settings['dashGesture']; label: string }[] = [
  { id: 'flick', label: 'Flick' },
  { id: 'doubleTap', label: 'Double-tap' },
];

const STORAGE_KEY = 'delve-settings';

const DEFAULTS: Settings = {
  lookSensitivity: CONFIG.LOOK_SENSITIVITY,
  hybridLook: false,
  masterVolume: 0.55,
  musicVolume: 0.65,
  reverb: true,
  autoUpdate: true,
  devAutoUpdate: false,
  developerMode: false,
  debugMode: false,
  perfMeter: false,
  debugEyeAdapt: false,
  debugBossReadout: false,
  debugHandAxes: false,
  debugHitCones: false,
  debugGoreSplats: false,
  profilerTools: false,
  controlScheme: 'default',
  // Flick by default — the most directional/immediate dodge; switch to
  // double-tap in the controls menu to feel the difference on the phone.
  dashGesture: 'flick',
  // 'hero' by default: a single lamp-cast shadow is cheap and immediately
  // sells the torchlit-dungeon feel. Drop to 'off' on a struggling phone,
  // crank to 'single'/'all' on desktop or a strong device.
  shadows: 'hero',
  adaptiveResolution: true,
  renderScale: 0.4,    // = PS1_SCALE_DEFAULT (the authored look / adaptive ceiling)
  pixelRatioCap: CONFIG.PIXEL_RATIO_CAP_MOBILE,  // mobile DPR cap; live slider in GRAPHICS
  frameCap: '60',      // deliberate battery/thermal default (NOT a judder workaround):
                       // render-interp smooths the 60Hz sim at any draw-rate, so >60 is
                       // available + smooth as an opt-in — 60 just keeps phones cool.

  bloom: true,
  leanBloom: true,   // cheaper 1-pass bloom (~identical look, mobile tile-bandwidth win)
  // ON by default: occlusion-culls rooms (and now enemies) hidden behind walls —
  // the big win on enemy-heavy floors, where the frustum cone otherwise draws a
  // whole packed room (and its shadow casters) through the wall you're facing.
  // The culler is conservative (generous doorway reveal margins) to keep pop-in
  // low; toggle off in Settings if a turn ever reveals a room too late.
  portalCulling: true,
  bandedLighting: true,
  aoStrength: 1.6,
  surfaceDetail: true,
  brightness: 1.0,
  wick: 1.0,
  autoWick: true,
  torchStrengthMul: 1.0,
  torchRangeMul: 1.0,
  hudStyle: 'minimal',
  migratedPortalCulling: true,   // fresh installs are already on (no migration needed)
  migratedShadowRebaseline: true,   // fresh installs start at 'hero' (no migration needed)
};

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge with defaults — older saves may lack newer fields.
    const merged = { ...DEFAULTS, ...parsed };
    // One-time migration: portal culling became default-on, but a save that
    // predates that carries the old explicit `false`, which shadows the new
    // default forever. Force it on ONCE (keyed by a marker that the merge can't
    // fake — we check `parsed`, not `merged`), then persist the marker so a
    // later deliberate toggle-off still sticks.
    if (parsed.migratedPortalCulling !== true) {
      merged.portalCulling = true;
      merged.migratedPortalCulling = true;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
    }
    // One-time migration: env-torch shadows under SHADOWS single/all were
    // SILENTLY DEAD for the whole lean-lights era — the modes cost nothing and
    // showed nothing, so a save carrying them doesn't reflect a real choice.
    // The light-director fix made them genuinely cast (each an omni cube = 6
    // shadow passes per torch per frame; measured 240fps → ~90fps unstable in
    // a corridor). Rebaseline those saves to 'hero' (lamp-only, the design
    // intent: ONE shadow, the player's) — a deliberate re-pick still sticks.
    if (parsed.migratedShadowRebaseline !== true) {
      if (merged.shadows === 'single' || merged.shadows === 'all') merged.shadows = 'hero';
      merged.migratedShadowRebaseline = true;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
}

export function getSettings(): Readonly<Settings> {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  save();
  for (const fn of listeners) fn(current);
}

export function onSettingsChanged(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
