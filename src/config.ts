// All tuning constants live here. Change values, save, see the result.
// This is the file Josh will iterate on most during atmosphere tuning.

export const CONFIG = {
  // === PALETTE ===
  // Restrained, grimdark. No saturated colors.
  WALL_COLOR: 0x1a1714,        // near-black warm stone
  FLOOR_COLOR: 0x0f0d0b,       // darker than walls
  CEILING_COLOR: 0x080706,     // darkest
  AMBIENT_COLOR: 0x231711,     // warm sepia/brown ambient — floors and walls remain legible
  AMBIENT_INTENSITY: 0.95,     // bumped from 0.6 so dark corners aren't pure void

  // === FOG ===
  // Hides everything beyond torch range. Sells the dread.
  FOG_COLOR: 0x000000,
  FOG_NEAR: 1.5,
  FOG_FAR: 7,

  // === TORCHLIGHT ===
  // Note: Three.js r155+ uses physical light units (candela). A torch needs
  // intensities in the 50-200 range, not single digits, to actually light a room.
  TORCH_COLOR: 0xffaa55,       // warm orange flame
  TORCH_INTENSITY: 95,         // base brightness (was 80; bumped slightly for elaborated room)
  TORCH_DISTANCE: 10,          // falloff range (extended from 8 to reach far wall)
  TORCH_DECAY: 1.4,            // gentler-than-physical falloff — more "torch in dungeon"
  TORCH_FLICKER_AMOUNT: 0.4,   // how much intensity varies (0-1)
  TORCH_FLICKER_SPEED: 0.08,   // how fast it changes (lower = slower)
  TORCH_HEIGHT: 2.2,           // mounted on wall

  // === PLAYER ===
  PLAYER_HEIGHT: 1.6,          // eye level
  MOVE_SPEED: 2.5,             // meters per second — slow, deliberate
  LOOK_SENSITIVITY: 0.004,     // touch swipe to camera rotation
  JOYSTICK_DEADZONE: 0.1,

  // === RENDER ===
  PIXEL_RATIO_CAP: 2,          // cap DPR for mobile perf
  FOV: 70,                     // vertical FOV. In phone landscape ≈ 100° horizontal — wide enough for first-person crawler

  // === WALLS — surface variation ===
  WALL_SUBDIVISIONS_X: 16,     // segments along width — more = finer noise
  WALL_SUBDIVISIONS_Y: 12,
  WALL_VERTEX_JITTER: 0.04,    // meters of inward/outward perturbation per vertex

  // === SWORD (first-person held weapon) ===
  SWORD_REACH: 1.8,            // meters — raycast distance for hit detection
  SWORD_SWING_WINDUP: 0.12,    // seconds — sword raises
  SWORD_SWING_STRIKE: 0.10,    // seconds — sword chops through (hit window is here)
  SWORD_SWING_RECOVER: 0.28,   // seconds — return to idle; can't attack again
  SWORD_IDLE_POS: [0.35, -0.32, -0.55] as const,  // bottom-right of view
  SWORD_IDLE_ROT: [-0.2, -0.15, 0.4] as const,    // tilted across body

  // === ENEMY (cross-instance constants only — per-enemy values live in src/content/enemies.ts) ===
  ENEMY_HIT_FLASH_COLOR: 0xffeedd,
  ENEMY_HIT_FLASH_DURATION: 0.08,

  // === COMBAT CRUNCH ===
  HIT_PAUSE_MS: 80,            // freeze duration on landing a hit — THE feel feature
  SCREEN_SHAKE_HIT_MAGNITUDE: 0.04,  // meters of camera offset
  SCREEN_SHAKE_HIT_DURATION: 0.14,   // seconds
  HAPTIC_HIT_MS: 22,           // navigator.vibrate on landing hit
  DAMAGE_NUMBER_LIFETIME: 0.7, // seconds before damage number removed
  DAMAGE_NUMBER_RISE: 60,      // pixels the number floats up over its lifetime

  // === PLAYER HEALTH ===
  PLAYER_HP_MAX: 5,
  PLAYER_HIT_PAUSE_MS: 110,         // longer freeze than landing — getting hit hurts more
  PLAYER_HIT_SHAKE_MAGNITUDE: 0.12, // stronger than landing-shake
  PLAYER_HIT_SHAKE_DURATION: 0.28,
  PLAYER_HIT_HAPTIC_MS: 60,         // longer buzz on damage
  VIGNETTE_FLASH_OPACITY: 0.85,
  VIGNETTE_FLASH_FADE_MS: 280,

  // === DEATH SEQUENCE ===
  DEATH_SLOWMO_SCALE: 0.25,         // dt multiplier while dying
  DEATH_SEQUENCE_DURATION: 3.2,     // seconds before page reload
  DEATH_VIGNETTE_DARKEN_MS: 1500,   // red vignette ramps in over this
};
