import { CONFIG } from '../config';

// Red vignette overlay — used for both damage hit-flashes and the death state.
// Pure DOM, radial gradient transparent in the middle to dark red at the edges.
// Two independent layers:
//   - flash: short, intense, fades back to 0 (damage taken)
//   - persistent: held by external controllers (death sequence ramps this up)
// The two are composited via separate divs so they don't fight each other.

let flashEl: HTMLDivElement | null = null;
let persistentEl: HTMLDivElement | null = null;

function baseStyle() {
  return {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '8',
    opacity: '0',
    transition: 'opacity 0.28s ease-out',
    willChange: 'opacity',
  } as Partial<CSSStyleDeclaration>;
}

function ensureElements() {
  if (flashEl && persistentEl) return;

  persistentEl = document.createElement('div');
  persistentEl.id = 'vignette-persistent'; persistentEl.classList.add('game-hud');
  Object.assign(persistentEl.style, baseStyle());
  persistentEl.style.background =
    'radial-gradient(ellipse at center, transparent 30%, rgba(140, 10, 10, 0.35) 75%, rgba(60, 0, 0, 0.85) 100%)';
  persistentEl.style.transition = 'opacity 1.4s ease-in';
  document.body.appendChild(persistentEl);

  flashEl = document.createElement('div');
  flashEl.id = 'vignette-flash';
  Object.assign(flashEl.style, baseStyle());
  flashEl.style.background =
    'radial-gradient(ellipse at center, transparent 5%, rgba(170, 20, 20, 0.6) 60%, rgba(120, 0, 0, 0.95) 100%)';
  document.body.appendChild(flashEl);
}

/** Damage hit-flash: instant red bloom that fades back to 0. The flash
 *  opacity AND fade duration scale with damage amount, so a 3-damage hit
 *  reads visibly heavier than a 1-damage hit — important now that
 *  enemies have varied damage profiles (wraith hits for 2, etc.). */
export function flashVignette(damageAmount: number = 1) {
  ensureElements();
  if (!flashEl) return;
  // Opacity ramps from 0.55 (1 dmg) → 1.0 (3+ dmg).
  const intensity = Math.min(1.0, 0.55 + (damageAmount - 1) * 0.22);
  // Heavy hits linger longer — 280ms baseline, +120ms per extra damage.
  const fade = CONFIG.VIGNETTE_FLASH_FADE_MS + Math.max(0, damageAmount - 1) * 120;
  flashEl.style.transition = 'none';
  flashEl.style.opacity = String(intensity);
  void flashEl.offsetWidth;
  flashEl.style.transition = `opacity ${fade}ms ease-out`;
  flashEl.style.opacity = '0';
}

/** Set persistent vignette opacity directly (used by death sequence). */
export function setPersistentVignette(opacity: number, transitionMs?: number) {
  ensureElements();
  if (!persistentEl) return;
  if (transitionMs !== undefined) {
    persistentEl.style.transition = `opacity ${transitionMs}ms ease-in`;
  }
  persistentEl.style.opacity = String(Math.max(0, Math.min(1, opacity)));
}

// ─── Rare-find pickup glow ───────────────────────────────────────────
// A warm gold edge bloom that blooms once and fades — fired only on
// uncommon+ pickups (intensity by rarity). The dungeon doesn't celebrate,
// so this is restraint: mundane loot gets nothing, and even a fabled find
// is a brief, deep-amber swell at the periphery, not a fireworks flash.
// Deliberately gold (not the damage red) so it never reads as a threat.

let pickupEl: HTMLDivElement | null = null;

function ensurePickup() {
  if (pickupEl) return;
  ensureElements();
  pickupEl = document.createElement('div');
  pickupEl.id = 'vignette-pickup';
  Object.assign(pickupEl.style, baseStyle());
  pickupEl.style.background =
    'radial-gradient(ellipse at center, transparent 45%, rgba(190, 140, 50, 0.32) 82%, rgba(120, 80, 20, 0.55) 100%)';
  document.body.appendChild(pickupEl);
}

/** Pickup edge-glow. `rarityIndex` 0-4; only uncommon+ (>=1) shows, and
 *  the bloom intensity + linger scale with rarity. Fabled is the headline. */
