// All tuning constants live here. Change values, save, see the result.
// This is the file Josh will iterate on most during atmosphere tuning.

export const CONFIG = {
  // === PALETTE ===
  // Restrained, grimdark. No saturated colors.
  WALL_COLOR: 0x1a1714,        // near-black warm stone
  FLOOR_COLOR: 0x0f0d0b,       // darker than walls
  CEILING_COLOR: 0x080706,     // darkest
  // Neutral cool-gray ambient (not warm). Torchlight then *adds* warmth where
  // torches are, leaving non-lit areas slightly cool — so the chamber feels
  // warm vs the corridor feeling cooler vs the antechamber feeling sickly-green.
  // Previous warm-sepia ambient (0x231711) painted the whole world ochre.
  // Ambient bumped 1.1 → 1.5 → 1.8 — the procgen rooms are larger than
  // the hand-authored floor 1 and torch coverage is sparser, so the gap
  // between "lit by torch" and "pitch black" was too binary. The 1.8
  // bump lifts unlit corners without flattening the warm-torch
  // contrast that defines the mood. Slight cool-gray base keeps mood
  // without saturating the warm torch additions.
  AMBIENT_COLOR: 0x1a1e24,
  AMBIENT_INTENSITY: 1.8,

  // === FOG ===
  // Hides everything beyond torch range. Sells the dread.
  // Bumped 7 → 9 so larger procgen rooms read clearly past the immediate
  // 6m halo of a torch — fog still hides the room's far end, but you can
  // SEE that there IS a far end (silhouettes, distant emissives).
  FOG_COLOR: 0x000000,
  FOG_NEAR: 1.5,
  FOG_FAR: 9,
  // Camera far clip plane. Kept JUST past FOG_FAR (not the old 50m) — fog is
  // 100% opaque by FOG_FAR, so anything beyond is invisible black, yet a large
  // far plane still SUBMITS all that geometry as draw calls (the dungeon has no
  // occlusion culling, so a sightline through several rooms toward a distant
  // room draws every one of them). Clipping at the fog distance frustum-culls
  // the fogged-invisible geometry: ~halves draw calls on long room sightlines
  // for ~zero visual change. The +4 buffer keeps the fog gradient on the
  // immediate next room clean (no hard clip edge inside the visible range).
  CAMERA_FAR: 13,

  // === TORCHLIGHT ===
  // Note: Three.js r155+ uses physical light units (candela). A torch needs
  // intensities in the 50-200 range, not single digits, to actually light a room.
  TORCH_COLOR: 0xffaa55,       // warm orange flame
  TORCH_INTENSITY: 115,        // bumped 95 → 115 for procgen-room visibility
  TORCH_DISTANCE: 11,          // bumped 10 → 11 to reach corners of larger rooms
  TORCH_DECAY: 1.4,            // gentler-than-physical falloff — more "torch in dungeon"
  TORCH_FLICKER_AMOUNT: 0.4,   // how much intensity varies (0-1)
  TORCH_FLICKER_SPEED: 0.08,   // how fast it changes (lower = slower)
  TORCH_HEIGHT: 2.2,           // mounted on wall

  // === HANDHELD LAMP ===
  // Player-carried light source that follows the camera. Gives consistent
  // visibility in the immediate vicinity (~3m) so corners and corridors
  // between torches aren't pitch-black. Warmer than torches so the
  // player's "personal halo" reads distinctly from the room's lighting.
  LAMP_INTENSITY: 60,
  LAMP_DISTANCE: 5.5,

  // === PLAYER ===
  PLAYER_HEIGHT: 1.6,          // eye level
  MOVE_SPEED: 2.5,             // meters per second — slow, deliberate
  LOOK_SENSITIVITY: 0.004,     // touch swipe to camera rotation
  JOYSTICK_DEADZONE: 0.1,

  // === RENDER ===
  PIXEL_RATIO_CAP: 2,          // cap DPR on desktop (debug) — crisp
  // Mobile caps DPR lower: phones are fragment/fillrate-bound, and a 2x
  // DPR panel renders 4x the pixels of 1x. 1.5 keeps text/edges sharp
  // while cutting ~44% of the fragment work vs 2x — the single biggest
  // lever against overdraw in the boss arenas. Chosen by isDesktopLike().
  PIXEL_RATIO_CAP_MOBILE: 1.5,
  FOV: 70,                     // vertical FOV. In phone landscape ≈ 100° horizontal — wide enough for first-person crawler

  // === WALLS — surface variation ===
  WALL_SUBDIVISIONS_X: 16,     // segments along width — more = finer noise
  WALL_SUBDIVISIONS_Y: 12,
  WALL_VERTEX_JITTER: 0.04,    // meters of inward/outward perturbation per vertex

  // === SWORD (first-person held weapon) ===
  SWORD_REACH: 1.9,            // meters — distance enemies must be within to be hit
  SWORD_CONE_HALF_ANGLE: 0.7,  // radians (~40°) — forward arc that registers hits.
  INTERACT_CONE_HALF_ANGLE: 0.9, // radians (~52°) — must look roughly at an
                                 //   interactable before its prompt + USE button
                                 //   appear. Otherwise the player would be told
                                 //   "TAKE" about loot directly behind them.
                               //   Generous so the player doesn't have to look
                               //   precisely at the target (especially low rats).
  // Tap-to-use tuning (the diegetic "tap the object" interaction). One place
  // to tune how forgiving touch interaction feels.
  INTERACT_TAP_PROXIMITY_PX: 60, // screen-space near-miss radius (px). A tap this
                                 //   close to a thin floating viewmodel (starter
                                 //   weapons, dropped rings) still counts as hitting
                                 //   it — forgives the 30cm-sword silhouette without
                                 //   becoming a whole-screen grab. The big, reliable
                                 //   target is the floating TAKE label (tappable);
                                 //   this just softens near-misses on the model.
  SWORD_SWING_WINDUP: 0.12,    // seconds — sword raises
  SWORD_SWING_STRIKE: 0.10,    // seconds — sword chops through (hit window is here)
  SWORD_SWING_RECOVER: 0.28,   // seconds — return to idle; can't attack again
  SWORD_IDLE_POS: [0.35, -0.32, -0.55] as const,  // bottom-right of view
  SWORD_IDLE_ROT: [-0.2, -0.15, 0.4] as const,    // tilted across body

  // === ENEMY (cross-instance constants only — per-enemy values live in src/content/enemies.ts) ===
  ENEMY_HIT_FLASH_COLOR: 0xffeedd,
  ENEMY_HIT_FLASH_DURATION: 0.08,

  // === ENEMY AI (cross-instance perception + idle feel) ===
  // The "I see you" hesitation, search-phase length, and idle gaze drift.
  // Rationale for each lives at its use site in src/mobs/enemy.ts.
  ENEMY_AI: {
    ALERTED_DURATION: 0.45,           // s — hesitation after first spotting the player
    SEARCH_DURATION: 3.0,             // s — search at last-known position before giving up
    IDLE_SCAN_INTERVAL_MIN: 3.0,      // s — base gap between idle gaze changes
    IDLE_SCAN_INTERVAL_JITTER: 2.5,   // s — + up to this (desyncs a swarm)
    IDLE_SCAN_HALF_ARC: 0.5,          // rad — ±29° max from home yaw
    IDLE_SCAN_STEP: 0.35,             // rad — ±20° gentle step per gaze change
    IDLE_SCAN_HOLD_CHANCE: 0.4,       // fraction of changes that just pause
  },

  // === EFFECTS — DRIFTING MOTES (ambient dust atmosphere) ===
  EFFECTS_MOTES: {
    COUNT: 38,            // sparse — feedback was "not too crowded"
    SPAWN_Y_MIN: 0.25,
    SPAWN_Y_MAX: 2.60,
    LIFE_MIN: 6.0,        // seconds
    LIFE_MAX: 11.0,
    DRIFT_SPEED_LAT: 0.06, // m/s — sideways drift max
    DRIFT_SPEED_UP: 0.10,  // m/s — upward drift max
    BASE_SIZE: 0.085,
    FADE_FRACTION: 0.18,   // first/last 18% of life ramps size
  },

  // === COMBAT CRUNCH ===
  HIT_PAUSE_MS: 80,            // freeze duration on landing a hit — THE feel feature
  SCREEN_SHAKE_HIT_MAGNITUDE: 0.04,  // meters of camera offset
  SCREEN_SHAKE_HIT_DURATION: 0.14,   // seconds
  HAPTIC_HIT_MS: 22,           // navigator.vibrate on landing hit
  DAMAGE_NUMBER_LIFETIME: 0.7, // seconds before damage number removed
  DAMAGE_NUMBER_RISE: 60,      // pixels the number floats up over its lifetime

  // === ATTRIBUTES (Might / Finesse / Lore / Grit) ===
  // Spent at the harbor; see docs/HARBOR-AND-PROGRESSION.md. Each stat
  // has a UNIVERSAL floor (wanted by every build), FAMILY scaling (only
  // its matching weapon, by per-item grade), and a SIGNATURE verb.
  // Iterate feel here.
  ATTR: {
    // Might + Lore each add this much to ALL weapon damage per point —
    // the "no dead points" floor. Kept below the matching-family rate
    // so concentrating in your weapon's stat always wins.
    UNIVERSAL_DMG_PER_POINT: 0.01,    // +1% all weapon damage / point
    // Matching-family damage per point, by the weapon's scaling grade.
    // A default weapon is grade B (+2%/pt for its family stat); named /
    // fabled weapons can scale harder (A/S), the Phase-5 LLM seam.
    SCALING_GRADE: { S: 0.04, A: 0.03, B: 0.02, C: 0.012, D: 0.006 } as Record<string, number>,
    FINESSE_CRIT_PER_POINT: 0.02,     // +2% crit chance / point (Finesse floor)
    GRIT_HP_PER_POINT: 3,             // +3 max HP / point (Grit floor)
    GRIT_ARMOR_SCALE_PER_POINT: 0.03, // equipped armor ×(1 + 0.03·Grit)
    // Lore SIGNATURE — the player's afflictions (DoT statuses: poison/
    // bleed/burn) last longer AND tick harder. The hexer build.
    LORE_AFFLICT_DURATION_PER_POINT: 0.05, // +5% status duration / point
    LORE_AFFLICT_POTENCY_PER_POINT:  0.04, // +4% DoT tick damage / point
  },

  // === PLAYER HEALTH ===
  PLAYER_HP_MAX: 8,    // bumped from 5 — multiple enemies stacking damage is brutal at 5
  PLAYER_HIT_PAUSE_MS: 110,         // longer freeze than landing — getting hit hurts more
  PLAYER_HIT_SHAKE_MAGNITUDE: 0.12, // stronger than landing-shake
  PLAYER_HIT_SHAKE_DURATION: 0.28,
  PLAYER_HIT_HAPTIC_MS: 60,         // longer buzz on damage
  // Damage→feedback scaling. A hit's crunch (freeze/shake/haptic, both
  // directions) multiplies by 1 + (dmg-1)*SLOPE, clamped to MAX — so a
  // 1-dmg graze is baseline and a heavy blow really lands. Strong hits =
  // strong feedback, the v2 ask.
  HIT_FEEDBACK_DMG_SLOPE: 0.45,
  HIT_FEEDBACK_DMG_MAX: 2.4,
  // Player hurt-box: a vertical capsule on the player's body, NOT the old
  // flat 0.4m cylinder × ±1.2m band. A shot over the head or at the feet
  // now misses; hits register against the body. (eye/PLAYER_HEIGHT=1.6.)
  PLAYER_HIT_CAPSULE_BOTTOM_Y: 0.45,
  PLAYER_HIT_CAPSULE_TOP_Y: 1.75,
  PLAYER_HIT_CAPSULE_RADIUS: 0.40,
  VIGNETTE_FLASH_OPACITY: 0.85,
  VIGNETTE_FLASH_FADE_MS: 280,

  // === DEATH SEQUENCE ===
  DEATH_SLOWMO_SCALE: 0.25,         // dt multiplier while dying
  // Sequence holds longer now (3.2 → 4.8s) so the bigger epitaph fade
  // has time to land before the end screen takes over — the moment
  // wants to breathe.
  DEATH_SEQUENCE_DURATION: 4.8,     // seconds before end screen appears
  DEATH_VIGNETTE_DARKEN_MS: 1800,   // red vignette ramps in over this
};
