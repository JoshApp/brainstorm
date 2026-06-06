// HUD style presets — the player-facing knob that decides which HUD
// elements draw, how aggressively they hide, and how loud the diegetic
// feedback (vignette, heartbeat, camera bob, breath) is.
//
// Each style maps every HUD ELEMENT (health, stamina, xp) to a render
// MODE. Per-widget renderers branch on the mode when redrawing — no
// widget needs to know which style is active; it just reads its own
// element's mode.
//
// Adding a new style:
//   1. Add an entry to `HUD_STYLES` below.
//   2. If the new style picks a render mode an existing widget can't
//      yet draw, add the corresponding case to that widget's render
//      branch.
//   3. The settings selector populates from `HUD_STYLES` — no UI
//      changes needed.
//
// Persisted to localStorage via `getSettings().hudStyle`. Live changes
// propagate through `hudStyleStore` so widgets can re-render on switch.

import { writable, type WritableStore } from '../state/store';
import { getSettings, updateSettings } from '../settings/settings';

export type HudStyleId = 'classic' | 'minimal' | 'diegetic';

// Render modes per element. New modes are additive — widgets that
// don't yet implement a mode silently fall back to their default.
export type HealthMode  = 'bar' | 'pips' | 'vessel' | 'hidden';
export type StaminaMode = 'bar' | 'breath' | 'hidden';
export type XpMode      = 'bar' | 'sigil' | 'hidden';

export interface HudStyleSpec {
  id: HudStyleId;
  /** Display name in the settings selector. */
  label: string;
  /** One-line description shown beneath the option. */
  description: string;

  // Per-element rendering choices.
  health: HealthMode;
  stamina: StaminaMode;
  xp: XpMode;

  /** Show numeric readouts alongside visual indicators (accessibility). */
  showNumbers: boolean;
  /** Force HUD elements to stay at full opacity even when idle. */
  alwaysVisible: boolean;
  /** Strength of diegetic feedback (0..1): vignette intensity,
   *  camera-bob amplification, heartbeat / breath audio volume.
   *  Bar-heavy styles dial this down (the bar does the work);
   *  hidden-element styles crank it up (the feel IS the indicator). */
  diegeticIntensity: number;
}

// ── Preset library ───────────────────────────────────────────────────

export const HUD_STYLES: Record<HudStyleId, HudStyleSpec> = {
  // CLASSIC — traditional bars at the edges, always visible. The
  // accessibility-leaning default; nothing hides, every value is
  // legible at a glance. Diegetic feedback dialled back so the bars
  // carry the read.
  classic: {
    id: 'classic',
    label: 'Classic',
    description: 'Bars at the screen edges, always visible. Numbers shown.',
    health: 'bar',
    stamina: 'bar',
    xp: 'bar',
    showNumbers: true,
    alwaysVisible: true,
    diegeticIntensity: 0.4,
  },

  // MINIMAL — pip cluster + sigil + breath. Bars hidden, iconography
  // wins. Elements fade when idle, surface back on change. The
  // recommended default — clean, premium, still informative.
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    description: 'Pips for health, breath for stamina, sigil for level. Fades when idle.',
    health: 'pips',
    stamina: 'breath',
    xp: 'sigil',
    showNumbers: false,
    alwaysVisible: false,
    diegeticIntensity: 0.7,
  },

  // CINEMATIC — nothing on screen except the boss bar + damage
  // numbers. Health is felt through the vignette + heartbeat;
  // stamina through camera bob + audible breathing. XP is the
  // sigil only. The Sekiro/Lunacid end of the spectrum.
  diegetic: {
    id: 'diegetic',
    label: 'Cinematic',
    description: 'No bars. Vignette + heartbeat for health, breath + camera for stamina.',
    health: 'hidden',
    stamina: 'hidden',
    xp: 'sigil',
    showNumbers: false,
    alwaysVisible: false,
    diegeticIntensity: 1.0,
  },
};

// ── Live state ───────────────────────────────────────────────────────
// Reactive store widgets subscribe to so they can swap modes on the fly
// without a reload. Initial value comes from persisted settings; null
// or unknown falls back to 'minimal'.

function readInitial(): HudStyleId {
  const id = (getSettings() as { hudStyle?: HudStyleId }).hudStyle;
  return id && id in HUD_STYLES ? id : 'minimal';
}

export const hudStyleStore: WritableStore<HudStyleId> = writable<HudStyleId>(readInitial());

/** Get the current style spec. Widgets call this once per render. */
export function getHudStyle(): HudStyleSpec {
  return HUD_STYLES[hudStyleStore.get()];
}

/** Set the active style + persist. Widgets re-render via the store. */
export function setHudStyle(id: HudStyleId): void {
  if (!(id in HUD_STYLES)) return;
  hudStyleStore.set(id);
  (updateSettings as (p: Record<string, unknown>) => void)({ hudStyle: id });
}