export function flashPickupGlow(rarityIndex: number) {
  if (rarityIndex < 1) return;   // mundane stays silent on the screen
  ensurePickup();
  if (!pickupEl) return;
  const t = Math.min(1, (rarityIndex - 1) / 3);   // uncommon 0 → fabled 1
  const intensity = 0.25 + t * 0.55;
  const fade = 420 + rarityIndex * 200;
  pickupEl.style.transition = 'none';
  pickupEl.style.opacity = String(intensity);
  void pickupEl.offsetWidth;
  pickupEl.style.transition = `opacity ${fade}ms ease-out`;
  pickupEl.style.opacity = '0';
}

// ─── Flask heal glow ─────────────────────────────────────────────────
// The sip landing — a warm GOLD swell from the screen edges (Elden Ring's
// liquid-light register), unmistakably not the damage red and softer than
// the pickup bloom. Slow ease-in, slower fade: relief, not celebration.

let healEl: HTMLDivElement | null = null;

function ensureHeal() {
  if (healEl) return;
  ensureElements();
  healEl = document.createElement('div');
  healEl.id = 'vignette-heal'; healEl.classList.add('game-hud');
  Object.assign(healEl.style, baseStyle());
  healEl.style.background =
    'radial-gradient(ellipse at center, rgba(255, 190, 90, 0.10) 0%, transparent 40%, rgba(255, 170, 60, 0.30) 82%, rgba(200, 120, 30, 0.5) 100%)';
  document.body.appendChild(healEl);
}

/** The flask's sip — golden warmth blooms and drains away. */
export function flashHealGlow() {
  ensureHeal();
  if (!healEl) return;
  healEl.style.transition = 'opacity 160ms ease-in';
  healEl.style.opacity = '0.85';
  setTimeout(() => {
    if (!healEl) return;
    healEl.style.transition = 'opacity 900ms ease-out';
    healEl.style.opacity = '0';
  }, 200);
}

// ─── Low-HP pulse overlay ────────────────────────────────────────────
// A third layer, independent of flash + persistent. When the player's
// HP drops below the threshold, a soft red breathing pulse appears at
// the screen edges — peripheral vision signal: "you are in danger."
// Driven by tickLowHpPulse from the main loop; the only thing the
// outside world has to do is call it each frame.

let lowHpEl: HTMLDivElement | null = null;
let lowHpTime = 0;

function ensureLowHp() {
  if (lowHpEl) return;
  ensureElements();
  lowHpEl = document.createElement('div');
  lowHpEl.id = 'vignette-lowhp'; lowHpEl.classList.add('game-hud');
  Object.assign(lowHpEl.style, baseStyle());
  lowHpEl.style.background =
    'radial-gradient(ellipse at center, transparent 35%, rgba(180, 30, 30, 0.45) 80%, rgba(80, 0, 0, 0.7) 100%)';
  lowHpEl.style.transition = 'opacity 200ms ease-out';
  document.body.appendChild(lowHpEl);
}

/** Per-frame tick for the low-HP pulse. Caller passes the current
 *  HP fraction (0-1). Above the threshold the layer fades out;
 *  below it, opacity oscillates on a slow sine breath. */
export function tickLowHpPulse(dt: number, hpFraction: number) {
  ensureLowHp();
  if (!lowHpEl) return;
  const THRESHOLD = 0.30;
  if (hpFraction > THRESHOLD || hpFraction <= 0) {
    // Above threshold OR dead (death sequence owns the screen) — fade out.
    if (lowHpEl.style.opacity !== '0') lowHpEl.style.opacity = '0';
    lowHpTime = 0;
    return;
  }
  lowHpTime += dt;
  // Pulse faster as HP drops lower — at 30% it breathes; at 10% it's
  // a near-panic flash.
  const urgency = 1 - hpFraction / THRESHOLD;       // 0 at threshold → 1 at zero
  const freq = 1.8 + urgency * 3.5;                 // breaths/sec
  const baseAlpha = 0.18 + urgency * 0.30;          // floor of pulse
  const swing = 0.18 + urgency * 0.22;              // amplitude
  const alpha = baseAlpha + Math.sin(lowHpTime * freq * Math.PI * 2) * 0.5 * swing;
  lowHpEl.style.transition = 'opacity 80ms linear';
  lowHpEl.style.opacity = String(Math.max(0, Math.min(0.9, alpha)));
}
