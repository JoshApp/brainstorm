// HUD design tokens — the palette + rhythm shared across every HUD
// widget (hp / stamina / xp / boss / damage numbers / interactables).
//
// Per-widget renderers IMPORT these tokens rather than hard-coding
// colours and timings. Two consequences:
//
//   1. The HUD has ONE coherent visual language — when you change the
//      health red, every place that says "low HP" tints with the same
//      red. No drift between widgets.
//   2. Styles (see hud-style.ts) can override tokens at runtime. The
//      "classic" style cranks bars to alwaysVisible; the "diegetic"
//      style hides bars and turns up the vignette / heartbeat audio.
//      No widget needs to know about styles — they just read tokens.
//
// Pair with hud-style.ts (which DECIDES which bars/pips to draw) and
// hud.ts (which carries the lower-level toolkit — fonts, projection,
// reactive bindings).

// ── Element colour ramps ─────────────────────────────────────────────
// Each element has a "full" colour (the resting state), an interpolated
// "warning" + "critical" pair for low-resource states, and a "glow"
// for additive pulse overlays.

export const HEALTH_COLORS = {
  /** Restrained brick-red at full HP. Reads as "fine" without shouting. */
  full: 'rgba(196, 56, 56, 0.85)',
  /** ~40% HP — getting noticed. */
  warning: 'rgba(220, 70, 60, 0.92)',
  /** <20% HP — alarm. Pairs with the heartbeat audio + vignette. */
  critical: 'rgba(255, 40, 30, 1.0)',
  /** Additive pulse overlay during a heartbeat. */
  glow: 'rgba(255, 100, 90, 0.6)',
};

export const STAMINA_COLORS = {
  /** Warm amber — matches the torchlight palette. */
  full: 'rgba(204, 176, 80, 0.85)',
  /** Drained — dimmed earthy tone. */
  low: 'rgba(96, 64, 32, 0.85)',
  /** Pulse overlay when stamina is regenerating after a beat of pause. */
  glow: 'rgba(255, 216, 96, 0.55)',
};

export const XP_COLORS = {
  /** Arcane violet — cold, separates from health red + stamina amber. */
  full: 'rgba(160, 96, 255, 0.85)',
  glow: 'rgba(192, 128, 255, 0.7)',
  /** Gold flash on level-up. */
  levelUp: 'rgba(255, 216, 96, 1.0)',
};

// ── Opacity / fade rhythm ────────────────────────────────────────────
// Every HUD element follows this rhythm:
//   - Visible at `activeOpacity` while its value is CHANGING or
//     recently changed.
//   - After `idleDelaySec` of no change, fades over `fadeSec` down to
//     `idleOpacity`.
//   - When the value crosses a CRITICAL threshold (low HP, low stam),
//     jumps to `criticalOpacity` and stays there until safe.
//
// `alwaysVisible` styles ignore the fade and pin to `activeOpacity`.

export const HUD_FADE = {
  idleDelaySec: 2.5,
  idleOpacity: 0.25,
  activeOpacity: 0.92,
  criticalOpacity: 1.0,
  fadeSec: 0.35,
};

// ── Pulse rhythm ─────────────────────────────────────────────────────
// Cadences that drive the DIEGETIC layer — vignette throb, camera bob
// amplification, heartbeat / breath audio. Per-element renderers and
// the diegetic feedback systems both read these constants so the look
// + the sound stay locked together.

export const HUD_PULSE = {
  /** HP fraction at which the heartbeat starts (0..1). */
  healthHeartbeatThreshold: 0.40,
  /** Heartbeat frequency at the critical floor (<20% HP), in Hz. */
  healthHeartbeatHz: 1.6,
  /** Stamina fraction at which the breath pant kicks in. */
  staminaPantThreshold: 0.30,
  /** Breath pant frequency when fully gassed, in Hz. */
  staminaPantHz: 0.9,
};

// ── Layout / margins ─────────────────────────────────────────────────
// Mobile is the primary target — these reserve the thumb-reach zones
// (bottom-left + bottom-right triangles) so HUD elements never sit
// under the player's thumbs.

export const HUD_LAYOUT = {
  /** Edge inset for HUD clusters from the screen edge, in px. */
  edgeInset: 12,
  /** Default gap between sibling elements in a cluster. */
  gap: 8,
  /** Thumb-reach radius from the bottom corners. HUD elements stay
   *  outside these zones to keep input clean. */
  thumbReachPx: 140,
};
