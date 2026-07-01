// All tuning constants live here. Change values, save, see the result.
// This is the file Josh will iterate on most during atmosphere tuning.

// Stamina capacity. Extracted so STAMINA cost values below can be
// expressed as exact fractions of it (DASH = MAX/3, CHARGED = MAX/6).
// Tweaking it auto-updates the costs.
const STAMINA_MAX = 100;

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
  // for ~zero visual change. +1 buffer past FOG_FAR is all the fog gradient
  // needs — fog is already fully opaque AT FOG_FAR, so the 9-10m band is pure
  // black; the cushion only avoids a hard clip edge sitting exactly on the fog
  // wall. (Was 13 / +4; portal cull now distance-caps room geometry at FOG_FAR
  // too — see room-culling.ts — so the far plane only has to cover the current
  // room's own straddling geometry, not whole rooms down a sightline.)
  CAMERA_FAR: 10,

  // === TORCHLIGHT ===
  // Note: Three.js r155+ uses physical light units (candela). A torch needs
  // intensities in the 50-200 range, not single digits, to actually light a room.
  TORCH_COLOR: 0xffaa55,       // warm orange flame
  // POOLS, NOT FLOODS. The old values (115 / 11m / decay 1.4 — both
  // bumped historically "to reach room corners") made every torch a
  // room floodlight: any room with 2+ torches was wall-to-wall lit and
  // no placement logic could create darkness. Physical-ish decay 2.0
  // with a short window gives each torch a ~3m pool — bright within
  // arm's reach, presence to ~6m, DARKNESS BETWEEN POOLS. Navigability
  // floor comes from the dim ambient fill + the player's lamp + the
  // dark-adapt post lift, not from torches doing the fill's job.
  TORCH_INTENSITY: 48,         // +15% (Josh, first dial after the pools remake)
  TORCH_DISTANCE: 11,          // second range bump from the phone walk (7 → 9 → 11)
  TORCH_DECAY: 2.0,
  TORCH_FLICKER_AMOUNT: 0.4,   // how much intensity varies (0-1)
  TORCH_FLICKER_SPEED: 0.08,   // how fast it changes (lower = slower)
  TORCH_HEIGHT: 2.2,           // mounted on wall

  // === HANDHELD LAMP ===
  // Player-carried light source that follows the camera. Gives consistent
  // visibility in the immediate vicinity (~3m) so corners and corridors
  // between torches aren't pitch-black. Warmer than torches so the
  // player's "personal halo" reads distinctly from the room's lighting.
  LAMP_INTENSITY: 90,
  LAMP_DISTANCE: 5.5,

  // === PLAYER ===
  PLAYER_HEIGHT: 1.6,          // eye level
  MOVE_SPEED: 2.5,             // meters per second — slow, deliberate
  LOOK_SENSITIVITY: 0.004,     // touch swipe to camera rotation
  JOYSTICK_DEADZONE: 0.1,

  // === STAMINA ===
  // A second resource (separate from HP) that gates the high-value
  // actions the playtest found drawback-free: charged melee swings and
  // ranged shots (and, later, sprint/dodge). Abstract 0..MAX points; the
  // HUD shows a fraction. Regenerates after a short delay since the last
  // spend, so steady tapping never touches it but spamming the strong
  // stuff runs you dry. NOT saved — tops back up to full in a few seconds
  // and is reset to full on every floor load (see save-hydration).
  // Stamina capacity is divided into THREE PIPS (= segments) by the HUD
  // renderers. Costs are computed as fractions of MAX so the math is
  // exact: 3 dodges drain MAX exactly (no leftover sliver after the
  // third that would let a fourth squeak through as a soft-commit),
  // and 6 heavies drain MAX exactly. Tweaking MAX or rebalancing
  // segment counts only needs to change values here — the renderers
  // already key off frac (= current/MAX).
  STAMINA: {
    MAX: STAMINA_MAX,
    // Regen tuned for the Elden Ring "the bar means something" feel: a real
    // pause after spending (so a single action doesn't snap straight back to
    // full), and a LONGER recovery once you bottom the bar out ("gassed").
    // Not punishing — ~7 light swings or 2-3 heavies before dry, full refill
    // in a few seconds of not acting.
    REGEN_PER_SEC: 24,        // empty → full in ~4.2s of not spending
    REGEN_DELAY_S: 1.0,       // pause after any spend before regen resumes
    EXHAUST_RECOVERY_S: 2.0,  // longer pause once the bar bottoms out (gassed)
    EXHAUST_CLEAR: 25,        // regen must climb back to this to clear "gassed"
    // Regen keeps running while a heavy charge is RESERVED (held), just at this
    // fraction of full speed — slowed, never frozen, so a patient hold can
    // trickle regen into the charge but cooling down properly is far better.
    HOLD_REGEN_MUL: 0.5,
    // GASSED is FELT, not read: while exhausted the phone pulses a slow
    // heartbeat (see combat/exhaustion-haptic.ts) so "you're winded, power moves
    // are locked out" lands in your hand without a glance at the HUD. Interval
    // between beats, in seconds.
    EXHAUST_HEARTBEAT_S: 0.85,
    // Costs. The COMMITMENT rule (no fizzle): a committal action either commits
    // FULLY — taking whatever stamina is left (soft spend) and gassing you if it
    // empties the bar — or, at exactly empty, is cleanly refused (HUD flash). It
    // NEVER degrades to a weaker version. Going empty is punished by the gassed
    // stalled-recovery (EXHAUST_RECOVERY_S) below.
    //
    // Light swings are FREE (LIGHT_COST 0): the natural thumb-mash is never a
    // dead tap and never a punishment for just playing. Stamina is the budget
    // for the POWER moves — charged melee, ranged, dash. (Raise LIGHT_COST > 0
    // to re-arm a per-swing light drain; 0 keeps light fully off the resource.)
    // Costs are tuned against a **3-SEGMENT** mental model: the bar
    // reads as three pips' worth of action budget (real gaps between
    // them in the HUD). A dodge OR a CHARGED heavy eats one full
    // segment; a ranged shot eats half. So a full bar buys "3 dodges,
    // OR 3 heavies, OR 6 ranged shots, OR …" — legible at a glance
    // without per-action arithmetic.
    //
    // EXPRESSED AS FRACTIONS OF MAX so 3 × DASH_COST = MAX exactly
    // and 6 × RANGED_COST = MAX exactly. Earlier integer rounding
    // (DASH 33, MAX 100) left a 1-stamina sliver after 3 dodges that
    // soft-committed into an unintended 4th stumble-dodge.
    LIGHT_COST: 0,            // free — light tap swings don't touch stamina
    CHARGED_COST: STAMINA_MAX / 3,    // 1 segment — a heavy melee is a real commitment
    RANGED_COST: STAMINA_MAX / 6,     // ½ segment — one crossbow / wand shot
    // Dash / dodge — a discrete lunge with brief i-frames (the Souls roll).
    DASH_COST: STAMINA_MAX / 3,       // 1 segment
    DASH_SPEED: 15,           // impulse speed (m/s) fed to player knockback
    DASH_IFRAME_S: 0.30,      // invulnerability window during the lunge
    // Dodge NEVER blocks — at empty it still fires as a desperate STUMBLE:
    // shorter i-frames + a much weaker, shorter lunge, a camera lurch (see
    // CAMERA_STUMBLE), and it stalls your regen (stallRegen) so a no-stamina
    // escape is a punishing last resort, not free.
    DASH_STUMBLE_IFRAME_MUL: 0.45,  // i-frames as a fraction of full when gassed
    DASH_STUMBLE_SPEED_MUL: 0.5,    // weaker, shorter lunge when gassed
    // A small cooldown after a dodge so it can't be mashed — longer when the
    // dodge was a gassed stumble, so over-extending on empty leaves you committed.
    DASH_COOLDOWN_S: 0.22,
    DASH_COOLDOWN_GASSED_S: 0.9,        // first empty-bar stumble: one desperate hop
    // Chaining stumbles while still gassed escalates hard — the panic
    // button is a button, not a movement tech. A second stumble within
    // the chain window locks the legs for the long cooldown and leaves
    // you WINDED (slowed) — strictly worse than walking.
    STUMBLE_CHAIN_WINDOW_S: 3.0,
    STUMBLE_CHAIN_COOLDOWN_S: 2.2,
    STUMBLE_WINDED_S: 0.9,
    STUMBLE_WINDED_MOVE_MUL: 0.55,
    // Aggression reward (Nightreign-style): a MELEE swing that CONNECTS with an
    // enemy refunds this much stamina, once per swing (ranged is excluded;
    // whiffs and vase-smashes don't pay). Light swings are free, so this is pure
    // upside on the power budget — pressing the attack and landing hits keeps you
    // fueled for the next charged swing or dodge. 0 disables.
    REFUND_ON_HIT: 7,
  },

  // === JUST-DODGE — the skill-ceiling reward layered on the baseline dodge ===
  // A dodge whose i-frames negate an incoming hit in the FIRST sliver of the
  // window was a last-second, REACTIVE dodge — reward it. This is Bloodborne's
  // parry payoff routed through the dodge, because on a phone the dodge is the
  // defensive verb that survives touch latency. An ordinary safe dodge (the hit
  // negated later in the i-frame window, or with no recent dash at all) gets
  // nothing — the TIMING is what's rewarded. Tuned forgiving.
  //
  // The reward is three-part: a brief slow-mo "clarity" beat, a COUNTER window
  // where your next landed hit punishes harder AND cracks poise harder (feeding
  // the future stagger→execute loop), and a stamina kickback so a clean dodge
  // fuels the counter — aggression-as-defense, the combat identity in one beat.
  // Fraction of a melee STRIKE phase at which the swing visually CONTACTS — the
  // arm travels cocked→struck over [0, frac] (see pose-clips poseValue) and the
  // blow lands at `frac` (enemy.ts), so damage connects WHEN THE BLADE ARRIVES,
  // not on strike-frame 0. Fixes the animation/damage disconnect (the strike was
  // a 1-frame teleport that dealt damage before any visible swing) and lets a
  // just-dodge read against the swing instead of only the windup.
  MOB_STRIKE_CONTACT_FRAC: 0.6,

  JUST_DODGE: {
    PERFECT_WINDOW_S: 0.30,    // roll-to-strike-connect gap that counts as a perfect read. Set EQUAL
                               //   to DASH_IFRAME_S (0.30): any roll that survives the blow on its
                               //   i-frames also earns the bonus — generous, rewards reading the tell
                               //   without punishing a roll that fired a hair early. (Was tightened to
                               //   0.20 for a stricter read; reverted to the forgiving 0.30 on feel.)
    NEAR_MISS_GRACE: 0.4,      // m past a strike's reach that still counts — just an edge margin for
                               //   the lunge nudging you off the line. You must roll INSIDE the swing
                               //   at the right beat; dodging from well outside the range earns
                               //   nothing (was 1.8, which rewarded rolls that were never in danger).
    PROJECTILE_GRACE: 0.8,     // m past a bolt's hit radius that a precise roll still reads as a
                               //   dodge — the "whizzed past me" near-miss. Tighter than melee: a
                               //   bolt has to come CLOSE, not just be in the room.
    COUNTER_WINDOW_S: 1.10,    // how long the counter opening stays live
    COUNTER_DAMAGE_MUL: 1.6,   // your next landed hit hits this much harder
    COUNTER_STAGGER_MUL: 2.0,  // and cracks poise this much harder
    REFUND_FRAC: 0.30,         // a perfect dodge refunds this FRACTION of the dodge's own cost
                               //   (DASH_COST) — a partial kickback toward the counter, not a
                               //   near-free dodge (was a flat 22 ≈ 66% of a dodge).
    HAPTIC_MS: 26,             // firmer phone pulse than the dodge's own tick
  },

  // === REACTIVE DEFENSE — the shared "read" layer (deflect + just-dodge) ===
  // One telegraph (enemy flashes as a reachable strike commits), two answers
  // (tap = deflect a WHITE flash, dodge = roll a RED one), one reward:
  // ASYMMETRIC BULLET TIME. A clean deflect or just-dodge slows the WORLD
  // (enemies + projectiles) to BULLET_TIME.WORLD_SCALE for DURATION_S while
  // the player keeps moving at full speed — the flow-vs-frozen payoff that
  // makes both defenses the combat identity (forgiving defense, ruthless
  // offense). The player clock simply omits this scale (see main.ts playerDt).
  BULLET_TIME: {
    WORLD_SCALE: 0.12,         // enemy/projectile speed at the dip's deepest — DEEP, so the
                               //   perfect-dodge slow-mo really lands (was 0.28, barely felt)
    HOLD_FRAC: 0.55,           // fraction of DURATION the world HOLDS at WORLD_SCALE before
                               //   easing back. The old linear ramp spent the deep slow in a
                               //   single instant; holding it is what makes the dip read.
    DURATION_S: 0.85,          // real-time length: hold deep for HOLD_FRAC, then ease to full
  },
  // DEFLECT — the tap answer to a white flash. NOT bullet-time (that's the
  // dodge's reward); deflect is the AGGRESSIVE counter: the enemy flinches
  // back, its poise is chunked, and your NEXT swing is empowered. Stack
  // deflects → poise breaks → full stagger → execute. Pure parrying can
  // break poise on its own (slowly); the empowered hits break it much faster.
  DEFLECT: {
    FLASH_LEAD_S: 0.30,        // how long before the strike the white flash + window open
    // Must comfortably exceed FLASH_LEAD_S so even an instant tap-on-flash
    // stays active THROUGH the strike (and a ~250ms human reaction lands
    // dead-centre). Forgiving for a first feel; tune down on the phone.
    PARRY_WINDOW_S: 0.42,      // a tap opens this active window; a strike landing in it deflects
    COMMIT_S: 0.28,            // the player-action FSM holds 'parrying' this long — a committed
                               //   beat that locks out attack/dodge (parry is a real action, not free)
    LOCKOUT_S: 0.40,           // cooldown after a parry attempt — anti-mash (can't hold a guard)
    POISE_DAMAGE: 2,           // poise CHIPPED per deflect — a single parry FLINCHES (shows the
                               //   body-snap recoil), it does NOT break on its own. Basic mobs
                               //   (poise 4) take ~2 parries; the EMPOWERED counter-swing
                               //   (EMPOWER_STAGGER_MUL) is the fast way to the break + execute.
    FLINCH_LOCK_S: 0.45,       // the flinched enemy can't start a new attack this long
    FLINCH_KNOCKBACK: 3.2,     // backward shove on the flinch (off-balance recoil)
    FLINCH_PITCH: 0.62,        // peak backward body LEAN (rad) on the flinch — the visible recoil snap
    IFRAME_S: 0.16,            // brief safety at the parry instant (a 2nd attacker can't punish it)
    CLASH_FREEZE_MS: 45,       // hit-pause on the clash — the crunch of steel-on-steel
    // EMPOWER — your next swing after a deflect: bigger damage + a much
    // harder poise crack (so deflect → empowered hit → break reads fast).
    EMPOWER_WINDOW_S: 1.4,     // generous — you earned the opening
    EMPOWER_DAMAGE_MUL: 1.8,
    EMPOWER_STAGGER_MUL: 2.5,
    HAPTIC_MS: 28,             // the "ting" pulse on a clean deflect
    FACING_DOT: 0.4,           // a parry only catches a strike from roughly IN FRONT of you —
                               //   dot(camera-forward, dir-to-attacker) must clear this (~±66°).
                               //   You can't parry a blow you aren't looking at; turn to face it.
    FLASH_COLOR: 0xdfe8ff,     // white-cool: DEFLECTABLE (tap)
    UNBLOCK_COLOR: 0xff2a14,   // hot red: UNBLOCKABLE (must dodge)
  },

  // === CHARGE — heavy attack as a stamina RESERVATION (Model B) + perfect release ===
  // Holding a melee charge RESERVES stamina (current → reserved); on release it's
  // committed (spent), on cancel/dodge it's refunded. Power is literally how much
  // you locked in, it auto-caps when usable runs dry, and the ring just stops
  // filling — so a heavy can never "fizzle" because you only build what you could
  // reserve. Regen keeps trickling (slowed, HOLD_REGEN_MUL) so a patient hold can
  // keep reserving off it. A full charge reserves CHARGED_COST; RESERVE_PER_SEC
  // sets how fast (time to full ≈ CHARGED_COST / RESERVE_PER_SEC). Light taps and
  // ranged are unaffected.
  //
  // PERFECT RELEASE — the offense mirror of the just-dodge. Release within a
  // tight window the instant the charge tops out and it OVERCHARGES past max
  // (extra damage + poise crack). The ring flashes white during the window;
  // hold past it and you keep a normal full charge (no bonus, no extra cost).
  CHARGE: {
    // Charge time = CHARGED_COST / RESERVE_PER_SEC. With the new half-
    // segment cost (17), 30/sec keeps the hold-to-full window around
    // ~0.55s — the same "deliberate squeeze" feel as before the cost
    // dropped (was 36 / 60 = 0.60s).
    RESERVE_PER_SEC: 30,       // melee charge reserves stamina at this rate while held
    PERFECT_RELEASE_MS: 160,   // window after hitting full where a release overcharges
    PERFECT_DAMAGE_MUL: 1.35,  // overcharge bonus ON TOP of a full charge's damage
    PERFECT_STAGGER_MUL: 1.5,  // and an extra poise crack
    PERFECT_HAPTIC_MS: 30,     // a firm "clean!" pulse on a perfect release
  },

  // === EXHAUSTION FEEDBACK — felt stamina, not read ===
  // When you've spent yourself down, "winded" is communicated through the body,
  // not a HUD number: breathing audio that quickens + a subtle camera chest-
  // heave, both ramping with exertion (silent/still when rested, light when low,
  // heavy panting + bigger heave when gassed). Pairs with the gassed heartbeat
  // haptic (exhaustion-haptic.ts) and the ghost stamina bar.
  EXHAUSTION: {
    WINDED_THRESHOLD: 0.45,    // usable-stamina fraction below which breathing fades in
    SUBGASSED_MAX: 0.7,        // exertion cap while low-but-not-gassed (gassed = 1.0)
    BREATH_HZ_MIN: 0.40,       // breaths/sec when just winded
    BREATH_HZ_MAX: 0.85,       // breaths/sec when gassed (slow, heavy panting — not frantic)
    HEAVE_Y: 0.035,            // metres of vertical chest-heave at full exertion
    HEAVE_PITCH: 0.012,        // radians of pitch heave at full exertion
    // Visible cold-breath puff (breath.ts) — a pale fog dab exhaled once per
    // breath cycle when winded, drifting up + forward and fading. Heavier
    // (more opaque) the more gassed you are. Sells "cold dungeon, spent lungs".
    BREATH_PUFF_LIFE: 1.1,     // seconds a puff lives
    BREATH_PUFF_SIZE0: 0.06,   // starting sprite scale (metres) — small at the mouth
    BREATH_PUFF_SIZE1: 0.34,   // ending sprite scale — billows out as it dissipates
    BREATH_PUFF_RISE: 0.18,    // metres it drifts UP over its life (warm air rising)
    BREATH_PUFF_FWD: 0.35,     // metres it drifts forward (away from the face)
    BREATH_PUFF_OPACITY: 0.30, // peak opacity at full exertion (scaled down when just winded)
    // Per-puff randomness so no two exhales read identically (natural, not a
    // metronome). Each is a ± fraction / spread applied at spawn.
    BREATH_PUFF_SIZE_VAR: 0.30,    // ±30% on start+end scale
    BREATH_PUFF_LIFE_VAR: 0.25,    // ±25% on lifespan
    BREATH_PUFF_RISE_VAR: 0.35,    // ±35% on how far it floats up
    BREATH_PUFF_FWD_VAR: 0.30,     // ±30% on how far it drifts forward
    BREATH_PUFF_POS_JITTER: 0.05,  // metres of random offset on the spawn point (x/y)
    BREATH_PUFF_DRIFT: 0.14,       // max lateral drift speed (m/s), random sign
    BREATH_PUFF_DELAY: 0.22,       // max seconds a puff lags behind the breath beat
    BREATH_PUFF_WISP_CHANCE: 0.4,  // chance a breath also throws a smaller trailing wisp
  },

  // === CAMERA STUMBLE — the off-balance lurch of a no-stamina dodge ===
  // A single smooth roll + forward-pitch + drop that peaks and recovers, so a
  // gassed stumble-dodge reads as losing your footing (distinct from the jittery
  // hit-shake). Triggered from dash.ts only on an empty-bar dodge.
  CAMERA_STUMBLE: {
    ROLL: 0.10,        // radians (~5.7°) peak roll, random L/R
    PITCH: 0.05,       // radians of forward/down pitch at the peak
    DIP: 0.06,         // metres the view drops at the peak
    DURATION_S: 0.5,   // lurch-and-recover length
  },

  // === RENDER ===
  PIXEL_RATIO_CAP: 2,          // cap DPR on desktop (debug) — crisp
  // Mobile caps DPR lower: phones are fragment/fillrate-bound, and a 2x
  // DPR panel renders 4x the pixels of 1x. This is the SINGLE biggest lever
  // against fill cost — and uniquely it scales the full-res PSX blit too (the
  // heaviest fragment pass), which RENDER SCALE + adaptive-resolution can't
  // touch (they only shrink the low-res scene target). On-phone profiling
  // showed the frame GPU-bound (~25ms) with a view-dependent fill sine as near
  // surfaces fill the screen; 1.5 → 1.25 cuts ~31% of every fragment pass.
  // The 0.4 low-res scene + sharp-upscale already carry the soft PS1 look, so
  // the density drop reads as on-aesthetic, not blur. Chosen by isDesktopLike().
  PIXEL_RATIO_CAP_MOBILE: 1.25,
  FOV: 70,                     // vertical FOV. In phone landscape ≈ 100° horizontal — wide enough for first-person crawler

  // Light-pool slot budget per category (scene/light-pool.ts). EVERY slot —
  // bound or parked at intensity 0 — is compiled into every lit material's
  // shader and evaluated per fragment, so the TOTAL here is a direct
  // per-pixel GPU price. The ATTR sweep measured the old 19-slot budget's
  // headroom at ~24% of frame GPU on an integrated-GPU test box; 12 buys
  // most of that back. Sources beyond the budget degrade gracefully: the
  // pool binds the nearest N per category (LOS-culled, hysteresis-stable)
  // and an unbound torch keeps its emissive flame sprite — it just stops
  // casting light.
  // Re-render the lamp's shadow cube-map every Nth frame (1 = every frame).
  // WAS 2 to halve the cost — but Three renders all 6 cube faces in one shot on
  // an update, so N=2 LUMPS that onto every other frame: a 2-frame draw/GPU
  // spike (~60 draws on, ~0 off) that reads as relentless judder. Variance
  // wrecks frame consistency worse than the average cost it saved. At N=1 the
  // cost is CONSTANT (no spike) — and it's cheap: the 6 faces are CPU
  // draw-submission of only the few in-range casters (shell is receive-only;
  // shadow far already tight at the ~5.5m lit pool), which hides under the
  // GPU-fill wall on a phone. If a later profile goes CPU-bound here, amortize
  // faces across frames rather than re-lumping them.
  SHADOW_UPDATE_EVERY_N_FRAMES: 1,

  LIGHT_SLOTS: {
    lamp: 1,          // the player's lantern — always wins
    environment: 10,  // torches/candles/glows — 6 starved dense rooms (fills + torches + sconces contend); soft-LOS dimming keeps the extra slots cheap to LOOK at
    // Signature-interactable glows ONLY (reliquary, tithe basin, challenge
    // offering, shrouded relic — the "light = signal" objects). Dropped
    // items and chests stopped using lights long ago; their glow is an
    // emissive disc.
    pickup: 2,
    // Projectiles carry an emissive core + trail (and bloom); the light
    // spill on walls wasn't worth a per-fragment slot on every material.
    projectile: 0,
  },

  // === WALLS — surface variation ===
  WALL_SUBDIVISIONS_X: 16,     // segments along width — more = finer noise
  WALL_SUBDIVISIONS_Y: 12,
  WALL_VERTEX_JITTER: 0,       // random per-vertex perturbation. 0 = OFF — the
                               // high-noise random wobble read as melted/glitchy,
                               // not stone. Walls keep the smooth low-freq WAVE
                               // for gentle undulation; deliberate surface texture
                               // is the richness pass (docs/surface-richness.md).

  // === VERTICALITY — fake depth on a flat playfield ===
  // Chasm voids (vault `voids`) and ceiling shafts sell vertical space
  // without any player-Y simulation. The fade distances are where the
  // geometry dives to pure black — shorter = the abyss starts sooner.
  CHASM_DROP_M: 9,             // depth of a chasm void's drop walls
  CHASM_FADE_M: 3.0,           // metres below the rim where the drop reaches pure black
  SHAFT_RISE_M: 6,             // ceiling shaft height above the room ceiling
  SHAFT_FADE_M: 2.6,           // metres above the lip where the shaft reaches pure black
  // Per-room roll for a procedural ceiling shaft (big flat-ceiling stone
  // rooms only; mutually exclusive with the ceiling-breach roll, which
  // is checked first at 0.10).
  SHAFT_CHANCE: 0.10,
  // Floor grate — iron bars flush with the floor over a recess that falls
  // toward a faint ember glow: the next depth, previewed. Walkable (the
  // playfield is 2D; the bars are the visual truth). Floor event — rolls
  // independently of the ceiling events, skips stairwell rooms.
  GRATE_CHANCE: 0.12,
  GRATE_DEPTH_M: 2.6,          // recess depth below the bars
  GRATE_FADE_M: 1.8,           // metres below the bars where the recess walls go black
  // The ember seen through the bars. Unlit basic material — this colour IS
  // the brightness. Keep it well below the lamp baseline: a promise of the
  // depth, not a light source.
  GRATE_GLOW_COLOR: 0x3f1d08,
  // Sloped corridors render as cut stone STAIRS (the grimdark idiom — a
  // smooth ramp read as a parking garage on the phone). Target riser
  // height per tread; the eye and collision still glide the smooth
  // linear grade underneath, so the camera never judders step to step.
  STAIR_RISER_M: 0.18,
  // DESCENT BIAS — procgen floors trend DOWNWARD, never up (the delve
  // is the thesis; lower = deeper = closer to the exit, and the player
  // learns it without being told). Each room-to-room connection rolls
  // one of these drops; flat stays the majority so descent remains an
  // event. Rolled drops are clamped to what the connecting corridor's
  // stair-run can carry at ELEVATION_MAX_GRADE.
  ELEVATION_DROP_WEIGHTS: [
    { drop: 0.0, weight: 50 },
    { drop: 0.6, weight: 35 },
    { drop: 1.2, weight: 15 },
  ],
  // Max drop per metre of stair-run (0.40 ≈ 22° — the elevation-lab
  // grade Josh signed off from the phone).
  ELEVATION_MAX_GRADE: 0.40,

  // === RANGED COMMITMENT ===
  // Accuracy demands stillness — the fix for "ranged is too spammable". A shot
  // fired while MOVING blooms off-aim; planted = dead-on. So kiting-while-firing
  // scatters, and to land a real shot you must stop and expose yourself — the
  // front-loaded RISK that makes ranged deliberate instead of a safe DPS faucet.
  // This is the max horizontal jitter (radians, ~9°) at full movement; it scales
  // linearly with joystick magnitude and is 0 when standing still. Auto-aimed
  // (locked-on) shots bloom too, so lock-spam can't dodge the rule.
  RANGED_MOVE_SPREAD_RAD: 0.16,

  // === SWORD (first-person held weapon) ===
  // Held-pose smoothing rate (per second) for the IDLE / charge-hold state only
  // — eases discrete pose changes (a directional charge SWITCH, a combo-step
  // change, starting a charge right after a swing) instead of snapping. Active
  // swing animations are NOT smoothed (they keep their crisp snap). Higher =
  // snappier; ~22 reaches 90% in ~0.1s, a quick swing-over not a teleport.
  HELD_POSE_SMOOTH_RATE: 22,
  SWORD_REACH: 1.9,            // meters — distance enemies must be within to be hit
  SWORD_CONE_HALF_ANGLE: 0.7,  // radians (~40°) — forward arc that registers hits.
  // Melee hit is a 3D capsule (genre-standard weapon hitbox), swept across the
  // swing's arc, tested vs each enemy's hurtbox sphere (position + aimHeight,
  // hitRadius). RADIUS is the forgiveness knob — fat capsule = forgiving, but
  // since it's posed along your TRUE look direction, pitch (ground vs upright)
  // matters. SWEEP_SAMPLES sub-steps the sweep so nothing tunnels.
  SWORD_HITBOX_RADIUS: 0.45,
  SWORD_HITBOX_SWEEP_SAMPLES: 5,
  // ── Melee weapon hitbox (enemy path — see docs/COMBAT-HIT-SYSTEM.md) ──
  // The swing is a capsule swept along your TRUE look dir, tested against each
  // enemy's hurtbox ZONES (body capsule + head sphere + weak/armor). Precise-
  // but-tunable: the blade itself is thin (RADIUS), forgiveness is a SEPARATE
  // global knob (INFLATION) added on top — dial INFLATION up for generous mobile
  // thumbs, down toward 0 for honest hits. The enemy now carries real body
  // volume, so total reach to a body = RADIUS + INFLATION + bodyRadius.
  MELEE_HITBOX_RADIUS: 0.12,      // blade thickness — the precise core
  MELEE_HITBOX_INFLATION: 0.30,   // forgiveness added on top (tune on phone)
  // CLEAVE FALLOFF — a multi-target sweep hits its NEAREST target full, then each
  // further target takes a diminishing cut (geometric: full, ×FALLOFF, ×FALLOFF²
  // …) floored at MIN. So wide swings still clear chip damage + feel great, but
  // a crowd isn't deleted by one arc — being outnumbered stays dangerous (the
  // grimdark point). Single-target moves never see this (they only ever hit one).
  CLEAVE_DAMAGE_FALLOFF: 0.5,     // each successive cleaved target's share of the last
                                  //   (steeper than before: the 2nd target eats 50%,
                                  //   the 3rd 25% — a crowd is chipped, not deleted, so
                                  //   being outnumbered stays dangerous — the grimdark point)
  CLEAVE_DAMAGE_MIN: 0.25,        // floor — a cleaved target never drops below this ×
  // Melee reach is DERIVED from the weapon's model, not authored free — so the
  // hit can't drift from the visible blade. reach = BASE + extent × PER_EXTENT,
  // where `extent` is the 3D distance from the model's grip anchor to its reach
  // point (blade_tip / head_top / strike_point), in metres. BASE is the shared
  // arm/stance offset (eye→grip); PER_EXTENT converts a metre of blade into a
  // metre of reach. A weapon nudges with WeaponStats.reachMul; whip + ranged
  // keep an explicit `reach` (their reach intentionally exceeds the held model).
  // See the derive pass at the bottom of content/items.ts.
  MELEE_REACH_BASE: 0.9,
  MELEE_REACH_PER_EXTENT: 1.1,
  // (Swing-arc width is now per weapon CLASS + per-weapon override —
  // `swingArc` in weapon-classes.ts / WeaponStats — not a global knob.)
  // EXECUTION / FINISHERS — the payoff that makes the poise game visible and
  // feeds the Dark-Souls "break poise → riposte" loop. An enemy is EXECUTABLE
  // ONLY while STAGGERED (poise broken). That's the single reason to chase a
  // stagger: a heavy hit on a staggered enemy is a FINISHER — damage ×MUL
  // (lethal on nearly all trash) + a heavier crunch + the stamina reward below.
  // (The old low-HP "chip execute" path is gone; execution is now earned, not
  // free.) Sustain is EARNED + KILL-BASED here, not a per-hit drain. These are
  // the per-weapon identity surface later (scythe heals more, etc).
  // See docs/COMBAT-HIT-SYSTEM.md.
  EXECUTE: {
    DAMAGE_MUL: 2,    // finisher damage multiplier — DOUBLE, not a delete button
    HEAL: 0,          // no heal — sustain stays scarce/grimdark (tune up if wanted)
    STAMINA: 30,      // refund stamina on the finishing heavy hit — fuels aggression
    // Only a CHARGED heavy executes a staggered foe — a swing held to at least
    // this charge. Light swings deal normal damage in the open window (they no
    // longer trigger the finisher), so you LIGHT-COMBO the stagger to rack
    // damage, then HEAVY-FINISH to execute. A clean tap is charge 0, so it's
    // cleanly excluded; this low bar means a brief, deliberate hold qualifies.
    MIN_CHARGE: 0.15,
  },
  INTERACT_CONE_HALF_ANGLE: 0.9, // radians (~52°) — must look roughly at an
                                 //   interactable before its prompt + USE button
                                 //   appear. Otherwise the player would be told
                                 //   "TAKE" about loot directly behind them.
                               //   Generous so the player doesn't have to look
                               //   precisely at the target (especially low rats).
  AUTO_PICKUP_RADIUS: 0.7,       // m (XZ). Decision-free items (consumables) are
                                 //   grabbed when you walk this close — no tap, no
                                 //   facing. Tighter than the 1.0 tap radius so it
                                 //   reads as "step onto it", not "vacuum from afar".
                                 //   Gear is NOT auto-grabbed (equipping is a choice).
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
  SWORD_IDLE_POS: [0.35, -0.40, -0.55] as const,  // bottom-right of view (dropped 8cm from -0.32 — sword hangs lower at rest)
  SWORD_IDLE_ROT: [-0.2, -0.15, 0.4] as const,    // tilted across body

  // === ENEMY (cross-instance constants only — per-enemy values live in src/content/enemies.ts) ===
  ENEMY_HIT_FLASH_COLOR: 0xffeedd,
  ENEMY_HIT_FLASH_DURATION: 0.08,

  // === ENEMY AI (cross-instance perception + idle feel) ===
  // The "I see you" hesitation, search-phase length, and idle gaze drift.
  // Rationale for each lives at its use site in src/mobs/enemy.ts.
  ENEMY_AI: {
    ALERTED_DURATION: 0.45,           // s — hesitation after first spotting the player
    TURN_RATE: 11.0,                  // rad/s — body turn toward the player while CHASING. Fast
                                      //   enough to track a circling player with no visible lag (so
                                      //   a prowler doesn't end up facing backwards), but not an
                                      //   instant snap — big reorients still carry a little weight.
    WINDUP_AIM_RATE: 9.0,             // rad/s — turn speed at the START of a wind-up (it snaps the
                                      //   aim onto you so a swing never launches facing the wrong
                                      //   way), RAMPED to 0 by the moment of commit (so a late juke
                                      //   slips it). Strike + recovery are then fully LOCKED (rate 0
                                      //   in faceTarget) — circle out of the arc to whiff it and
                                      //   punish the locked recovery. This is the commit/positioning
                                      //   read; tune the start rate down for heavier, slower aimers.
    SEARCH_DURATION: 3.0,             // s — search at last-known position before giving up
    // Idle gaze: a mob at post should mostly STAND and watch, with the odd small
    // reorientation — NOT pivot its whole body left-right on a timer (that reads
    // as a robot metronome). So: long gaps, mostly holds, small turns, a tight
    // arc, and a home-pull in the random-walk (enemy.ts) so it settles looking
    // forward instead of pinging between the arc edges.
    IDLE_SCAN_INTERVAL_MIN: 4.5,      // s — base gap between idle gaze changes (was 3.0 — too restless)
    IDLE_SCAN_INTERVAL_JITTER: 4.0,   // s — + up to this (desyncs a swarm; 4.5–8.5s gaps)
    IDLE_SCAN_HALF_ARC: 0.34,         // rad — ±19° max from home yaw (was ±29°)
    IDLE_SCAN_STEP: 0.20,             // rad — ±11° gentle step per gaze change (was ±20°)
    IDLE_SCAN_HOLD_CHANCE: 0.62,      // fraction of changes that just pause (was 0.4 — now mostly holds)
    NAV_STUCK_TIME: 0.2,              // s pinned against geometry before a chasing mob sidesteps to flow around it
    // Peripheral awareness — within this range the mob notices a player in ANY
    // direction (LOS required), not just its sight cone. Fixes "only aggros when
    // I'm right on top of it": you can still sneak up from FAR (outside the
    // narrow long cone), but once you're reasonably close it senses you
    // regardless of which way it's looking. Bigger than hearing (which is a
    // through-wall smell); this needs line of sight. Per-spec override below.
    PERIPHERAL_RANGE: 4.5,            // m
    // PACK — a crowd of chasers behaves as a SURROUNDING ring, not a pile on
    // the player's point (src/mobs/pack.ts). Phase 1: ring + separation.
    PACK: {
      RING_RADIUS_BONUS: 0.15,        // m — ring sits at strikeRange + this (hold AT reach, just off the body)
      SEPARATION_RADIUS: 1.05,        // m — chasers within this push apart
      SEPARATION_FORCE: 1.4,          // strength of the apart-push (scaled by overlap, in m/s-ish)
      ATTACK_TOKENS: 3,               // max mobs allowed to COMMIT to an attack at once (the rest prowl)
      TOKEN_REACQUIRE_CD: 0.7,        // s — a mob that just attacked waits this long before it can grab a token again (so others get a turn)
      ORBIT_LEAD: 0.45,               // rad — a WAITING chaser aims this far AHEAD along the ring (a fixed lead → it prowls/circles the player). 0 = hold still
      ORBIT_FLIP_MIN: 1.8,            // s — a prowling mob holds an orbit direction at least this long
      ORBIT_FLIP_MAX: 4.5,            // s — …and at most this, then REVERSES. So a pack doesn't circle one way forever — it weaves, less predictable.
    },
    // INTENT — Enemy AI V2 (docs/ENEMY-AI-V2.md). A chasing mob picks an intent
    // (close/circle/watch/press) on a slow decision tick and HOLDS its attacks
    // until an aggressive intent releases one — so a fight breathes (size-up →
    // burst) instead of shuffling and swinging on cooldown. Stage 1: tempo +
    // individuality. Bosses opt out (they keep constant pressure).
    INTENT: {
      DECISION_MIN: 0.45,     // s — min gap between intent re-decisions (commitment, not jitter)
      DECISION_JITTER: 0.5,   // s — + up to this, per mob, so a pack desyncs
      JITTER: 0.15,           // utility-score noise so a pack doesn't move as one organism
      // Aggression MOOD (0..1) drift. Warms toward a personality target while
      // engaged, drops on hits taken + on committing (spending a swing → the lull).
      MOOD_WARM_RATE: 0.20,   // /s — ease toward the warm target while chasing
      MOOD_TARGET_BASE: 0.45, // warm target = this + boldness * MOOD_TARGET_BOLD
      MOOD_TARGET_BOLD: 0.45,
      MOOD_HURT_DROP: 0.35,   // aggression lost when it takes a hit (recoils, re-sizes-up)
      MOOD_STAGGER_DROP: 0.6, // …and more when poise-broken
      MOOD_COMMIT_DROP: 0.24, // aggression spent committing an attack — forces a lull before the next burst
    },
  },

  // === EFFECTS — DRIFTING MOTES (ambient dust atmosphere) ===
  EFFECTS_MOTES: {
    COUNT: 52,            // bumped 38 → 52 — slightly denser dust catches the torchlight better; still well under "particle storm"
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
  // Global swing-cadence scale. Stretches the COMMITTAL parts of every swing
  // (windup + recover) across ALL weapon classes — >1 = slower attacks, more
  // deliberate/weighty; 1 = the old speed. The strike (hit window) is left
  // unscaled so detection + balance don't shift. Per-class weight (timingMul),
  // attackSpeed, and proficiency still layer on top of this.
  SWING_TIME_SCALE: 1.2,
  // Player attack COMMITMENT — during a swing you lose movement + turn agency,
  // scaled by weapon weight. These are the per-phase floors a FULLY committed
  // weapon (commitment=1, e.g. the hammer) reaches at the DEEPEST point of the
  // phase; the swing arc eases commitment in (windup) and out (recover) around
  // them rather than holding them flat (see swing-agency.ts). Lighter weapons
  // lerp back toward 1.0 (= full freedom). 1 = full agency, 0 = rooted. The
  // STRIKE is the committed window: agency is lowest AND dash is hard-locked
  // (you eat the active frames). windup + recovery are dash-cancelable.
  //
  // MOVE and TURN are decoupled on purpose:
  //   - MOVE bites hard — planting your feet is what sells WEIGHT.
  //   - TURN stays gentle — on a phone the look-drag IS your aim, and choking it
  //     reads as a laggy camera, not a heavy weapon. Turn only really bites at
  //     the brief strike.
  //
  // Per-weapon commitment derives from timingMul (see weapon-classes.ts) —
  // weight is one knob. Tune the FEEL of being committed here; tune which
  // weapons commit there.
  COMMITMENT: {
    WINDUP_MOVE: 0.70, WINDUP_TURN: 0.85,
    STRIKE_MOVE: 0.25, STRIKE_TURN: 0.50,
    RECOVER_MOVE: 0.55, RECOVER_TURN: 0.80,
  },
  HIT_PAUSE_MS: 80,            // freeze duration on landing a hit — THE feel feature
  // Landing-hit FREEZE is DECOUPLED from the shake/haptic crunch. The
  // freeze is kept SHORT + hard-capped: a whole-screen first-person freeze
  // tips into "lag" far sooner than a fighting-game fighter-only freeze
  // (Smash's hitlag at 10 dmg is ~9 frames, and that only freezes the two
  // fighters). The shake + haptic still scale up to HIT_FEEDBACK_DMG_MAX
  // AND keep animating during the freeze (shake runs on an 'always' system)
  // — that's what actually sells the weight, not a longer hang.
  FREEZE_BASE_MS: 60,          // freeze for a minimal connecting hit
  FREEZE_PER_DMG: 6,           // + this per point of damage dealt
  FREEZE_MAX_MS: 130,          // hard cap (~8 frames @60fps); past this = lag
  FREEZE_CRIT_BONUS_MS: 15,    // a crit nudges it a touch past the cap
  SCREEN_SHAKE_HIT_MAGNITUDE: 0.04,  // meters of camera offset
  SCREEN_SHAKE_HIT_DURATION: 0.14,   // seconds
  HAPTIC_HIT_MS: 22,           // navigator.vibrate on landing hit
  DAMAGE_NUMBER_LIFETIME: 0.7, // seconds before damage number removed
  DAMAGE_NUMBER_RISE: 60,      // pixels the number floats up over its lifetime
  // Lifesteal is a CHANCE-ON-KILL proc (item's lifesteal % = the chance),
  // not a per-hit drain — heals this flat amount when it procs. (Playtest:
  // per-damage lifesteal was way too strong.)
  LIFESTEAL_ON_KILL_HEAL: 2,

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
    GRIT_HP_PER_POINT: 2,             // +2 max HP / point (was 3 — playtest: too much)
    GRIT_ARMOR_SCALE_PER_POINT: 0.03, // equipped armor ×(1 + 0.03·Grit)
    // Lore SIGNATURE — the player's afflictions (DoT statuses: poison/
    // bleed/burn) last longer AND tick harder. The hexer build.
    LORE_AFFLICT_DURATION_PER_POINT: 0.05, // +5% status duration / point
    LORE_AFFLICT_POTENCY_PER_POINT:  0.04, // +4% DoT tick damage / point
    // Might SIGNATURE — stagger. A hit's stagger power (weapon weight,
    // see weapon-classes.ts) is multiplied by this per Might point, so
    // 10 Might ≈ +150% stagger. At 0 Might only heavy weapons break
    // poise reliably; Might lets lighter weapons stagger too.
    MIGHT_STAGGER_PER_POINT: 0.15,
  },

  // === POISE / STAGGER ===
  // The enemy stagger pool the player chips with Might-scaled hits.
  // Break it → the enemy's action is cancelled and it reels (a free-hit
  // window). See the poise system in src/mobs/enemy.ts.
  POISE: {
    STAGGER_DURATION: 4.0,  // s the enemy reels after a poise break — a long,
                            //   committed "it's DOWN" window: dizzy spin settles
                            //   into a slumped stun, stars wheeling overhead. Land
                            //   your riposte/execute at leisure, THEN it shakes it
                            //   off (poise already reset full) and the fight goes on.
    REGEN_DELAY: 1.2,       // s of no stagger pressure before the pool refills
    REGEN_RATE: 4,          // poise points / s once regen kicks in
    CHARGE_BONUS: 1.0,      // a FULL charged swing adds this ×stagger (×2 total)
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

  // === FLOOR CONTENT BUDGET (procgen v3) ===
  // Combat is a per-FLOOR budget applied to open space, NOT an accident of
  // which vaults were picked. This is the single legible knob per depth — and
  // COMBAT_MIN is the hard guarantee that a floor is never empty (the v3 bug
  // fix). Counts are floor TOTALS, distributed across all rooms' open cells.
  CONTENT_BUDGET: {
    COMBAT_BASE: 3,             // enemies on the shallowest floor
    COMBAT_PER_DEPTH: 1.0,      // + this many per depth deeper
    COMBAT_JITTER: 1,           // ± whole-enemy wobble so floors vary
    COMBAT_MIN: 3,              // HARD floor — never emptier than this
    COMBAT_MAX: 16,             // cap so deep floors don't become soup
    // Intensity bands by depth ('heavy' upgrades a pack slot to an elite).
    INTENSITY_MEDIUM_DEPTH: 4,  // < this → 'light'
    INTENSITY_HEAVY_DEPTH: 8,   // >= this → chance of 'heavy', else 'medium'
    HEAVY_CHANCE: 0.35,         // odds a deep floor rolls 'heavy'
    // Minor bonfire = a FOUND event, not floor furniture. This is the per-floor
    // chance one appears (deeper in, a rest/card-draw fire). 1.0 = a fire every
    // floor (the old always-on threshold fire); 0 = fires only at safe rooms.
    // The harbor/post-boss fire is unaffected (always present). Tune on feel.
    MINOR_FIRE_CHANCE: 0.5,
  },

  // === DEATH SEQUENCE ===
  DEATH_SLOWMO_SCALE: 0.25,         // dt multiplier while dying
  // Sequence holds longer now (3.2 → 4.8s) so the bigger epitaph fade
  // has time to land before the end screen takes over — the moment
  // wants to breathe.
  DEATH_SEQUENCE_DURATION: 4.8,     // seconds before end screen appears
  DEATH_VIGNETTE_DARKEN_MS: 1800,   // red vignette ramps in over this
};
