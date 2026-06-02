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
  /** Show the debug capture button (the ⊕ CAPTURE chip) during play.
   *  Same as the ?debug=1 URL flag, but persisted + toggleable in-menu. */
  debugMode: boolean;
  /** DEBUG tab readout toggles — independent on-screen diagnostic overlays.
   *  Each is its own panel so they can be turned on one at a time. */
  debugEyeAdapt: boolean;   // eye dark-adaptation readout (torch prox / adapt / ambient)
  debugBossReadout: boolean; // boss-encounter readout — only paints during a boss fight
  /** Touch control scheme. Only 'default' (left-joystick / right-aim,
   *  the current layout) ships today — the selector is a seam for
   *  alternate schemes (e.g. fixed-stick, swipe-move) we'll add later. */
  controlScheme: 'default';
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
}

export type ShadowMode = 'off' | 'hero' | 'single' | 'all';

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

const STORAGE_KEY = 'delve-settings';

const DEFAULTS: Settings = {
  lookSensitivity: CONFIG.LOOK_SENSITIVITY,
  hybridLook: false,
  masterVolume: 0.55,
  musicVolume: 0.65,
  reverb: true,
  autoUpdate: true,
  devAutoUpdate: false,
  debugMode: false,
  perfMeter: false,
  debugEyeAdapt: false,
  debugBossReadout: false,
  controlScheme: 'default',
  // 'hero' by default: a single lamp-cast shadow is cheap and immediately
  // sells the torchlit-dungeon feel. Drop to 'off' on a struggling phone,
  // crank to 'single'/'all' on desktop or a strong device.
  shadows: 'hero',
  adaptiveResolution: true,
};

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge with defaults — older saves may lack newer fields.
    return { ...DEFAULTS, ...parsed };
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
