// User settings — persisted to localStorage so they survive page reloads
// (including the death-sequence reload). One place to read/write user
// preferences; UI code goes through here.

import { CONFIG } from '../config';

export interface Settings {
  /** Mouse/touch look sensitivity (radians per pixel of drag). */
  lookSensitivity: number;
  /** When true, dragging past an aim-zone radius adds continuous rotation. */
  hybridLook: boolean;
  /** Master audio volume (0..1). */
  masterVolume: number;
  /** Auto-install new builds at safe moments (title screen). When false,
   *  the player taps "INSTALL UPDATE" in the settings menu instead. */
  autoUpdate: boolean;
  /** Show the debug capture button (the ⊕ CAPTURE chip) during play.
   *  Same as the ?debug=1 URL flag, but persisted + toggleable in-menu. */
  debugMode: boolean;
}

const STORAGE_KEY = 'delve-settings';

const DEFAULTS: Settings = {
  lookSensitivity: CONFIG.LOOK_SENSITIVITY,
  hybridLook: false,
  masterVolume: 0.55,
  autoUpdate: true,
  debugMode: false,
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
