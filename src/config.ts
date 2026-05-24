// All tuning constants live here. Change values, save, see the result.
// This is the file Josh will iterate on most during atmosphere tuning.

export const CONFIG = {
  // === PALETTE ===
  // Restrained, grimdark. No saturated colors.
  WALL_COLOR: 0x1a1714,        // near-black warm stone
  FLOOR_COLOR: 0x0f0d0b,       // darker than walls
  CEILING_COLOR: 0x080706,     // darkest
  AMBIENT_COLOR: 0x1a1010,     // faint red/brown ambient — bare minimum visibility
  AMBIENT_INTENSITY: 0.08,     // very low — most light comes from torches

  // === FOG ===
  // Hides everything beyond torch range. Sells the dread.
  FOG_COLOR: 0x000000,
  FOG_NEAR: 1.5,
  FOG_FAR: 7,

  // === TORCHLIGHT ===
  TORCH_COLOR: 0xffaa55,       // warm orange flame
  TORCH_INTENSITY: 2.2,        // base brightness
  TORCH_DISTANCE: 8,           // falloff range
  TORCH_DECAY: 1.8,            // realistic falloff
  TORCH_FLICKER_AMOUNT: 0.4,   // how much intensity varies (0-1)
  TORCH_FLICKER_SPEED: 0.08,   // how fast it changes (lower = slower)
  TORCH_HEIGHT: 2.2,           // mounted on wall

  // === PLAYER ===
  PLAYER_HEIGHT: 1.6,          // eye level
  MOVE_SPEED: 2.5,             // meters per second — slow, deliberate
  LOOK_SENSITIVITY: 0.004,     // touch swipe to camera rotation
  JOYSTICK_DEADZONE: 0.1,

  // === ROOM (Phase 1 single room) ===
  ROOM_WIDTH: 8,
  ROOM_DEPTH: 8,
  ROOM_HEIGHT: 3.2,

  // === RENDER ===
  PIXEL_RATIO_CAP: 2,          // cap DPR for mobile perf
  FOV: 70,                     // wider than 60, narrower than 90 — claustrophobic but readable
};
