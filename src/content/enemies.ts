import type { ModelSpec, Vec3 } from '../ecs/model-types';
import type { ContentStatus } from './content-status';
import type { DamageType } from '../combat/damage';
import type { EnemyDeathSize, VocalArchetype } from '../audio/sfx';
import type { Ability } from './abilities';
import type { HurtZoneSpec } from '../combat/hurtbox';
import type { CreatureSpec, SkinPart } from './creature-types';
import { humanoidBipedSkin } from './creature-skins';

/** The 16 leg bones (hip→knee→foot, eight legs) for an arachnid creature,
 *  referencing the joint names the arachnid skeleton generates. Tapered. */
function spiderLegSkin(mat: string): SkinPart[] {
  const out: SkinPart[] = [];
  for (const sl of ['L', 'R']) {
    for (let i = 0; i < 4; i++) {
      out.push({ kind: 'bone', from: `hip${sl}${i}`, to: `knee${sl}${i}`, radius: 0.03, mat });
      out.push({ kind: 'bone', from: `knee${sl}${i}`, to: `foot${sl}${i}`, radius: 0.022, mat });
    }
  }
  return out;
}
import type { Clip } from '../anim/types';
import { creature } from './creature';
import type { DropTableId } from './drop-tables';
import { mimicCreatureSpec } from './mimic';
import { marrowCreatureSpec } from './skeleton-boss';
import { MARROW_CLIPS, MARROW_JOINTS } from '../anim/clips-marrow';
import { GHOUL_BUNDLE, SKELETON_BUNDLE, SKIRMISHER_BUNDLE, DEFILER_BUNDLE, STONEGUARD_BUNDLE } from '../anim/clips-mobs';

// The spec TYPE surface (RangedSpec / EnemySpec / AnimationBundle / PhaseSpec)
// lives in enemy-types.ts. Re-exported here so existing `from './enemies'`
// imports keep working unchanged, and imported locally so the registry below
// can be typed `Record<string, EnemySpec>`.
import type { RangedSpec, EnemySpec, AnimationBundle, PhaseSpec } from './enemy-types';
export type { RangedSpec, EnemySpec, AnimationBundle, PhaseSpec };

// Enemy library. Each entry is data; enemy.ts consumes a spec instead of
// reading constants. Adding a new enemy = add an entry here + reference its
// ID from a LevelSpec spawn.
//
// Stats trade off so combat has rhythm variety:
//   - GHOUL: slow heavy hitter. Long telegraph, easy to read; punishing if missed.
//   - SKIRMISHER: fast light hitter. Short telegraph, attacks more often; small
//     reaction window. Forces you out of the slow ghoul rhythm.

export const ENEMY_AUDIO_SIZE: Record<string, EnemyDeathSize> = {
  wraith: 'spectral',
  rat: 'small',
  // New mob audio sizes.
  'sump-wisp':   'spectral',   // floating, magical — same ethereal palette as the wraith
  'plague-spore':'small',      // small body, soft pop on death
  'marrow-sovereign':'medium', // chunky bone-crack on phase change + death
  'carrion-hound':'medium',    // dog-sized — same as ghoul/skirmisher
  mimic:          'medium',    // chunky thud on death
  'pit-moth':     'small',     // tiny crunch
  lasher:         'medium',    // plant-creature death
  burrower:       'medium',    // wet thud, then collapse
};

/** Idle/aware vocalisation per enemy (mobs/enemy.ts ticks a timer and
 *  plays it positionally). Unlisted = silent (no betraying sound). */
export const ENEMY_VOCAL_ARCHETYPE: Record<string, VocalArchetype> = {
  spider: 'skitter',
  skeleton: 'rattle',
  wraith: 'groan',
  ghoul: 'groan',
  skirmisher: 'groan',
  rat: 'squeak',
  ooze: 'gurgle',
  'ooze-small': 'gurgle',
  stoneguard: 'grind',
  'acid-spitter': 'hiss',
  acolyte: 'hiss',
  defiler: 'hiss',
  // New mobs.
  'sump-wisp':    'groan',     // low spectral hum — fits the wraith family
  'plague-spore': 'hiss',      // wet release
  'marrow-sovereign': 'rattle', // dry bone-rattle, matches the skeleton family
  'carrion-hound':'squeak',    // panting/growling; nearest match in the existing pool
  mimic:          'groan',     // low chest-rattle from the throat
  'pit-moth':     'skitter',   // wing-rustle / tiny clicks
  lasher:         'gurgle',    // wet plant-throat
  burrower:       'gurgle',    // subterranean wet — same family as ooze
};


// --- Enemy registry -----------------------------------------------------

export const ENEMIES: Record<string, EnemySpec> = {
  ghoul: {
    id: 'ghoul',
    name: 'ghoul',
    hp: 4,
    moveSpeed: 1.4,
    attackDamage: 1,
    // A killing blow to a limb zone lops it: head, arms (shoulderL/R), legs
    // (hipL/R). Torso hits usually win the body zone, so limb severs land on
    // clear hits to an outstretched limb — an occasional, earned gore moment.
    severable: ['head', 'shoulderL', 'shoulderR', 'hipL', 'hipR'],

    // attackRange = the distance at which the enemy COMMITS to a swing.
    // strikeRange = the distance at which the swing actually LANDS.
    // strikeRange < attackRange means: if the player backs away during the
    // windup, the swing misses. This is what makes the telegraph escapable.
    attackRange: 1.7,
    strikeRange: 1.55,
    windupTime: 0.90,    // long ghoul tell — heavy enemy, big wind-up animation
    strikeTime: 0.18,
    recoverTime: 0.60,
    // Its OWN attack: a two-claw overhead rake (clips-mobs.ts GHOUL_BUNDLE),
    // not the retired shared biped smash — the ghoul moves like a ghoul.
    animation: GHOUL_BUNDLE,
    // Creature-system ghoul: a gaunt, hunched undead — thin limbs, gnarled
    // (jittered) flesh, clawed hands, sunken glowing eyes. Measured dimensions
    // + auto hitzones.
    creature: {
      id: 'ghoul',
      archetype: 'biped',
      proportions: { height: 1.5, girth: 0.13, armLength: 0.74, legLength: 0.6, headSize: 0.16, hunch: 0.18 },
      materials: {
        // ABSORBED mode — dark rotted flesh, NO rim. A mundane beast hides in
        // the black; only its hot eyes give it away until your lamp finds it.
        // (Self-glow is reserved for arcane things now.)
        flesh: { color: 0x14100c, roughness: 1, flatShading: 'auto' },
        // BONE, pushed through the rot. This is the ghoul's answer to "brown
        // lump": the albedo was already near-black (0x14100c) — the brown is the
        // torch, and every rough surface in a warm room returns the same brown
        // whatever you tint it. What the light CANNOT flatten is a small area of
        // genuinely bright albedo, which is the entire reason the skeleton reads
        // from across a room. Ribs, shoulder caps and a jaw give this body the
        // high-frequency light/dark break a smooth capsule torso cannot have.
        bone: { color: 0xb0a488, roughness: 0.75, flatShading: 'auto' },
        // Claws catch a HIGHLIGHT rather than sitting a shade paler than the
        // flesh — a specular glint survives a room that washes everything warm;
        // a slightly-lighter matte brown does not.
        claw: { color: 0x1d1a16, roughness: 0.3, metalness: 0.25, flatShading: 'auto' },
        eyes: { color: 0xff5530, emissive: 0xff5530, emissiveIntensity: 2.0 },
      },
      eyes: { material: 'eyes', emissive: 2.0 },
      flash: { material: 'flesh' },
      skin: [
        // Gaunt tapered torso + small pelvis, gnarled (jitter).
        { kind: 'capsule', joint: 'spine', radius: 0.16, height: 0.42, jitter: 0.02, mat: 'flesh' },
        { kind: 'box', joint: 'pelvis', size: [0.3, 0.26, 0.22], jitter: 0.02, mat: 'flesh' },
        // Hunched, slightly elongated head; sunken glowing eyes.
        { kind: 'sphere', joint: 'head', radius: 0.15, scale: [0.9, 1.05, 1.12], jitter: 0.02, mat: 'flesh' },
        { kind: 'sphere', joint: 'head', radius: 0.038, pos: [-0.07, 0.0, -0.14], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.038, pos: [0.07, 0.0, -0.14], mat: 'eyes' },
        // A jaw the rot has stripped — the one bright note on the head, right
        // under the eyes, so the face reads as a face at four metres.
        { kind: 'box', joint: 'head', size: [0.13, 0.05, 0.09], pos: [0, -0.10, -0.10], jitter: 0.012, mat: 'bone' },
        // Shoulders stay FLESH. They were bone for one build and the two pale
        // round caps sat at head height reading as a second pair of hot dots —
        // "eyes are sacred, no part may imitate them" (docs/VISUAL-LANGUAGE.md),
        // and a round bright thing beside a face imitates them. The bone goes
        // where it makes a STRIPE (ribs) or a JAW, never where it makes a pair
        // of circles.
        { kind: 'sphere', joint: 'shoulderL', radius: 0.08, mat: 'flesh' },
        { kind: 'sphere', joint: 'shoulderR', radius: 0.08, mat: 'flesh' },
        // NO RIBS HERE, and the failure is worth keeping written down.
        //
        // Tried twice: three pale bars inside the torso outline, then two wider
        // ones tilted so their ends jut past it. Both read at 3.4 m as planks
        // painted on (or driven through) a solid body — not as anatomy. The
        // premise was right and the execution cannot work: the skeleton reads
        // because its bright parts ARE the silhouette and you see black BETWEEN
        // them. On a closed capsule torso there is no between. A bright decal on
        // an unbroken mass stays a decal however you angle it.
        //
        // The real fix is GEOMETRY — a ribcage with gaps you can see the dark
        // through — which is a model rework, not a material pass, so it is not
        // being smuggled in here. What survives on this creature is the JAW
        // (above): it sits on the head's own outline, which is exactly why it
        // works where the ribs did not.
        // Long thin arms.
        { kind: 'bone', from: 'shoulderL', to: 'elbowL', radius: 0.05, mat: 'flesh' },
        { kind: 'bone', from: 'elbowL', to: 'handL', radius: 0.042, mat: 'flesh' },
        { kind: 'bone', from: 'shoulderR', to: 'elbowR', radius: 0.05, mat: 'flesh' },
        { kind: 'bone', from: 'elbowR', to: 'handR', radius: 0.042, mat: 'flesh' },
        // Clawed hands — three splayed talons per hand (cones point +Y at rest;
        // rot ≈ π swings them to hang down/forward off the hand).
        { kind: 'cone', joint: 'handL', radius: 0.022, height: 0.14, pos: [-0.04, -0.05, 0], rot: [2.7, 0, 0], mat: 'claw' },
        { kind: 'cone', joint: 'handL', radius: 0.022, height: 0.15, pos: [0, -0.06, 0], rot: [2.9, 0, 0], mat: 'claw' },
        { kind: 'cone', joint: 'handL', radius: 0.022, height: 0.14, pos: [0.04, -0.05, 0], rot: [2.7, 0, 0], mat: 'claw' },
        { kind: 'cone', joint: 'handR', radius: 0.022, height: 0.14, pos: [-0.04, -0.05, 0], rot: [2.7, 0, 0], mat: 'claw' },
        { kind: 'cone', joint: 'handR', radius: 0.022, height: 0.15, pos: [0, -0.06, 0], rot: [2.9, 0, 0], mat: 'claw' },
        { kind: 'cone', joint: 'handR', radius: 0.022, height: 0.14, pos: [0.04, -0.05, 0], rot: [2.7, 0, 0], mat: 'claw' },
        // Thin legs + gnarled feet.
        { kind: 'bone', from: 'hipL', to: 'kneeL', radius: 0.06, mat: 'flesh' },
        { kind: 'bone', from: 'kneeL', to: 'footL', radius: 0.05, mat: 'flesh' },
        { kind: 'bone', from: 'hipR', to: 'kneeR', radius: 0.06, mat: 'flesh' },
        { kind: 'bone', from: 'kneeR', to: 'footR', radius: 0.05, mat: 'flesh' },
        { kind: 'box', joint: 'footL', size: [0.12, 0.08, 0.24], pos: [0, 0.04, -0.05], jitter: 0.02, mat: 'flesh' },
        { kind: 'box', joint: 'footR', size: [0.12, 0.08, 0.24], pos: [0, 0.04, -0.05], jitter: 0.02, mat: 'flesh' },
      ],
    },
    baseEyeEmissive: 2.0,
    collisionRadius: 0.45,
    tiltPartName: 'spine',
    flashMaterialName: 'flesh',
    eyeMaterialName: 'eyes',
    presence: 'lurch',     // shambling lateral roll + shamble-step dip
    // Ghoul has decent eyes, moderate hearing. Wide cone — has to face you
    // generally to spot you, but the cone is forgiving.
    sightRange: 7,
    sightConeHalfAngle: 1.05,   // ~60° half / 120° total
    hearingRange: 2.5,
    loseSightTime: 4,
    xp: 6,
  },

  rat: {
    id: 'rat',
    name: 'rat',
    hp: 2,           // dies in one hit — the trash mob
    moveSpeed: 2.3,  // slower than player retreat (player MOVE_SPEED = 2.5)
    attackDamage: 1,
    attackRange: 1.0,
    strikeRange: 0.85,   // smaller than attackRange — escapable
    windupTime: 0.70,    // even the trash mob has a clear tell now
    strikeTime: 0.12,
    recoverTime: 0.65,
    // First QUADRUPED creature: a low, lean horizontal body on four legs (trot
    // gait), a pointed snout, big rounded ears, beady red eyes and a long bald
    // tail. The naked parts (tail, ear membranes, paws, nose) use a second
    // pinkish-grey "skin" material — that bald-skin contrast is what reads as
    // RAT instead of a chubby furred lump. Bite uses the telegraph (body lean)
    // — no clip bundle for quadrupeds yet.
    creature: {
      id: 'rat',
      archetype: 'quadruped',
      // Low and lean: short legs (legLength), a long body (height drives body
      // length), a small head so the snout dominates the face.
      proportions: { height: 0.28, girth: 0.18, legLength: 0.12, headSize: 0.09, neckLength: 0.06 },
      materials: {
        fur: { color: 0x241c22, roughness: 1, flatShading: 'auto' },
        // WET, not pale. This was 0x5a4744 — a mid-value warm grey, and under a
        // torch that is precisely the colour of the floor the rat is standing on,
        // which is why a rat at four metres was an invisible brown lump. Same
        // darkness as the fur now, but glossy: tail, ears and snout return a
        // moving highlight instead of a flat tone. A glint reads on a dark body;
        // a lighter brown does not.
        skin: { color: 0x2e2226, roughness: 0.25, metalness: 0.1, flatShading: 'auto' },
        eyes: { color: 0xff2a0a, emissive: 0xff2a0a, emissiveIntensity: 2.0 },
      },
      eyes: { material: 'eyes', emissive: 2.0 },
      flash: { material: 'fur' },
      skin: [
        // Lean body: a slim tube down the spine with a rounded rump at the hips
        // tapering to narrower shoulders — a rat's silhouette, not a fat barrel.
        { kind: 'capsule', joint: 'spine', radius: 0.092, height: 0.2, rot: [1.5708, 0, 0], jitter: 0.015, mat: 'fur' },
        { kind: 'sphere', joint: 'hips', radius: 0.112, jitter: 0.015, mat: 'fur' },   // haunches
        { kind: 'sphere', joint: 'chest', radius: 0.086, jitter: 0.015, mat: 'fur' },  // shoulders
        // Hunched neck bridging shoulders → skull (tapers toward the head).
        { kind: 'bone', from: 'chest', to: 'neck', radius: 0.07, radiusTop: 0.055, mat: 'fur' },
        { kind: 'bone', from: 'neck', to: 'head', radius: 0.055, radiusTop: 0.05, mat: 'fur' },
        // Small wedge skull + a long pointed snout forward (−Z). Skull kept
        // small so the snout — not a round face — defines the head.
        { kind: 'sphere', joint: 'head', radius: 0.068, jitter: 0.01, mat: 'fur' },
        // aim:'forward' = cone apex toward the nose (the intent form of
        // rot −π/2 — this cone shipped pointing INTO the skull once;
        // with aim, that mistake is unwritable).
        { kind: 'cone', joint: 'head', radius: 0.05, height: 0.16, pos: [0, -0.012, -0.12], aim: 'forward', mat: 'fur' },
        { kind: 'sphere', joint: 'head', radius: 0.018, pos: [0, -0.018, -0.2], mat: 'skin' },   // wet nose tip
        // Ears — flattened discs set LOW and LATERAL, swept back, asymmetric
        // (left bigger + more ragged-angled). High front-facing discs read as
        // Mickey-Mouse circles head-on — cute, which the pillars forbid. Low
        // back-swept cups read as a wary sewer rat. Bald inner membrane in
        // skin over a furred outer cup.
        { kind: 'sphere', joint: 'head', radius: 0.046, scale: [1, 1, 0.34], pos: [-0.06, 0.05, 0.024], rot: [-0.55, -0.75, 0.12], mat: 'fur' },
        { kind: 'sphere', joint: 'head', radius: 0.04, scale: [1, 1, 0.34], pos: [0.062, 0.046, 0.028], rot: [-0.4, 0.7, -0.1], mat: 'fur' },
        { kind: 'sphere', joint: 'head', radius: 0.028, scale: [1, 1, 0.3], pos: [-0.058, 0.05, 0.012], rot: [-0.55, -0.75, 0.12], mat: 'skin' },
        { kind: 'sphere', joint: 'head', radius: 0.024, scale: [1, 1, 0.3], pos: [0.06, 0.046, 0.016], rot: [-0.4, 0.7, -0.1], mat: 'skin' },
        // Beady red eyes on the snout sides.
        { kind: 'sphere', joint: 'head', radius: 0.021, pos: [-0.05, 0.012, -0.082], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.021, pos: [0.05, 0.012, -0.082], mat: 'eyes' },
        // Four thin legs (bones span hip→foot; the trot gait swings them) +
        // tiny bald paws. Shoulder caps bridge the FRONT leg bones into
        // the chest mass — the bench's floating-island linter caught
        // both front legs hanging 3.6cm outboard of the shoulder
        // sphere (the haunches already cover the hind pair).
        { kind: 'sphere', joint: 'frontL', radius: 0.04, pos: [0.032, 0.01, 0], jitter: 0.012, mat: 'fur' },
        { kind: 'sphere', joint: 'frontR', radius: 0.04, pos: [-0.032, 0.01, 0], jitter: 0.012, mat: 'fur' },
        { kind: 'bone', from: 'frontL', to: 'footFL', radius: 0.022, mat: 'fur' },
        { kind: 'bone', from: 'frontR', to: 'footFR', radius: 0.022, mat: 'fur' },
        { kind: 'bone', from: 'hindL', to: 'footHL', radius: 0.024, mat: 'fur' },
        { kind: 'bone', from: 'hindR', to: 'footHR', radius: 0.024, mat: 'fur' },
        { kind: 'box', joint: 'footFL', size: [0.034, 0.02, 0.06], pos: [0, 0.01, -0.014], mat: 'skin' },
        { kind: 'box', joint: 'footFR', size: [0.034, 0.02, 0.06], pos: [0, 0.01, -0.014], mat: 'skin' },
        { kind: 'box', joint: 'footHL', size: [0.036, 0.02, 0.064], pos: [0, 0.01, -0.014], mat: 'skin' },
        { kind: 'box', joint: 'footHR', size: [0.036, 0.02, 0.064], pos: [0, 0.01, -0.014], mat: 'skin' },
        // Long bald tail trailing back (+Z), tapering in two segments with an
        // upward flick at the tip — the unmistakable rat tail. The cylinder's
        // +Y end points at the BODY after the X-rotation, so radiusTop is the
        // fat root (0.03) and `radius` the thin far end (0.02) — fat-at-rump,
        // thin-at-tip. Tip cone's base sits ON the cylinder's far end
        // (≈ z 0.44) and its apex flicks up-back.
        // Root buried 4cm into the haunch — the island linter showed the
        // old z=0.28 root only GRAZED the jittered rump (jitter can pull
        // vertices 15mm in, opening a visible seam).
        { kind: 'cylinder', joint: 'hips', radius: 0.02, radiusTop: 0.03, height: 0.32, pos: [0, 0.0, 0.24], rot: [-1.45, 0, 0], mat: 'skin' },
        { kind: 'cone', joint: 'hips', radius: 0.019, height: 0.26, pos: [0, 0.03, 0.52], rot: [1.2, 0, 0], mat: 'skin' },
      ],
    },
    baseEyeEmissive: 2.0,
    collisionRadius: 0.18,
    // Player walks RIGHT THROUGH rats — they're foot-high scurriers
    // and getting bodyblocked by one mid-fight feels bad. Still
    // pathfind / take damage / deal damage normally; just no
    // movement collision against the player.
    noPlayerCollision: true,
    tiltPartName: 'spine',
    flashMaterialName: 'fur',
    eyeMaterialName: 'eyes',
    presence: 'twitch',      // fast yaw micro-shudder + scurry bob
    // Rats hear / smell better than they see. Bad eyes, wide nose. Easy
    // to sneak past visually if you stay quiet, but step into the cone of
    // their hearing radius and they'll come.
    sightRange: 4,
    sightConeHalfAngle: 0.8,    // ~46° half — narrow, head-bobbing predator
    hearingRange: 3.5,
    loseSightTime: 3,
    xp: 1,
  },

  // Skirmisher — the CHARGER. No longer "fast ghoul-lite": its identity
  // is the gap-close lunge. From a few metres out it coils, then dashes
  // across the gap and slams into you — so backpedalling no longer
  // saves you the way it does against a ghoul. The verb it teaches is
  // SIDESTEP, not retreat: dodge perpendicular to the charge line, then
  // punish the recovery. At point-blank it falls back to a quick slash.
  // First user of the data-driven ability system (src/content/abilities).
  skirmisher: {
    id: 'skirmisher',
    name: 'skirmisher',
    hp: 3,
    moveSpeed: 2.0,        // player retreat (2.5) outruns the WALK...
    attackDamage: 1,
    // Legacy fields kept for audio sizing + the debug poser; the
    // abilities array below is what actually drives combat.
    attackRange: 1.5,
    strikeRange: 1.35,
    windupTime: 0.65,
    strikeTime: 0.14,
    recoverTime: 0.55,
    abilities: [
      // CHARGE — coil (windup), then a fast dash that DOES catch a
      // backpedalling player (dash speed 7.5 >> player 2.5). Cooldown
      // so it can't chain; the recovery is the punish window.
      {
        id: 'charge',
        minRange: 1.8, maxRange: 6.5,
        windup: 0.55, strike: 0.42, recover: 0.75, cooldown: 2.6,
        pose: 'charge', creep: false,
        steps: [{ trigger: { at: 0 }, action: { kind: 'dash', toward: 'player', speed: 7.5, contactReach: 1.35, damage: 1, element: 'physical' } }],
      },
      // SLASH — point-blank fallback when the player is already in melee
      // (or after a charge lands and they're still close).
      {
        id: 'slash',
        minRange: 0, maxRange: 1.7,
        windup: 0.4, strike: 0.14, recover: 0.5,
        pose: 'swing', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.5, damage: 1, element: 'physical' } }],
      },
    ],
    // Lean armed scout — a wiry humanoid with wrapped cloth + a crude blade.
    animation: SKIRMISHER_BUNDLE,   // slash = THRUST (stab), charge = LUNGE
    creature: {
      id: 'skirmisher',
      archetype: 'biped',
      proportions: { height: 1.6, girth: 0.14, armLength: 0.72, legLength: 0.66, headSize: 0.16 },
      materials: {
        flesh: { color: 0x18130d, roughness: 0.9, flatShading: 'auto' },   // Absorbed — no rim (mundane beast)
        // COOL cloth under a warm room. The sash was 0x2a201a — warm brown lit
        // by an orange torch, i.e. the floor's exact colour at the floor's exact
        // value. Albedo multiplies the light, so a cold blue-grey comes back as a
        // DESATURATED warm grey while the stone around it stays saturated: the
        // separation is in chroma, which survives one illuminant, instead of in
        // hue, which does not.
        cloth: { color: 0x1b2029, roughness: 1, flatShading: 'auto' },
        // Filthy wrappings on the off-arm — the small bright note. Same job as
        // the ghoul's ribs: a little genuinely-pale albedo the torch cannot mix
        // down into the wall.
        wrap: { color: 0xa89c86, roughness: 0.95, flatShading: 'auto' },
        blade: { color: 0x3a3e44, roughness: 0.4, metalness: 0.5, flatShading: 'auto' },
        eyes: { color: 0xffb060, emissive: 0xffb060, emissiveIntensity: 2.0 },
      },
      eyes: { material: 'eyes', emissive: 2.0 },
      flash: { material: 'flesh' },
      skin: [
        ...humanoidBipedSkin({ body: 'flesh', eye: 'eyes', limbRadius: 0.055, headRadius: 0.15, jitter: 0.01 }),
        // Cloth wraps — a chest sash + a loincloth over the pelvis.
        { kind: 'box', joint: 'spine', size: [0.42, 0.16, 0.4], pos: [0, -0.1, 0], rot: [0, 0, 0.4], mat: 'cloth' },
        { kind: 'box', joint: 'pelvis', size: [0.38, 0.3, 0.3], pos: [0, -0.06, 0], mat: 'cloth' },
        // Bandages banding the shield arm — two pale rings, so the limb has an
        // internal light/dark rhythm instead of reading as one tapered tube.
        { kind: 'cylinder', joint: 'elbowL', radius: 0.062, height: 0.09, pos: [0, 0.06, 0], mat: 'wrap' },
        { kind: 'cylinder', joint: 'handL', radius: 0.056, height: 0.07, pos: [0, 0.08, 0], mat: 'wrap' },
        // Crude blade gripped in the right fist, held FORWARD-ready (not hanging
        // straight down the arm). rot.x tilts the blade off the forearm line so
        // it reads as a WEAPON in the hand, not an extension of the limb; the
        // grip sits at the fist, blade angled out front + slightly down.
        { kind: 'box', joint: 'handR', size: [0.05, 0.6, 0.015], pos: [0.04, -0.04, -0.28], rot: [1.25, 0, 0], bevel: 0.01, mat: 'blade' },
        { kind: 'box', joint: 'handR', size: [0.14, 0.04, 0.05], pos: [0.04, 0.0, -0.04], rot: [1.25, 0, 0], mat: 'blade' },
      ],
    },
    baseEyeEmissive: 2.0,
    collisionRadius: 0.35,
    tiltPartName: 'spine',
    flashMaterialName: 'flesh',
    eyeMaterialName: 'eyes',
    presence: 'coiled',      // taut shoulder bob — reads as ready to spring
    // Skirmisher is a scout — best vision of the trash mobs. Tighter
    // cone (predator focus) and longer range. Bad hearing for sneak-up.
    sightRange: 9,
    sightConeHalfAngle: 0.9,
    hearingRange: 2.0,
    loseSightTime: 5,
    xp: 3,
  },

  // Acolyte — the KITER. Hurls a slow magic bolt AND backs away when you
  // close, holding a standoff band so you can never just walk up and
  // free-kill it. Teaches "run it down": chase it into a corner, cut it
  // off, or rush it during its windup (it can't retreat mid-cast).
  // Squishy — two hits — so the payoff for closing is quick. The verb
  // that distinguishes it from the acid-spitter (which holds ground) is
  // MOBILITY: the acolyte makes you cover ground, the spitter makes you
  // commit through chip damage.
  acolyte: {
    id: 'acolyte',
    name: 'acolyte',
    hp: 3,                  // squishy — closing on it pays off fast
    moveSpeed: 1.7,         // mobile enough to actually kite a retreating gap
    attackDamage: 1,
    attackRange: 9,         // commits to casting from far out
    strikeRange: 9,         // projectile spawns at strike regardless of range
    preferredRange: 5.5,    // backs away when the player gets nearer than this
    attackCooldown: 1.4,    // reposition window between shots — without it the
                            // kiter would just stand and shoot, never fleeing
    windupTime: 1.10,       // long, readable telegraph (orb pulses brighter)
    strikeTime: 0.15,
    recoverTime: 0.80,
    damageType: 'magic',
    // Floating robed caster — a LEGLESS ghost-archetype form: the dark robe
    // flares from the shoulders and draws down into a hovering wisp (no feet),
    // so it drifts rather than walks. Deep cowl over a shadowed face with cold
    // green eyes; a staff topped with a glowing orb in one hand, an ember
    // gathering in the other. The robe is one smooth LATHE-revolved shroud (not
    // stacked cones — the old build read as an upside-down pyramid). The orb
    // material is named 'orb' so the 'chant' presence pulses it as it channels.
    creature: {
      id: 'acolyte',
      archetype: 'ghost',
      proportions: { height: 1.7, girth: 0.2, armLength: 0.52, headSize: 0.15 },
      materials: {
        // NO RIM ON THE ROBE. It had one — green, intensity 0.4, darkReactive —
        // and it was the whole problem. A fresnel rim edges a form only if the
        // form HAS edges; the robe is a single smooth lathe, so its normals graze
        // the view across nearly the entire silhouette and the "rim" came out as
        // a solid green wash. Measured: killing every rim in the frame changed
        // 70k of 328k pixels, and the acolyte went from a green blob to a dark
        // hooded figure carrying a green light — which is the read we wanted all
        // along. Rims belong on faceted, high-frequency forms, not on revolved
        // masses. The green now lives ONLY in things that emit it.
        robe: { color: 0x15151c, roughness: 1, flatShading: 'auto' },
        // The cowl reads as its own value against the robe, so the head is a
        // shape rather than the top of one continuous cone. This is the internal
        // value break the lathe cannot give itself.
        cowl: { color: 0x0b0b11, roughness: 1, flatShading: 'auto' },
        // The hem catches light by being SMOOTH, not by being pale — a specular
        // band is a highlight the room's warm torch cannot flatten into the same
        // mid-brown as everything else, whereas raising the albedo just adds
        // another mid-value surface.
        hem: { color: 0x1d2028, roughness: 0.35, metalness: 0.35, flatShading: 'auto' },
        // Near-black shadow under the hood — the face we never quite see.
        flesh: { color: 0x0a0a09, roughness: 1, flatShading: 'auto' },
        staff: { color: 0x2a2018, roughness: 0.9, flatShading: 'auto' },
        orb: { color: 0x66ffaa, emissive: 0x66ffaa, emissiveIntensity: 2.2 },
        // Small, dimmer siblings of the orb: the charm at the collar and the
        // votives at the hem. Same hue, a third the intensity, a fraction of the
        // area — glowing PARTS on a dark body, not a glowing body.
        sigil: { color: 0x66ffaa, emissive: 0x66ffaa, emissiveIntensity: 0.9 },
        eyes: { color: 0x66ffaa, emissive: 0x66ffaa, emissiveIntensity: 2.5 },
      },
      eyes: { material: 'eyes', emissive: 2.5 },
      flash: { material: 'robe' },
      skin: [
        // The robe: one revolved profile from collar → flared body → wisp tip
        // hovering just above the floor. A flowing shroud, no hard cone seams.
        { kind: 'lathe', joint: 'spine', profile: [
            [0.075, 0.34],   // collar (under the neck)
            [0.19, 0.16],    // shoulders
            [0.24, -0.06],   // chest
            [0.30, -0.34],   // flare
            [0.31, -0.5],    // fullest
            [0.22, -0.66],   // gather
            [0.10, -0.80],   // wisp
            [0.02, -0.93],   // wisp tip (≈0.09 off the floor → it floats)
          ], jitter: 0.012, mat: 'robe' },
        // Shoulders — soft robe lumps the sleeves hang from.
        { kind: 'sphere', joint: 'shoulderL', radius: 0.1, jitter: 0.015, mat: 'robe' },
        { kind: 'sphere', joint: 'shoulderR', radius: 0.1, jitter: 0.015, mat: 'robe' },
        // Sleeved arms drifting down to the hands (ghost rig: no elbow).
        { kind: 'bone', from: 'shoulderL', to: 'handL', radius: 0.06, radiusTop: 0.045, mat: 'robe' },
        { kind: 'bone', from: 'shoulderR', to: 'handR', radius: 0.06, radiusTop: 0.045, mat: 'robe' },
        // Shadowed face + a deep cowl drawn over it (rounded, not a peak).
        { kind: 'sphere', joint: 'head', radius: 0.11, mat: 'flesh' },
        { kind: 'sphere', joint: 'head', radius: 0.145, scale: [1.0, 1.05, 1.0], pos: [0, 0.04, 0.05], mat: 'cowl' },
        { kind: 'cone', joint: 'head', radius: 0.165, height: 0.22, pos: [0, 0.12, 0.04], rot: [0.18, 0, 0], jitter: 0.02, mat: 'cowl' },
        // A smooth collar ring where cowl meets robe — the one place on this
        // body with a specular response, so the shoulders have a lit edge that
        // is not the same wash as the torso.
        { kind: 'torus', joint: 'spine', radius: 0.115, tube: 0.022, pos: [0, 0.33, 0], rot: [1.5708, 0, 0], mat: 'hem' },
        // A charm at the throat: the smallest of the three green lights.
        { kind: 'sphere', joint: 'spine', radius: 0.026, pos: [0, 0.27, -0.075], mat: 'sigil' },
        // Two votives low on the flare — they light the robe's own fabric from
        // below, so the mass reads as folds instead of a cone.
        { kind: 'sphere', joint: 'spine', radius: 0.022, pos: [-0.20, -0.42, -0.20], mat: 'sigil' },
        { kind: 'sphere', joint: 'spine', radius: 0.022, pos: [0.21, -0.46, -0.16], mat: 'sigil' },
        // Cold green eyes set deep in the cowl shadow.
        { kind: 'sphere', joint: 'head', radius: 0.032, pos: [-0.05, -0.01, -0.092], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.032, pos: [0.05, -0.01, -0.092], mat: 'eyes' },
        // Staff in the right hand — shaft standing up, glowing orb near the top
        // (≈1.66m world, matching the ranged muzzle).
        { kind: 'cylinder', joint: 'handR', radius: 0.022, height: 1.15, pos: [0.04, 0.34, -0.05], mat: 'staff' },
        { kind: 'sphere', joint: 'handR', radius: 0.08, pos: [0.04, 0.92, -0.05], mat: 'orb' },
        // An ember gathering in the open left hand — the spell, half-cast.
        { kind: 'sphere', joint: 'handL', radius: 0.045, mat: 'orb' },
      ],
    },
    baseEyeEmissive: 2.5,
    collisionRadius: 0.32,
    physicalArmor: 0,
    magicArmor: 1,
    tiltPartName: 'spine',
    flashMaterialName: 'robe',
    eyeMaterialName: 'eyes',
    presence: 'chant',       // slow side rock + orb emissive pulse
    // Best line-of-sight perception of any mob — they're casters, scanning
    // the room. Tight cone (they focus). Hearing radius small.
    sightRange: 11,
    sightConeHalfAngle: 0.95,
    hearingRange: 2.0,
    loseSightTime: 5,
    ranged: {
      // Muzzle = orb position in rig-local space (rig is at +0.85 y from
      // container origin). World-y of the orb ≈ 0.85 + 0.80 = 1.65, which
      // sits about at player chest height. Player hit-test in projectile-pool
      // is generous on Y, so this lands cleanly.
      muzzleOffset: [0.30, 1.65, -0.05],
      projectileId: 'acolyte-spit',
    },
    xp: 5,
  },

  // Antechamber boss — taller, slower, hits hard with MAGIC damage. Physical
  // armor (cloak, boots, gloves, helmet) does nothing against it. Bone amulet's
  // magic-armor passive is the soft-counter: equip it before the antechamber.
  // Drops the first fabled-rarity weapon plus other rare loot.
  wraith: {
    id: 'wraith',
    dropTable: 'miniboss',
    bloodAmount: 0.0,
    name: 'wraith',
    // MINIBOSS (task #17) — The Hollow Choir is a named ELITE set-piece, one tier
    // below an act boss: it earns the grand-encounter bar + a rest-fire on death,
    // but an amber bar (not blood-red), a MINOR-arcana fire that doesn't gate the
    // stairs, and no fog-wall seal. It lives ONLY in dedicated miniboss ARENAS
    // (vault tag 'miniboss', non-boss floors) — never in roll tables or as a
    // random room guardian (which was the old bug: a full boss bar in a pillar
    // room). Two-phase fight below makes it a real mid-run wall.
    miniboss: true,
    bossName: 'The Hollow Choir',
    hp: 1,                  // unused — phases own the HP pool now
    moveSpeed: 1.5,         // slow drift in phase 1
    attackDamage: 2,        // mirrored by per-ability damage below
    // Long ATTEMPT range so it engages with its bolts once aggroed; the
    // per-ability minRange/maxRange bands govern which tool it reaches for.
    // (SIGHT range — how early it wakes — is tuned near the bottom of the spec.)
    attackRange: 12,
    strikeRange: 2.0,
    windupTime: 0.95,       // long, readable telegraph
    strikeTime: 0.22,
    recoverTime: 0.75,
    damageType: 'magic',    // bypasses physical armor entirely
    // ── THE HOLLOW CHOIR — a two-phase spectral fight (task #18) ──────────
    // Phase 1 GATHERS: a spectral claw up close, a single probing note, and a
    // three-bolt CHORD at range — you learn to close the gap and punish the
    // cast recovery. It can still be staggered here (poise 20).
    // Phase 2 SINGS (below half): it turns UNSTUNNABLE (poise 9999 — "it sings
    // through your blows"), surges through space on a phantom lunge, wails a
    // radial dirge up close, and looses a five-voice barrage. The stagger game
    // you learned in phase 1 stops working — now it's pure spacing + dodging.
    phases: [
      {
        hp: 12,
        moveSpeed: 1.5,
        poise: 20,
        abilities: [
          // Spectral claw — the only close tool. Deflectable (a melee opener).
          {
            id: 'spectral-claw', minRange: 0, maxRange: 2.8,
            windup: 0.9, strike: 0.22, recover: 0.65, cooldown: 1.4, pose: 'swing',
            steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 2.0, damage: 2, element: 'arcane' } }],
          },
          // Single note — one homing arcane bolt, a probing voice at mid range.
          {
            id: 'single-note', minRange: 2.5, maxRange: 11,
            windup: 0.9, strike: 0.2, recover: 0.6, cooldown: 3.0, pose: 'cast',
            steps: [{ trigger: { at: 0 }, action: {
              kind: 'projectile', projectileId: 'arcane-bolt', muzzle: [0, 1.7, 0], damage: 2, toward: 'player',
            } }],
          },
          // The chord — three bolts in a fan (the choir's voices). Sidestep the
          // spread; the gaps between the three are the dodge.
          {
            id: 'chord', minRange: 3, maxRange: 12,
            windup: 1.1, strike: 0.25, recover: 0.7, cooldown: 5.0, pose: 'cast',
            steps: [{ trigger: { at: 0 }, action: {
              kind: 'projectile', projectileId: 'arcane-bolt', muzzle: [0, 1.7, 0], damage: 2,
              toward: 'player', count: 3, spreadDeg: 34,
            } }],
          },
        ],
      },
      {
        hp: 9,
        moveSpeed: 2.2,          // it quickens as it sings
        poise: 9999,             // UNSTUNNABLE — sings through your blows
        invulnEntryTime: 0.8,    // a beat of untouchable as it rises into the second voice
        abilities: [
          // Phantom lunge — surges through space at where you were. Committed;
          // sidestep the snapshot marker.
          {
            id: 'phantom-lunge', minRange: 3, maxRange: 9,
            windup: 0.8, strike: 0.5, recover: 0.9, cooldown: 5.0, pose: 'charge',
            steps: [{ trigger: { at: 0 }, action: {
              kind: 'dash', toward: 'lockedTarget', speed: 8.0, contactReach: 1.7, damage: 3, element: 'arcane',
            } }],
          },
          // The dirge — a radial wail centred on itself. Only dangerous if you're
          // hugging; step outside the ring before the note lands.
          {
            id: 'dirge', minRange: 0, maxRange: 4,
            windup: 1.1, strike: 0.2, recover: 0.9, cooldown: 6.0, pose: 'cast',
            steps: [{ trigger: { at: 0 }, action: { kind: 'aoe', origin: 'self', radius: 3.0, damage: 3, element: 'arcane' } }],
          },
          // Full chorus — five voices in a wide fan. The signature. Read the
          // spread and thread a gap, or break line of sight behind a pillar.
          {
            id: 'full-chorus', minRange: 2, maxRange: 12,
            windup: 1.2, strike: 0.3, recover: 0.8, cooldown: 6.0, pose: 'cast',
            steps: [{ trigger: { at: 0 }, action: {
              kind: 'projectile', projectileId: 'arcane-bolt', muzzle: [0, 1.7, 0], damage: 2,
              toward: 'player', count: 5, spreadDeg: 60,
            } }],
          },
        ],
      },
    ],
    // GHOST archetype — a hovering spectral form (no legs), tapering into a
    // wisp. Float + sway come from 'spectral' presence; the reach from the
    // telegraph (no clip bundle → telegraph pose stays on). Translucent teal
    // robe with a darkReactive rim so it's drawn out of the black.
    creature: {
      id: 'wraith',
      archetype: 'ghost',
      // Bigger + looming — it should fill the doorway and read as a set-piece.
      proportions: { height: 2.85, girth: 0.52, armLength: 1.25, headSize: 0.3 },
      materials: {
        robe: { color: 0x1a2a32, roughness: 1, flatShading: 'auto', transparent: true, opacity: 0.62,
          dissolvable: true, rim: { color: 0x66ffaa, power: 2.0, intensity: 0.95, darkReactive: 0.8 } },
        bone: { color: 0xaebcae, roughness: 0.8, flatShading: 'auto', transparent: true, opacity: 0.7 },
        // The hollow — the lightless cavity under the hood, where the face
        // should be. Nearly opaque so the glow reads AGAINST a true void.
        void: { color: 0x05080a, roughness: 1, flatShading: 'auto', transparent: true, opacity: 0.92 },
        eyes: { color: 0x8effc6, emissive: 0x8effc6, emissiveIntensity: 3.2 },
      },
      eyes: { material: 'eyes', emissive: 3.2 },
      flash: { material: 'robe' },
      skin: [
        // Billowing tattered shroud — one revolved profile that swells broad at
        // the shoulders and trails into a long wisp near the floor. Ragged
        // (jitter) so the edges read as torn cloth, not a clean bell.
        { kind: 'lathe', joint: 'spine', profile: [
            [0.12, 0.5],     // collar high on the chest
            [0.34, 0.25],    // broad shoulders
            [0.46, -0.05],   // billow
            [0.52, -0.4],    // fullest — it looms wide
            [0.46, -0.78],
            [0.34, -1.08],   // taper
            [0.18, -1.32],   // wisp
            [0.03, -1.55],   // trailing tip (≈0.16 off the floor)
          ], jitter: 0.06, mat: 'robe' },
        // Torn trailing tatters off the lower shroud — three ragged streamers.
        { kind: 'cone', joint: 'spine', radius: 0.08, height: 0.7, pos: [-0.22, -1.15, 0.05], rot: [Math.PI, 0, 0], jitter: 0.05, mat: 'robe' },
        { kind: 'cone', joint: 'spine', radius: 0.07, height: 0.85, pos: [0.18, -1.25, -0.08], rot: [Math.PI, 0, 0], jitter: 0.05, mat: 'robe' },
        { kind: 'cone', joint: 'spine', radius: 0.06, height: 0.6, pos: [0.05, -1.1, 0.18], rot: [Math.PI, 0, 0], jitter: 0.05, mat: 'robe' },
        // Hunched shoulders rising into a deep peaked hood (grim, overhanging).
        { kind: 'sphere', joint: 'shoulderL', radius: 0.2, jitter: 0.05, mat: 'robe' },
        { kind: 'sphere', joint: 'shoulderR', radius: 0.2, jitter: 0.05, mat: 'robe' },
        // The HOLLOW: a lightless cavity where a face should be, the hood drawn
        // forward over it so the glow stares out of pure shadow.
        { kind: 'sphere', joint: 'head', radius: 0.2, scale: [0.95, 1.05, 1.0], mat: 'void' },
        { kind: 'sphere', joint: 'head', radius: 0.235, scale: [1.0, 1.1, 1.0], pos: [0, 0.06, 0.09], jitter: 0.04, mat: 'robe' },
        { kind: 'cone', joint: 'head', radius: 0.27, height: 0.6, pos: [0, 0.26, 0.05], rot: [0.22, 0, 0], jitter: 0.05, mat: 'robe' },
        // Two hollow eye-lights + a gaping, stretched screaming maw — and a
        // pair of fainter glints deeper in the void (the "Hollow CHOIR": more
        // than one thing is looking out).
        { kind: 'sphere', joint: 'head', radius: 0.052, pos: [-0.085, 0.04, -0.16], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.052, pos: [0.085, 0.04, -0.16], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.07, scale: [0.55, 1.25, 0.5], pos: [0, -0.12, -0.14], mat: 'void' },
        { kind: 'sphere', joint: 'head', radius: 0.022, pos: [-0.04, 0.1, -0.12], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.018, pos: [0.05, 0.0, -0.13], mat: 'eyes' },
        // Long reaching spectral arms — thin bone, ending in elongated claws
        // that splay forward like it's about to take you.
        { kind: 'bone', from: 'shoulderL', to: 'handL', radius: 0.055, radiusTop: 0.04, mat: 'bone' },
        { kind: 'bone', from: 'shoulderR', to: 'handR', radius: 0.055, radiusTop: 0.04, mat: 'bone' },
        { kind: 'cone', joint: 'handL', radius: 0.03, height: 0.34, pos: [-0.05, -0.04, -0.04], rot: [2.5, 0, 0], mat: 'bone' },
        { kind: 'cone', joint: 'handL', radius: 0.03, height: 0.4, pos: [0, -0.05, -0.04], rot: [2.6, 0, 0], mat: 'bone' },
        { kind: 'cone', joint: 'handL', radius: 0.03, height: 0.34, pos: [0.05, -0.04, -0.04], rot: [2.5, 0, 0], mat: 'bone' },
        { kind: 'cone', joint: 'handR', radius: 0.03, height: 0.34, pos: [-0.05, -0.04, -0.04], rot: [2.5, 0, 0], mat: 'bone' },
        { kind: 'cone', joint: 'handR', radius: 0.03, height: 0.4, pos: [0, -0.05, -0.04], rot: [2.6, 0, 0], mat: 'bone' },
        { kind: 'cone', joint: 'handR', radius: 0.03, height: 0.34, pos: [0.05, -0.04, -0.04], rot: [2.5, 0, 0], mat: 'bone' },
      ],
    },
    baseEyeEmissive: 3.2,
    collisionRadius: 0.62,  // bigger body — fills more of the doorway
    physicalArmor: 0,       // vulnerable to physical (your sword cuts it)
    magicArmor: 2,          // but resistant to magic
    tiltPartName: 'spine',
    flashMaterialName: 'robe',
    eyeMaterialName: 'eyes',
    presence: 'spectral',       // continuous bob + sway so it never reads as a statue
    phasing: true,              // ghost — drifts through pillars/altars/chests
    // SIGHT is SHORT now (Josh: it woke from across the floor before you'd even
    // entered the arena). It only stirs once you're properly inside, in front of
    // it — then its long attack bands let the bolt "choir" reach across the room
    // once the fight is joined. Long lose-sight so it still hunts through LOS
    // breaks once awake; small hearing radius (no body to feel footsteps).
    sightRange: 5,
    sightConeHalfAngle: 0.95,   // ~54° half / 108° total — a delver in front, not one slipping the mouth
    hearingRange: 1.5,
    loseSightTime: 7,
    xp: 25,
  },

  // Ooze — slow contact-damage blob. Dies in two strikes, BUT splits
  // into two small oozes on death (see splitsInto). Kills net more
  // total HP than facing a single small mob; the math is "spend two
  // sword swings to make the problem WORSE." The teach: AoE / cone-
  // catch matters; if you can clip two small oozes in one wide arc,
  // the split is contained. If you take them one at a time after a
  // careless kill, you spend three more swings on cleanup.
  ooze: {
    id: 'ooze',
    bloodColor: 0x3a5c14,
    name: 'ooze',
    hp: 3,
    moveSpeed: 1.4,
    attackDamage: 1,
    attackRange: 1.0,
    strikeRange: 0.85,
    windupTime: 0.55,           // short — it just lurches into you
    strikeTime: 0.18,
    recoverTime: 0.45,
    damageType: 'physical',
    // First BLOB creature: a translucent jelly mound with a glowing inner core
    // (no limbs, no head). The signature squash-jiggle comes from the new
    // 'gelatinous' presence; the core brightens on windup (its tell).
    creature: {
      id: 'ooze',
      archetype: 'blob',
      proportions: { height: 0.72, girth: 0.36 },
      materials: {
        body: { color: 0x18220f, roughness: 0.4, flatShading: 'auto', transparent: true, opacity: 0.7,
          dissolvable: true, },
        core: { color: 0x88dd33, emissive: 0x88dd33, emissiveIntensity: 1.8 },
      },
      eyes: { material: 'core', emissive: 1.8 },   // the core IS the windup tell
      flash: { material: 'body' },
      skin: [
        // Squished jelly mound + irregular lobes (jitter) for a blobby surface.
        { kind: 'sphere', joint: 'core', radius: 0.36, scale: [1.1, 0.78, 1.1], jitter: 0.05, mat: 'body' },
        { kind: 'sphere', joint: 'core', radius: 0.18, pos: [0.17, -0.04, 0.1], jitter: 0.04, mat: 'body' },
        { kind: 'sphere', joint: 'core', radius: 0.15, pos: [-0.16, 0.02, -0.12], jitter: 0.04, mat: 'body' },
        // Glowing nucleus, visible through the translucent body.
        { kind: 'sphere', joint: 'core', radius: 0.13, pos: [0, -0.02, 0], mat: 'core' },
      ],
    },
    baseEyeEmissive: 1.8,       // drives the core's idle-dim → windup-bright flare
    collisionRadius: 0.32,
    tiltPartName: 'core',
    flashMaterialName: 'body',
    eyeMaterialName: 'core',    // re-use the core orb for the windup flare
    presence: 'gelatinous',     // squash-and-stretch jiggle; reads "alive jelly"
    sightRange: 5,
    sightConeHalfAngle: 1.4,    // ~80° — basically omnidirectional sensing
    hearingRange: 3.0,
    loseSightTime: 5,
    xp: 4,
    splitsInto: { enemyId: 'ooze-small', count: 2, radius: 0.5 },
  },

  // Small ooze — the offspring. Less HP, less damage, no further
  // splitting. The reward for killing a parent ooze cleanly is that
  // these two replace it; the punishment for killing it sloppily is
  // that you face them anyway.
  'ooze-small': {
    id: 'ooze-small',
    bloodColor: 0x3a5c14,
    name: 'ooze',
    hp: 2,                       // one-shot kill, like a rat
    moveSpeed: 1.6,              // slightly faster — they're "cleanup speed"
    attackDamage: 1,
    attackRange: 0.8,
    strikeRange: 0.7,
    windupTime: 0.45,
    strikeTime: 0.14,
    recoverTime: 0.40,
    damageType: 'physical',
    // Small split-child ooze — the same blob, knee-high.
    creature: {
      id: 'ooze-small',
      archetype: 'blob',
      proportions: { height: 0.4, girth: 0.2 },
      materials: {
        body: { color: 0x18220f, roughness: 0.4, flatShading: 'auto', transparent: true, opacity: 0.7,
          dissolvable: true, rim: { color: 0x88dd33, power: 2, intensity: 0.5, darkReactive: 0.5 } },
        core: { color: 0x88dd33, emissive: 0x88dd33, emissiveIntensity: 1.8 },
      },
      eyes: { material: 'core', emissive: 1.8 },
      flash: { material: 'body' },
      skin: [
        { kind: 'sphere', joint: 'core', radius: 0.2, scale: [1.1, 0.78, 1.1], jitter: 0.04, mat: 'body' },
        { kind: 'sphere', joint: 'core', radius: 0.1, pos: [0.1, -0.02, 0.06], jitter: 0.03, mat: 'body' },
        { kind: 'sphere', joint: 'core', radius: 0.08, pos: [0, -0.01, 0], mat: 'core' },
      ],
    },
    baseEyeEmissive: 1.8,
    collisionRadius: 0.20,
    // Same player-walk-through affordance as rats — the split kids
    // are knee-high and should feel like swarm cleanup, not body-
    // blockers.
    noPlayerCollision: true,
    tiltPartName: 'core',
    flashMaterialName: 'body',
    eyeMaterialName: 'core',
    presence: 'gelatinous',
    sightRange: 4,
    sightConeHalfAngle: 1.4,
    hearingRange: 2.0,
    loseSightTime: 3,
    xp: 1,
    // No splitsInto — recursion terminator.
  },

  // ── MAGGOT — the dungeon's ambient vermin. A weak, PASSIVE larval crawler:
  // it barely knows you're there (near-blind, near-deaf), does no harm (a
  // pathetic gnaw for 0), and dies to a single touch. It is atmosphere you can
  // squish — the deep is a body, and bodies have grubs. Spawned AMBIENT (never a
  // room-clear member, so it can't seal a door), NOT in the encounter packs.
  // Later (task #76): they eat nearby corpses and EVOLVE into something with a
  // bite. For now they only squirm. Drops nothing (the 'critter' table).
  maggot: {
    id: 'maggot',
    name: 'maggot',
    faction: 'vermin',      // NEUTRAL — never aggros you, never gates a room (but you can still squish it)
    bloodColor: 0xcabf7a,   // pale larval ichor — not mortal red
    bloodAmount: 0.5,
    hp: 1,                  // a squish
    poise: 1,               // no stagger resistance — anything staggers it
    moveSpeed: 0.55,        // a slow, blind crawl (player MOVE_SPEED 2.5 — trivially outpaced)
    attackDamage: 0,        // PASSIVE — a harmless gnaw; it does not threaten you
    attackRange: 0.55,
    strikeRange: 0.5,
    windupTime: 0.7,
    strikeTime: 0.14,
    recoverTime: 0.9,
    // A segmented grub on the legless 'blob' skeleton — a row of fat pale
    // ovoids low along the ground, tapering to a blunt dark-mawed head (−Z).
    creature: {
      id: 'maggot',
      archetype: 'blob',
      proportions: { height: 0.16, girth: 0.13 },
      materials: {
        // Sickly larval cream, faintly translucent + wet-rimmed.
        // RIM KEPT. Josh, on the pass that stripped it: "I think the maggots
        // were reading well ... I am not sure if rim should be the
        // differentiator between arcane and not." He is right, and the doc's
        // "rim = arcane only" is a half-conclusion it says itself is not
        // settled. A rim is LIGHT EMERGING FROM SHADOW on a creature's edge —
        // the effect this game is actually built around. What has to be
        // rationed is how MANY things carry it, not which fiction they belong
        // to. Reverted; the frequency question is being tested in the lab.
        flesh: { color: 0xcabd92, roughness: 0.5, flatShading: 'auto', transparent: true, opacity: 0.93,
          rim: { color: 0xe8dcae, power: 2.2, intensity: 0.55, darkReactive: 0.7 } },
        dark:  { color: 0x241c12, roughness: 0.85 },   // the maw
        eyes:  { color: 0x14100a, emissive: 0x000000, emissiveIntensity: 0 },  // lightless specks
      },
      eyes: { material: 'eyes', emissive: 0 },
      flash: { material: 'flesh' },
      skin: [
        // Body segments, tail (+Z) → fat middle → blunt head (−Z).
        { kind: 'sphere', joint: 'core', radius: 0.070, scale: [0.9, 0.8, 1.0],  pos: [0, 0.00, 0.115], jitter: 0.010, mat: 'flesh' },
        { kind: 'sphere', joint: 'core', radius: 0.088, scale: [0.95, 0.85, 1.0], pos: [0, 0.005, 0.045], jitter: 0.010, mat: 'flesh' },
        { kind: 'sphere', joint: 'core', radius: 0.098, scale: [1.0, 0.9, 1.0],  pos: [0, 0.010, -0.035], jitter: 0.010, mat: 'flesh' },
        { kind: 'sphere', joint: 'core', radius: 0.084, scale: [0.95, 0.85, 1.0], pos: [0, 0.005, -0.115], jitter: 0.010, mat: 'flesh' },
        { kind: 'sphere', joint: 'core', radius: 0.058, scale: [0.9, 0.85, 1.05], pos: [0, 0.00, -0.185], jitter: 0.008, mat: 'flesh' },
        // Dark maw + two tiny lightless eye specks at the head end.
        { kind: 'sphere', joint: 'core', radius: 0.017, pos: [0, -0.012, -0.225], mat: 'dark' },
        { kind: 'sphere', joint: 'core', radius: 0.010, pos: [-0.028, 0.016, -0.205], mat: 'eyes' },
        { kind: 'sphere', joint: 'core', radius: 0.010, pos: [0.028, 0.016, -0.205], mat: 'eyes' },
      ],
    },
    baseEyeEmissive: 0,
    collisionRadius: 0.13,
    // Player walks straight over grubs — being bodyblocked by a maggot is absurd.
    noPlayerCollision: true,
    tiltPartName: 'core',
    flashMaterialName: 'flesh',
    eyeMaterialName: 'eyes',
    presence: 'gelatinous',    // soft, boneless squirm
    // Near-blind, near-deaf — it only stirs toward you point-blank, and forgets
    // you the moment you step off. This is what makes it read as PASSIVE.
    sightRange: 2.2,
    sightConeHalfAngle: 1.5,
    hearingRange: 1.3,
    loseSightTime: 1.5,
    dropTable: 'critter',      // ambient life — squishing it yields nothing
    xp: 1,
  },

  // Acid spitter — the HOLDER. The deliberate foil to the acolyte: where
  // the acolyte runs from you, the spitter plants and refuses to move,
  // lobbing acid on a fast cadence so the longer you stay at range the
  // more chip you eat. It does NOT kite (no preferredRange) — closing on
  // it WORKS, that's the lesson, but it's tanky (4 HP) and its acid
  // bypasses armour, so "commit and burst it down before the chip adds
  // up" is the verb. Pack glue: a spitter behind a melee line punishes
  // turtling — you can't out-wait it, you have to push.
  //
  // No splitting on death — a ranged splitter would be a "back-line
  // cleared → back-line refilled" trap that punishes correct kill order.
  'acid-spitter': {
    id: 'acid-spitter',
    dropTable: 'enemy-elite',
    bloodColor: 0x4a6e1a,
    name: 'acid spitter',
    hp: 7,                       // tanky — closing on it is a real commitment
    moveSpeed: 0.8,              // glacial — it holds ground, doesn't chase
    attackDamage: 1,
    attackRange: 7,              // ranged commit distance; no preferredRange (holds)
    strikeRange: 7,
    windupTime: 0.85,            // faster cadence than the acolyte — chip pressure
    strikeTime: 0.15,
    recoverTime: 0.55,           // short recovery → it shoots OFTEN
    damageType: 'magic',         // acid bypasses physical armour
    // Blue blob, bright cyan core — a different chemistry than the green ooze.
    // The core pulses hard as the spit windup tell.
    creature: {
      id: 'acid-spitter',
      archetype: 'blob',
      proportions: { height: 0.72, girth: 0.36 },
      materials: {
        body: { color: 0x141a26, roughness: 0.4, flatShading: 'auto', transparent: true, opacity: 0.7,
          dissolvable: true, rim: { color: 0x66ccff, power: 2, intensity: 0.55, darkReactive: 0.5 } },
        core: { color: 0x66ccff, emissive: 0x66ccff, emissiveIntensity: 2.6 },
      },
      eyes: { material: 'core', emissive: 2.6 },
      flash: { material: 'body' },
      skin: [
        { kind: 'sphere', joint: 'core', radius: 0.36, scale: [1.1, 0.8, 1.1], jitter: 0.05, mat: 'body' },
        { kind: 'sphere', joint: 'core', radius: 0.18, pos: [0.16, -0.04, 0.1], jitter: 0.04, mat: 'body' },
        { kind: 'sphere', joint: 'core', radius: 0.15, pos: [-0.15, 0.02, -0.12], jitter: 0.04, mat: 'body' },
        { kind: 'sphere', joint: 'core', radius: 0.14, pos: [0, 0.02, 0], mat: 'core' },
      ],
    },
    baseEyeEmissive: 2.6,        // the core is the windup tell — pulses hard
    collisionRadius: 0.34,
    physicalArmor: 0,
    magicArmor: 0,
    tiltPartName: 'core',
    flashMaterialName: 'body',
    eyeMaterialName: 'core',     // re-use the core orb for the windup flare
    presence: 'gelatinous',      // jelly squash — same species as the green ooze
    sightRange: 9,               // sees well — caster-class perception
    sightConeHalfAngle: 1.3,
    hearingRange: 2.5,
    loseSightTime: 5,
    ranged: {
      // Muzzle at the core orb's height — visually the spit
      // emerges from the bright cyan ball at the centre of the
      // blob, which sells the "this orb is the thing shooting."
      // y ≈ rig (0.19) + body offset (0) = ~0.19m; bump up to 0.30
      // so the projectile clears the body silhouette on launch.
      muzzleOffset: [0, 0.30, 0],
      projectileId: 'acid-spit',
    },
    xp: 6,
  },

  // Stoneguard — slow, armoured, hits like a truck. Changes combat
  // rhythm: the fast mobs taught you to flail; this one teaches you to
  // time the dodge. The huge windup is escapable on sight, but the
  // recovery is short enough that you can't punish endlessly — you
  // get ONE strike per cycle, two if you read it perfectly. Physical
  // armor 2 means trash-tier weapons take a few hits to chew through.
  stoneguard: {
    id: 'stoneguard',
    dropTable: 'enemy-elite',
    bloodColor: 0x6e6a62,
    bloodAmount: 0.35,
    name: 'stoneguard',
    hp: 22,                      // tankiest non-boss — bumped so it SURVIVES long
                                 //   enough for sustained heavy hits to break its
                                 //   guard (poise) before it dies; staggering it is
                                 //   the intended way in (then the core opens).
    poise: 8,                    // explicit (< hp): ~2 CHARGED hammer hits crack it
                                 //   open while standing (light weapons barely dent
                                 //   it — that's the heavy-weapon identity).
    moveSpeed: 1.0,              // glacial — player retreat (2.5) outruns easily
    attackDamage: 3,             // biggest single-hit damage in the roster
    attackRange: 1.9,            // long reach (maul + heavy frame)
    strikeRange: 1.65,           // big gap → big punish for misreading the windup
    windupTime: 1.40,            // the giveaway tell — slow overhead heave
    strikeTime: 0.22,
    recoverTime: 1.00,           // long recovery — missed swings are exploitable
    damageType: 'physical',
    // FIRST creature-system enemy (docs/CREATURE-SYSTEM.md): a biped skeleton,
    // stone skin hung on joints, dimensions + per-bone hitzones MEASURED at
    // build. The molten-core weak point (opens on stagger) lives as a creature
    // zone, following the spine.
    animation: STONEGUARD_BUNDLE,   // strike = POUND (two-hand ground slam)
    creature: {
      id: 'stoneguard',
      archetype: 'biped',
      // Slight hunch: a caryatid still braced under a load that's gone. Kills
      // the toy-robot uprightness (bolt-upright is the SKELETON's gesture).
      proportions: { height: 1.95, girth: 0.36, armLength: 0.86, hunch: 0.1 },
      materials: {
        stone: { color: 0xa8a49c, roughness: 1, flatShading: 'auto' },
        dark: { color: 0x222019, roughness: 1, flatShading: 'auto' },   // recesses / chips / joints
        // The molten core, glimpsed through the chest fissure at rest — barely
        // an ember (the stagger-opened core zone is the real reveal). Not a rim,
        // not a glow: a crack of heat in an ABSORBED body, kin to its eyes.
        ember: { color: 0x1a0c08, emissive: 0xff4020, emissiveIntensity: 0.55 },
        eyes: { color: 0xff5530, emissive: 0xff5530, emissiveIntensity: 1.4 },
      },
      eyes: { material: 'eyes', emissive: 1.4 },
      flash: { material: 'stone' },
      zones: [
        { id: 'core', shape: { kind: 'sphere', center: [0, 0, -0.26], radius: 0.3 },
          role: 'weak', damageMul: 1.4, openWhenStaggered: true, follow: 'spine' },
      ],
      // BROKEN CARYATID — a temple guardian torn from its architrave. Nothing
      // about it is manufactured-symmetric: the chest blocks sit a few degrees
      // out of true (stacked masonry, not a torso), one shoulder still carries
      // the broken CAPITAL it once held up, the other is chipped to a stub, the
      // right arm is the great smashing arm, the left ends in a broken stump.
      // Dark inset blocks read as missing bites in silhouette; the ember
      // fissure across the chest promises what the stagger opens.
      skin: [
        // Torso — two masonry courses, each rotated slightly off true so the
        // stack reads BROKEN, not built. Bevels catch the torchlight.
        { kind: 'box', joint: 'spine', size: [0.84, 0.58, 0.56], pos: [0, 0.20, 0], rot: [0, 0.06, 0.03], bevel: 0.05, mat: 'stone' },
        { kind: 'box', joint: 'spine', size: [0.78, 0.46, 0.52], pos: [0.03, -0.28, 0], rot: [0, -0.05, -0.04], bevel: 0.05, mat: 'stone' },
        // Missing bite — a dark block sunk into the upper-right chest corner.
        { kind: 'box', joint: 'spine', size: [0.26, 0.22, 0.3], pos: [0.34, 0.38, -0.14], rot: [0.3, 0.4, 0.2], mat: 'dark' },
        // Chest fissure — a jagged crack, not a line: three short ember shards
        // staggered along the diagonal, each at its own angle, sunk in a dark
        // gash. Reads as heat escaping the masonry, not paint on it.
        { kind: 'box', joint: 'spine', size: [0.08, 0.34, 0.05], pos: [-0.05, -0.08, -0.27], rot: [0, 0, 0.38], mat: 'dark' },
        { kind: 'box', joint: 'spine', size: [0.07, 0.3, 0.05], pos: [-0.14, -0.36, -0.27], rot: [0, 0, 0.6], mat: 'dark' },
        { kind: 'box', joint: 'spine', size: [0.03, 0.2, 0.05], pos: [-0.03, -0.04, -0.278], rot: [0, 0, 0.35], mat: 'ember' },
        { kind: 'box', joint: 'spine', size: [0.025, 0.14, 0.05], pos: [-0.09, -0.24, -0.278], rot: [0, 0, 0.55], mat: 'ember' },
        { kind: 'box', joint: 'spine', size: [0.03, 0.16, 0.05], pos: [-0.17, -0.42, -0.278], rot: [0, 0, 0.62], mat: 'ember' },
        // Pelvis course + hanging carved apron slab (two dark grooves = fluting).
        { kind: 'box', joint: 'pelvis', size: [0.7, 0.44, 0.5], rot: [0, 0.04, 0], bevel: 0.04, mat: 'stone' },
        { kind: 'box', joint: 'pelvis', size: [0.4, 0.5, 0.12], pos: [0, -0.3, -0.2], bevel: 0.03, mat: 'stone' },
        { kind: 'box', joint: 'pelvis', size: [0.05, 0.44, 0.04], pos: [-0.09, -0.3, -0.265], mat: 'dark' },
        { kind: 'box', joint: 'pelvis', size: [0.05, 0.44, 0.04], pos: [0.1, -0.3, -0.265], mat: 'dark' },
        // Head — a weathered stele SUNK between the shoulders (no neck gap), a
        // heavy brow ledge overhanging so the eyes burn out of real shadow.
        { kind: 'box', joint: 'head', size: [0.4, 0.5, 0.44], pos: [0, -0.1, 0.02], rot: [0, -0.07, 0], bevel: 0.06, mat: 'stone' },
        { kind: 'box', joint: 'head', size: [0.44, 0.12, 0.5], pos: [0, 0.08, 0], rot: [0.08, -0.07, 0], bevel: 0.04, mat: 'stone' },  // brow ledge
        { kind: 'box', joint: 'head', size: [0.36, 0.1, 0.08], pos: [0, -0.02, -0.2], mat: 'dark' },  // eye shadow recess
        { kind: 'sphere', joint: 'head', radius: 0.05, pos: [-0.11, -0.02, -0.23], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.05, pos: [0.11, -0.02, -0.23], mat: 'eyes' },
        // Left shoulder — still carrying its broken CAPITAL: an impost block
        // with a lip, tilted, too big for the body. The load is gone; it isn't.
        { kind: 'box', joint: 'shoulderL', size: [0.5, 0.3, 0.52], pos: [-0.06, 0.14, 0], rot: [0, 0.1, 0.12], bevel: 0.04, mat: 'stone' },
        { kind: 'box', joint: 'shoulderL', size: [0.58, 0.12, 0.6], pos: [-0.08, 0.3, 0], rot: [0, 0.1, 0.1], bevel: 0.03, mat: 'stone' },
        // Right shoulder — chipped to a stub, one dark bite out of the corner.
        { kind: 'box', joint: 'shoulderR', size: [0.32, 0.26, 0.38], rot: [0, 0, -0.24], bevel: 0.05, mat: 'stone' },
        { kind: 'box', joint: 'shoulderR', size: [0.18, 0.16, 0.2], pos: [0.12, 0.12, 0.1], rot: [0.5, 0.3, 0.4], mat: 'dark' },
        // Arms — RIGHT is the smashing arm (thick, ends in a column-drum fist);
        // LEFT is wasted and ends in a broken stump. Dark elbow joints stay.
        { kind: 'bone', from: 'shoulderR', to: 'elbowR', radius: 0.15, mat: 'stone' },
        { kind: 'bone', from: 'elbowR', to: 'handR', radius: 0.13, mat: 'stone' },
        { kind: 'bone', from: 'shoulderL', to: 'elbowL', radius: 0.10, mat: 'stone' },
        { kind: 'bone', from: 'elbowL', to: 'handL', radius: 0.085, mat: 'stone' },
        { kind: 'sphere', joint: 'elbowL', radius: 0.10, mat: 'dark' },
        { kind: 'sphere', joint: 'elbowR', radius: 0.14, mat: 'dark' },
        // Right fist — a squared column drum, the maul it never needed.
        { kind: 'cylinder', joint: 'handR', radius: 0.17, height: 0.3, rot: [0.35, 0, 0], mat: 'stone' },
        { kind: 'box', joint: 'handR', size: [0.1, 0.1, 0.12], pos: [0.1, -0.12, -0.06], rot: [0.4, 0.6, 0.2], mat: 'dark' },
        // Left hand — a broken stump: short box + dark fracture face.
        { kind: 'box', joint: 'handL', size: [0.15, 0.16, 0.15], bevel: 0.03, mat: 'stone' },
        { kind: 'box', joint: 'handL', size: [0.12, 0.12, 0.06], pos: [0, -0.06, -0.06], rot: [0.3, 0.2, 0.5], mat: 'dark' },
        // Legs — asymmetric: LEFT keeps its carved greave + knee guard, RIGHT
        // is bare with a chipped knee. Feet are cracked plinth blocks.
        { kind: 'bone', from: 'hipL', to: 'kneeL', radius: 0.15, mat: 'stone' },
        { kind: 'bone', from: 'kneeL', to: 'footL', radius: 0.13, mat: 'stone' },
        { kind: 'bone', from: 'hipR', to: 'kneeR', radius: 0.14, mat: 'stone' },
        { kind: 'bone', from: 'kneeR', to: 'footR', radius: 0.115, mat: 'stone' },
        { kind: 'box', joint: 'kneeL', size: [0.26, 0.22, 0.26], rot: [0, 0.08, 0], bevel: 0.04, mat: 'stone' },
        { kind: 'box', joint: 'kneeL', size: [0.2, 0.34, 0.1], pos: [0, -0.16, -0.1], bevel: 0.03, mat: 'stone' },  // greave slab
        { kind: 'box', joint: 'kneeR', size: [0.14, 0.12, 0.14], pos: [0.04, 0.02, -0.04], rot: [0.4, 0.3, 0.3], mat: 'dark' },  // chipped knee
        { kind: 'box', joint: 'footL', size: [0.28, 0.14, 0.42], pos: [0, 0.07, -0.06], rot: [0, 0.05, 0], bevel: 0.03, mat: 'stone' },
        { kind: 'box', joint: 'footR', size: [0.26, 0.14, 0.4], pos: [0, 0.07, -0.06], rot: [0, -0.04, 0], bevel: 0.03, mat: 'stone' },
        { kind: 'box', joint: 'footR', size: [0.12, 0.1, 0.1], pos: [0.08, 0.05, -0.22], rot: [0.2, 0.5, 0.2], mat: 'dark' },  // cracked toe
      ],
    },
    baseEyeEmissive: 1.2,
    collisionRadius: 0.55,       // wider footprint — harder to slip around
    physicalArmor: 2,            // the defining stat — chips through trash weapons
    magicArmor: 0,
    tiltPartName: 'spine',
    flashMaterialName: 'stone',
    eyeMaterialName: 'eyes',
    presence: 'lurch',           // shambling weight-shift; reads heavy
    // Sees and hears poorly — slow, lumbering. Easy to sneak past if
    // you commit to it. Once aggro'd, sticks for a long time.
    sightRange: 6,
    sightConeHalfAngle: 0.95,    // ~55° half / 110° — narrower than ghoul
    hearingRange: 3.0,           // can feel footfalls through the floor
    loseSightTime: 6,
    xp: 12,
  },

  // Defiler — the ZONE controller. The one enemy that teaches "don't
  // stand there." It calls a crushing hex down onto the ground where
  // you're standing: a ring marks the floor through a long readable
  // windup, and if you're still inside it when the hex lands you eat a
  // heavy magic hit. The whole fight is footwork — keep moving, never
  // root yourself, punish it in the recovery after a hex resolves. A
  // weak slash covers point-blank so you can't just hug it safely.
  //
  // Magic damage (the hex ignores physical armour) so plate doesn't
  // trivialise it — the answer is positioning, not mitigation. First
  // user of the `aoe` ability effect.
  //
  // NOTE: reuses the ghoul silhouette recoloured violet for now; a
  // distinct hexer model is pending the parametric-creature pass.
  defiler: {
    id: 'defiler',
    dropTable: 'enemy-elite',
    name: 'defiler',
    hp: 7,
    moveSpeed: 1.1,              // slow drifter — it controls space, doesn't chase
    attackDamage: 2,            // legacy/default mirror of the hex damage
    attackRange: 7,
    strikeRange: 1.5,
    windupTime: 1.15,
    strikeTime: 0.25,
    recoverTime: 0.9,
    damageType: 'magic',
    abilities: [
      // HEX — telegraphed ground AoE at the player's feet. Long windup
      // (1.15s) + radius 1.9 = clearly dodgeable by walking off the
      // marker; cooldown 2.8 spaces the hexes so footwork has rhythm.
      {
        id: 'hex',
        minRange: 1.8, maxRange: 7,
        windup: 1.15, strike: 0.25, recover: 0.9, cooldown: 2.8,
        pose: 'cast',
        steps: [{ trigger: { at: 0 }, action: { kind: 'aoe', origin: 'lockedTarget', radius: 1.7, damage: 2, element: 'arcane' } }],
      },
      // SLASH — point-blank deterrent so hugging it isn't a free safe spot.
      {
        id: 'slash',
        minRange: 0, maxRange: 1.7,
        windup: 0.55, strike: 0.16, recover: 0.6,
        pose: 'swing', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.5, damage: 1, element: 'arcane' } }],
      },
    ],
    // Own silhouette via the parametric builder: tall, gaunt, stooped,
    // long reaching arms (it pulls the hex down), violet with a sickly
    // rim. Distinct from the bulky ghoul + lean skirmisher. Inherits
    // the full rig (arm-swing, gait, head-crane) for free.
    // Tall, gaunt, stooped violet hex-caster — long reaching arms, a draped
    // robe, sickly violet rim. Pulls the hex down from above.
    animation: DEFILER_BUNDLE,   // slash = SWEEP (wide claw), hex = CAST
    creature: {
      id: 'defiler',
      archetype: 'biped',
      proportions: { height: 1.78, girth: 0.13, armLength: 0.92, legLength: 0.74, headSize: 0.18, hunch: 0.22 },
      materials: {
        flesh: { color: 0x281830, roughness: 1, flatShading: 'auto', rim: { color: 0x7a4ac0, power: 3, intensity: 0.7, darkReactive: 0.6 } },
        robe: { color: 0x1a1024, roughness: 1, flatShading: 'auto' },
        eyes: { color: 0xbb55ff, emissive: 0xbb55ff, emissiveIntensity: 2.6 },
      },
      eyes: { material: 'eyes', emissive: 2.6 },
      flash: { material: 'flesh' },
      skin: [
        ...humanoidBipedSkin({ body: 'flesh', eye: 'eyes', limbRadius: 0.045, bodyRadius: 0.15, headRadius: 0.17, jitter: 0.02 }),
        // Robe drape — a wide cone skirt from the chest tapering to the floor.
        { kind: 'cone', joint: 'spine', radius: 0.34, height: 1.4, pos: [0, -0.72, 0], rot: [Math.PI, 0, 0], jitter: 0.03, mat: 'robe' },
        { kind: 'sphere', joint: 'head', radius: 0.2, scale: [1, 1.05, 1], pos: [0, 0.04, 0.04], jitter: 0.03, mat: 'robe' },  // hood lump
      ],
    },
    baseEyeEmissive: 2.6,
    collisionRadius: 0.42,
    physicalArmor: 0,
    magicArmor: 1,
    tiltPartName: 'spine',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'chant',           // ritual side-rock; sells "calling something down"
    sightRange: 9,
    sightConeHalfAngle: 1.0,
    hearingRange: 2.5,
    loseSightTime: 5,
    xp: 10,
  },

  // Skeleton — the PRESSURE enemy: dangerous at every range. It hurls
  // bone shards while it advances, then slashes once it's on you. Where
  // the acolyte flees and the acid-spitter plants, the skeleton just
  // keeps coming AND keeps throwing, so backing off doesn't buy safety —
  // the answer is to close and break it fast (it's brittle: 3 HP).
  // Built entirely from creature() + two abilities — no new mechanics;
  // a showcase of both systems (first mob with a ranged AND a melee
  // ability it uses by range).
  skeleton: {
    id: 'skeleton',
    bloodColor: 0x8a8274,
    bloodAmount: 0.3,
    severable: ['head', 'shoulderL', 'shoulderR', 'hipL', 'hipR'],   // strike off the skull or a limb
    deathStyle: 'crumble', // clatters apart into bone debris, not a flesh topple
    name: 'skeleton',
    hp: 4,
    moveSpeed: 1.5,            // advances steadily (no kite, no preferredRange)
    attackDamage: 1,
    // Legacy mirrors for audio/debug; the abilities drive combat.
    attackRange: 1.7,
    strikeRange: 1.5,
    windupTime: 0.55,
    strikeTime: 0.15,
    recoverTime: 0.45,
    damageType: 'physical',
    abilities: [
      // BONE THROW — ranged poke from mid distance while closing. Cooldown
      // so it's a periodic shard, not a stream; minRange keeps it from
      // throwing point-blank (it slashes there instead).
      {
        id: 'bone-throw',
        minRange: 2.4, maxRange: 8,
        windup: 0.6, strike: 0.15, recover: 0.5, cooldown: 2.0,
        // 'swing', not 'cast' — a big overhand HURL (arm winds back, then
        // throws) so the skeleton visibly throws the shard rather than a
        // limp two-hand caster push.
        pose: 'swing',
        steps: [{ trigger: { at: 0 }, action: { kind: 'projectile', projectileId: 'bone-shard', muzzle: [0.28, 1.35, -0.1], damage: 1 } }],
      },
      // SLASH — the close-range bite once it reaches you.
      {
        id: 'slash',
        minRange: 0, maxRange: 1.7,
        windup: 0.5, strike: 0.15, recover: 0.45,
        pose: 'swing', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.5, damage: 1, element: 'physical' } }],
      },
    ],
    // A TRUE skeleton, not a clay mannequin: a skull with a hinged jaw and
    // sunken blue eye-lights, a visible spinal column, a barrel ribcage of
    // descending hoops, a pelvic girdle, and thin limb bones with knobbed
    // joints. The gaps between the bones ARE the silhouette — nothing solid.
    // It inherits the full biped rig (arms gesture the throw + slash, it
    // strides in, the skull cranes at you).
    animation: SKELETON_BUNDLE,   // slash = CHOP (overhead), bone-throw = CAST
    creature: {
      id: 'skeleton',
      archetype: 'biped',
      // Gaunt: thin girth so the ribcage doesn't read as a barrel chest. TALL +
      // bolt-upright (hunch 0, long legs) so its silhouette reads distinct from
      // the SHORT, HUNCHED ghoul — a looming skeletal sentinel, not a stooped
      // ghoul.
      proportions: { height: 1.72, girth: 0.1, armLength: 0.72, legLength: 0.72, headSize: 0.13, hunch: 0 },
      materials: {
        // PAINTED mode — pale, matte, NO self-light (no rim, emissive 0). The
        // bone makes no light of its own; the ROOM's coloured torchlight paints
        // it, amplified (chroma) so a blood-lit hall drenches it red. The white
        // hand-lamp washes the tint back to bone. Eyes stay the only self-glow.
        bone: { color: 0xc2b69c, roughness: 0.92, flatShading: 'auto', chroma: 1.8 },
        socket: { color: 0x080a0c, roughness: 1, flatShading: 'auto' },
        eyes: { color: 0x9fd8ff, emissive: 0x9fd8ff, emissiveIntensity: 2.4 },
      },
      eyes: { material: 'eyes', emissive: 2.4 },
      flash: { material: 'bone' },
      skin: [
        // ── Spinal column: lumbar → chest → neck → skull, a stack of bones
        //    running up the centre. The ribcage hangs off it. ─────────────
        { kind: 'bone', from: 'pelvis', to: 'spine', radius: 0.024, mat: 'bone' },
        { kind: 'bone', from: 'spine', to: 'neck', radius: 0.022, mat: 'bone' },
        { kind: 'bone', from: 'neck', to: 'head', radius: 0.024, mat: 'bone' },
        // ── Ribcage: four hoops descending + narrowing (widest at the top,
        //    floating ribs at the bottom). Flattened front-back so it reads
        //    as a chest cavity, not a tube. Plus a thin sternum down the front.
        { kind: 'torus', joint: 'spine', radius: 0.108, tube: 0.013, pos: [0, 0.06, -0.005], rot: [1.5708, 0, 0], scale: [1, 0.8, 1], mat: 'bone' },
        { kind: 'torus', joint: 'spine', radius: 0.1, tube: 0.013, pos: [0, -0.02, -0.005], rot: [1.5708, 0, 0], scale: [1, 0.8, 1], mat: 'bone' },
        { kind: 'torus', joint: 'spine', radius: 0.086, tube: 0.012, pos: [0, -0.1, -0.005], rot: [1.5708, 0, 0], scale: [1, 0.8, 1], mat: 'bone' },
        { kind: 'torus', joint: 'spine', radius: 0.07, tube: 0.011, pos: [0, -0.18, -0.005], rot: [1.5708, 0, 0], scale: [1, 0.8, 1], mat: 'bone' },
        { kind: 'cylinder', joint: 'spine', radius: 0.011, height: 0.24, pos: [0, -0.05, -0.082], mat: 'bone' },
        // ── Shoulder girdle: scapula knobs + collarbones out to each shoulder.
        { kind: 'sphere', joint: 'shoulderL', radius: 0.04, mat: 'bone' },
        { kind: 'sphere', joint: 'shoulderR', radius: 0.04, mat: 'bone' },
        { kind: 'bone', from: 'neck', to: 'shoulderL', radius: 0.014, mat: 'bone' },
        { kind: 'bone', from: 'neck', to: 'shoulderR', radius: 0.014, mat: 'bone' },
        // ── Arms: humerus + forearm, knobbed elbows, skeletal claw-hands. ──
        { kind: 'bone', from: 'shoulderL', to: 'elbowL', radius: 0.023, mat: 'bone' },
        { kind: 'bone', from: 'elbowL', to: 'handL', radius: 0.019, mat: 'bone' },
        { kind: 'bone', from: 'shoulderR', to: 'elbowR', radius: 0.023, mat: 'bone' },
        { kind: 'bone', from: 'elbowR', to: 'handR', radius: 0.019, mat: 'bone' },
        { kind: 'sphere', joint: 'elbowL', radius: 0.027, mat: 'bone' },
        { kind: 'sphere', joint: 'elbowR', radius: 0.027, mat: 'bone' },
        // Bony fingers — three thin phalanges per hand, curled down/forward.
        { kind: 'sphere', joint: 'handL', radius: 0.022, mat: 'bone' },
        { kind: 'cone', joint: 'handL', radius: 0.011, height: 0.075, pos: [-0.025, -0.04, 0], rot: [2.7, 0, 0], mat: 'bone' },
        { kind: 'cone', joint: 'handL', radius: 0.011, height: 0.085, pos: [0, -0.045, 0], rot: [2.85, 0, 0], mat: 'bone' },
        { kind: 'cone', joint: 'handL', radius: 0.011, height: 0.075, pos: [0.025, -0.04, 0], rot: [2.7, 0, 0], mat: 'bone' },
        { kind: 'sphere', joint: 'handR', radius: 0.022, mat: 'bone' },
        { kind: 'cone', joint: 'handR', radius: 0.011, height: 0.075, pos: [-0.025, -0.04, 0], rot: [2.7, 0, 0], mat: 'bone' },
        { kind: 'cone', joint: 'handR', radius: 0.011, height: 0.085, pos: [0, -0.045, 0], rot: [2.85, 0, 0], mat: 'bone' },
        { kind: 'cone', joint: 'handR', radius: 0.011, height: 0.075, pos: [0.025, -0.04, 0], rot: [2.7, 0, 0], mat: 'bone' },
        // ── Pelvis: an open girdle ring instead of a solid block. ──────────
        { kind: 'torus', joint: 'pelvis', radius: 0.082, tube: 0.022, rot: [1.5708, 0, 0], scale: [1, 0.78, 1], mat: 'bone' },
        { kind: 'sphere', joint: 'hipL', radius: 0.036, mat: 'bone' },
        { kind: 'sphere', joint: 'hipR', radius: 0.036, mat: 'bone' },
        // ── Legs: femur + tibia, knobbed knees, flat splayed bone-feet. ────
        { kind: 'bone', from: 'hipL', to: 'kneeL', radius: 0.029, mat: 'bone' },
        { kind: 'bone', from: 'kneeL', to: 'footL', radius: 0.025, mat: 'bone' },
        { kind: 'bone', from: 'hipR', to: 'kneeR', radius: 0.029, mat: 'bone' },
        { kind: 'bone', from: 'kneeR', to: 'footR', radius: 0.025, mat: 'bone' },
        { kind: 'sphere', joint: 'kneeL', radius: 0.031, mat: 'bone' },
        { kind: 'sphere', joint: 'kneeR', radius: 0.031, mat: 'bone' },
        { kind: 'box', joint: 'footL', size: [0.06, 0.035, 0.17], pos: [0, 0.02, -0.045], mat: 'bone' },
        { kind: 'box', joint: 'footR', size: [0.06, 0.035, 0.17], pos: [0, 0.02, -0.045], mat: 'bone' },
        // ── Skull: CSG-carved. The old skull was a sphere with black balls
        //    painted on and the eye-lights set PROUD of them — googly. Real
        //    sockets are SUBTRACTED craters whose rims catch the room's light
        //    (this is where the PAINTED bone material earns the carve), with
        //    the glints recessed INSIDE — eyes burning out of holes, not
        //    stickers. Crisp, no jitter: bone is the hard thing here.
        {
          kind: 'csg', op: 'subtract', joint: 'head', mat: 'bone',
          a: {
            kind: 'csg', op: 'subtract', mat: 'bone',
            // Elongated cranium, flattened at the sides.
            a: { kind: 'sphere', radius: 0.115, scale: [0.86, 1.02, 1.14], segments: [24, 18], mat: 'bone' },
            // Left socket crater.
            b: { kind: 'sphere', radius: 0.042, pos: [-0.048, 0.02, -0.1], segments: [18, 14], mat: 'bone' },
          },
          // Right socket crater.
          b: { kind: 'sphere', radius: 0.042, pos: [0.048, 0.02, -0.1], segments: [18, 14], mat: 'bone' },
        },
        // Darkness pooled in the carved pits; the glints sit deeper than the
        // skull's front face so they read as coming from inside.
        { kind: 'sphere', joint: 'head', radius: 0.034, pos: [-0.048, 0.02, -0.09], mat: 'socket' },
        { kind: 'sphere', joint: 'head', radius: 0.034, pos: [0.048, 0.02, -0.09], mat: 'socket' },
        { kind: 'sphere', joint: 'head', radius: 0.016, pos: [-0.048, 0.02, -0.112], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.016, pos: [0.048, 0.02, -0.112], mat: 'eyes' },
        // Nasal aperture — a narrow dark wedge, wider at the base.
        { kind: 'box', joint: 'head', size: [0.026, 0.05, 0.02], pos: [0, -0.038, -0.121], rot: [0.1, 0, 0], mat: 'socket' },
        // Cheekbone knots under the sockets — the zygomatic shadow line.
        { kind: 'sphere', joint: 'head', radius: 0.022, pos: [-0.077, -0.022, -0.075], mat: 'bone' },
        { kind: 'sphere', joint: 'head', radius: 0.022, pos: [0.077, -0.022, -0.075], mat: 'bone' },
        // Upper teeth ridge with a dark seam under it.
        { kind: 'box', joint: 'head', size: [0.088, 0.024, 0.05], pos: [0, -0.075, -0.085], mat: 'bone' },
        { kind: 'box', joint: 'head', size: [0.084, 0.008, 0.048], pos: [0, -0.089, -0.086], mat: 'socket' },
        // Mandible — hangs open and a few degrees OFF TRUE (nothing living
        // holds a jaw like that): chin bar + two rami running back and up.
        { kind: 'box', joint: 'head', size: [0.084, 0.03, 0.05], pos: [0.006, -0.125, -0.08], rot: [0.22, 0.08, 0.03], mat: 'bone' },
        { kind: 'box', joint: 'head', size: [0.02, 0.028, 0.1], pos: [-0.045, -0.115, -0.03], rot: [0.34, 0.08, 0], mat: 'bone' },
        { kind: 'box', joint: 'head', size: [0.02, 0.028, 0.1], pos: [0.055, -0.112, -0.03], rot: [0.3, 0.12, 0], mat: 'bone' },
      ],
    },
    baseEyeEmissive: 2.4,
    collisionRadius: 0.34,
    physicalArmor: 0,
    magicArmor: 0,
    tiltPartName: 'spine',
    flashMaterialName: 'bone',
    eyeMaterialName: 'eyes',
    presence: 'lurch',         // bony shamble
    sightRange: 8,
    sightConeHalfAngle: 1.0,
    hearingRange: 2.5,
    loseSightTime: 5,
    xp: 7,
  },

  // Spider — fast, fragile POUNCER that comes in packs. Scuttles in,
  // coils, then leaps the gap with a lunge-bite (the dash ability, like
  // the skirmisher's charge — but spiders are a SWARM of them: low HP,
  // faster, several at once). Verb: read the pounce + sidestep it, and
  // don't get surrounded. The nest mob; lives in web rooms.
  spider: {
    id: 'spider',
    bloodColor: 0x4e5a16,
    name: 'spider',
    hp: 3,
    moveSpeed: 2.2,            // fast scuttle
    attackDamage: 1,
    attackRange: 1.5,
    strikeRange: 1.3,
    windupTime: 0.4,
    strikeTime: 0.14,
    recoverTime: 0.4,
    damageType: 'physical',
    // Venom — bites have a chance to poison. Poison stacks, so a swarm
    // still ramps attrition when it surrounds you, but the per-bite chance
    // is moderate so a single spider isn't a guaranteed stacking machine.
    // Nerf vs the ~8-HP player: a 4s poison was ~5 ticks/proc (most of the
    // bar) and stacked fast. Halved duration + lower chance so it wears, not
    // melts — the player's own DoT weapons (shared buff) are untouched.
    onHit: { buffId: 'poison', chance: 0.25, duration: 2.5 },
    abilities: [
      // POUNCE — coil then leap across the gap with a bite on contact.
      {
        id: 'pounce',
        minRange: 1.6, maxRange: 5,
        windup: 0.45, strike: 0.38, recover: 0.55, cooldown: 2.0,
        pose: 'charge', creep: false,
        steps: [{ trigger: { at: 0 }, action: { kind: 'dash', toward: 'player', speed: 8.5, contactReach: 1.2, damage: 1, element: 'physical' } }],
      },
      // BITE — point-blank snap when already on top of the player.
      {
        id: 'bite',
        minRange: 0, maxRange: 1.5,
        windup: 0.35, strike: 0.12, recover: 0.38,
        pose: 'swing', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.3, damage: 1, element: 'physical' } }],
      },
    ],
    // First ARACHNID creature: a low cephalothorax + bulbous abdomen on eight
    // radiating bent legs, with a cluster of red eyes. Legs are static-bent
    // (menacing stance); the 'twitch' presence gives the restless scuttle.
    creature: {
      id: 'spider',
      archetype: 'arachnid',
      proportions: { height: 0.22, girth: 0.26, legLength: 0.5 },
      materials: {
        // Absorbed — dark chitin, no rim; the eyes are the read in the dark.
        chitin: { color: 0x1a1016, roughness: 0.45, metalness: 0.15, flatShading: 'auto' },
        eyes: { color: 0xff3a55, emissive: 0xff3a55, emissiveIntensity: 2.4 },
      },
      eyes: { material: 'eyes', emissive: 2.4 },
      flash: { material: 'chitin' },
      skin: [
        // Cephalothorax (flattened) + bulbous abdomen.
        { kind: 'sphere', joint: 'body', radius: 0.2, scale: [1.0, 0.7, 1.1], jitter: 0.02, mat: 'chitin' },
        { kind: 'sphere', joint: 'abdomen', radius: 0.26, scale: [1.0, 0.85, 1.15], jitter: 0.03, mat: 'chitin' },
        // Eye cluster — several small red eyes on the front of the head.
        { kind: 'sphere', joint: 'head', radius: 0.035, pos: [-0.06, 0.03, -0.08], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.035, pos: [0.06, 0.03, -0.08], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.025, pos: [-0.1, -0.01, -0.06], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.025, pos: [0.1, -0.01, -0.06], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.022, pos: [-0.03, 0.06, -0.07], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.022, pos: [0.03, 0.06, -0.07], mat: 'eyes' },
        // Eight bent legs.
        ...spiderLegSkin('chitin'),
      ],
    },
    baseEyeEmissive: 2.4,
    collisionRadius: 0.30,
    physicalArmor: 0,
    magicArmor: 0,
    tiltPartName: 'body',
    flashMaterialName: 'chitin',
    eyeMaterialName: 'eyes',
    presence: 'twitch',        // restless scuttle
    sightRange: 8,
    sightConeHalfAngle: 1.3,   // wide — wall-crawler awareness
    hearingRange: 3.0,
    loseSightTime: 4,
    xp: 4,
  },

  // The Boiling King — Act III boss (depth 12).
  //
  // A king slime, big and viscous, swollen with everything it's eaten.
  // The act's verdant-rot palette (sickly greens) gives us a perfect
  // home for an acid theme that doesn't read as cute. Designed as the
  // SIMPLEST possible "real boss" — one telegraphed mechanic + one
  // dramatic death — to validate the whole pipeline (boss bar,
  // unique drop, splits-on-death, boss music state) before we author
  // more elaborate fights for Acts I and II.
  //
  // Fight loop:
  //   1. Player enters the boss arena, slime sees them, boss bar
  //      appears (handled by ui/boss-bar.ts — keyed off isBoss + aware).
  //   2. Slime telegraphs a HOP — long windup, ground ring at the
  //      player's feet, then a leap that lands as a radial AoE.
  //      Player steps out of the ring to dodge.
  //   3. Repeat until dead.
  //   4. On death, BURSTS into 3 boiling-prince smaller slimes
  //      (splitsInto). The fight isn't over yet — clean them up.
  //   5. Guaranteed drop: a poison-themed unique relic.
  //
  // Phase-2 / mid-fight transition mechanic (e.g. spitting acid
  // droplets between hops) is deliberately deferred to a follow-up
  // pass once V1 plays well.
  'boiling-king': {
    id: 'boiling-king',
    dropTable: 'boss',
    name: 'boiling king',
    // No tileChar — bosses bypass the ASCII char dictionary
    // entirely. populateTemplate's B-tile expansion records the
    // cell coords + boss id; vault-compose converts to a spawn
    // entry directly. Keeps the 26-uppercase ceiling from biting
    // as more bosses + named mobs land.
    isBoss: true,
    bossName: 'The Boiling King',
    // Sleeps behind the fog gate; the fight begins when you cross it.
    dormantUntilEngaged: true,
    entrance: 'ceiling-drop',        // waits above the arena, slams down when you cross the gate
    scale: 7.0,                      // WAY bigger than the player (~2× player height, 3.5m wide)
    hp: 40,                          // bigger body, more HP — fight pacing stays similar
    moveSpeed: 1.2,                  // a touch less glacial; the chase HOP does the real closing
    attackDamage: 3,                 // hits hard — the AoE is the threat
    attackRange: 10.0,               // proportional to body — leaps across the room
    strikeRange: 4.0,                // landing splash radius matches the bulk
    windupTime: 1.20,                // generous telegraph — readable on phone
    strikeTime: 0.50,                // longer strike so the leap actually crosses ground
    recoverTime: 1.40,               // more downtime so the king doesn't spam-leap
    damageType: 'magic',             // acid bypasses physical armour — boss earns its name
    // Translucent green flesh with swallowed regalia (crown, sword, skull)
    // drifting inside — sells the "it has eaten kings" line. A blob creature
    // authored at scale-1 coordinates; spec.scale (7.0) blows it up to boss
    // bulk — the creature path scales the group, hitbox radii, and aimHeight
    // together. No eyes — the glowing core orb is the read and the target.
    creature: {
      id: 'king-ooze',
      archetype: 'blob',
      proportions: { height: 0.36, girth: 0.25 },   // core at 0.18 (= old rig); ×7 → boss
      materials: {
        body: { color: 0x4a6a18, roughness: 0.55, emissive: 0x102008, emissiveIntensity: 0.7, flatShading: 'auto', dissolvable: true, transparent: true, opacity: 0.55, rim: { color: 0x88cc33, power: 2.2, intensity: 0.6 } },
        core: { color: 0x000000, emissive: 0xa8ff44, emissiveIntensity: 3.6, roughness: 1.0 },
        gold: { color: 0xb88820, emissive: 0x3a2808, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.7, flatShading: 'auto' },
        steel: { color: 0x607080, emissive: 0x10141c, emissiveIntensity: 0.4, roughness: 0.45, metalness: 0.8, flatShading: 'auto' },
        bone: { color: 0xc0b08a, roughness: 0.85, emissive: 0x1a1408, emissiveIntensity: 0.3, flatShading: 'auto' },
      },
      flash: { material: 'core' },
      skin: [
        // Outer body — translucent squashed sphere; the bulk is from spec.scale.
        { kind: 'sphere', joint: 'core', pos: [0, 0, 0], scale: [1.15, 0.85, 1.15], radius: 0.22, segments: [20, 14], jitter: 0.018, mat: 'body' },
        // Core nucleus + additive bloom halo (the obvious target through the body).
        { name: 'core', kind: 'sphere', joint: 'core', pos: [0, 0, 0], radius: 0.095, segments: [18, 14], mat: 'core' },
        { name: 'coreGlow', kind: 'sprite', joint: 'core', pos: [0, 0, 0], size: [0.25, 0.25], texture: 'fire-wisp', blending: 'additive', color: 0xa8ff44 },
        // Swallowed regalia, suspended inside the body's volume.
        { kind: 'torus', joint: 'core', pos: [0.04, 0.08, -0.10], rot: [-0.6, 0.3, 0], radius: 0.06, tube: 0.014, segments: [10, 6], mat: 'gold' },
        { kind: 'capsule', joint: 'core', pos: [-0.04, -0.04, 0.02], rot: [0.4, 0.7, 0.9], radius: 0.008, height: 0.16, mat: 'steel' },
        { kind: 'capsule', joint: 'core', pos: [-0.075, -0.07, -0.045], rot: [0.4, 0.7, 2.5], radius: 0.010, height: 0.04, mat: 'gold' },
        { kind: 'sphere', joint: 'core', pos: [0.06, -0.06, 0.07], radius: 0.045, segments: [10, 8], jitter: 0.005, mat: 'bone' },
        { kind: 'sphere', joint: 'core', pos: [-0.05, -0.10, -0.06], radius: 0.030, segments: [8, 6], jitter: 0.004, mat: 'bone' },
      ],
    },
    baseEyeEmissive: 0,              // no eyes — core orb carries the read
    // collisionRadius used to be 1.5 to match the visual bulk, but
    // that meant the dash path couldn't get close to pillars / great
    // braziers in the boss arena — the king slid sideways and never
    // reached the AoE landing zone. Drop to 0.7 so the king navigates
    // around obstacles instead of bumping off them. The aura (1.6)
    // remains the actual gameplay zone; this is just for movement.
    collisionRadius: 0.7,
    // The core orb sits at the model's rig (local y 0.18) → ~1.3m up at
    // scale 7. The default 0.6×scale = 4.2m would put the aim point WAY
    // above the body, so only a long-lunge swing could reach it. Pin the
    // aim to the actual core height so every swing connects with it.
    aimHeight: 1.3,
    // Hittable at the body's SURFACE, not its centre. With the aim pinned
    // to the core, a 2.1-reach sword already connects ~2m out (the body is
    // ~1.8m wide); this small radius is just grace so SHORTER swing
    // variants (low reachMul) also land cleanly and you're not nudging the
    // exact edge. Tunable — raise the aura (1.6) toward this if you want
    // attacking to demand more aura exposure.
    hitRadius: 0.6,
    // KEY MECHANIC: player walks INTO the king. No solid body. Once
    // inside, the aura ticks (defined below): slowed move + acid damage
    // after a grace window. The pressure is "get out before the next
    // tick" not "knockback clears you instantly."
    noPlayerCollision: true,
    aura: {
      radius: 1.6,                   // matches the visible body footprint at scale 7
      slowFactor: 0.4,               // 60% slow — sticky slime feel, escapable but costly
      dotDamage: 1,                  // tick is mild — the pressure is the slow + multiple ticks
      dotInterval: 1.0,              // ticks once per second while inside
      gracePeriod: 1.0,              // a full second of "I'm in, get out" before damage starts
    },
    tiltPartName: 'core',
    // Damage flash hits the CORE, not the body. The body is translucent
    // green at 0.55 opacity so a base-colour flash barely reads; enemy.ts
    // gives the core a heartbeat + a white-hot flare/pop on hit.
    flashMaterialName: 'core',
    // The king has NO eyes (baseEyeEmissive 0). Pointing eyeMaterialName at
    // 'core' made the eye system drive the core's emissive to 0 every frame
    // — blacking out the very orb that's supposed to glow. Aim it at a
    // material that doesn't exist so the eye system no-ops and the core
    // hit-reaction in enemy.ts fully owns the orb.
    eyeMaterialName: 'no-eyes',
    presence: 'twitch',              // pulsing blob feel even when idle
    physicalArmor: 0,
    magicArmor: 0,
    sightRange: 14,                  // sees you anywhere in the arena — no sneaking past
    sightConeHalfAngle: 1.8,         // near-omnidirectional — it's a blob, no front
    hearingRange: 4,
    loseSightTime: 12,               // never really gives up
    abilities: [
      // LASH — a melee deterrent so you can't camp the core risk-free
      // between leaps. The king coils (windup) then lashes a pseudopod
      // out to ~3m — far enough to clip you at the body's edge where you
      // strike the core. Highest priority at close range; cooldown keeps
      // it from chaining. creep so a stationary player still gets caught.
      {
        id: 'lash',
        minRange: 0, maxRange: 4.0,
        // Slow, unmistakable wind-up (1.3s): the 'lash' pose leans the
        // king slowly over toward you while the body ELONGATES (rears a
        // pseudopod — see the lash deform in enemy.ts), then it snaps the
        // tentacle out on the strike. creep so it also oozes toward you.
        windup: 1.30, strike: 0.28, recover: 0.85, cooldown: 3.4,
        pose: 'lash', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 3.2, damage: 2, element: 'arcane' } }],
      },
      // LEAP — a committed airborne jump. A ground ring telegraphs the
      // landing zone at the player's feet during windup; the king then
      // arcs ONTO that locked point (it commits to where you WERE, so
      // kiting off the marker is the dodge — a slow giant can't course-
      // correct mid-air). One self-contained `leap` effect owns the
      // whole thing: the arc, the landing splash, the screen-shake, and
      // the shove. If you eat the landing you're knocked to the body's
      // edge and the aura (slow + acid ticks, defined above) becomes the
      // inside-the-body pressure. Getting out is the skill expression.
      // minRange 4 so it commits to a real gap; maxRange 9 (was 14) so the
      // king can't slam you from clear across the arena the instant it
      // sees you — it has to HOP in first, then leap. The big leap is now
      // a rarer, impactful punctuation (cooldown 4.5), not a spam.
      {
        id: 'leap',
        minRange: 4, maxRange: 9,
        // strike 0.65 (was 0.50) + riseFraction 0.4 below = a faster launch
        // and a longer, readable descent — the player gets time to dodge
        // off the marker as the king hangs and drops.
        windup: 1.20, strike: 0.65, recover: 1.40,
        // Long cooldown — the big slam is occasional + impactful, not a
        // constant barrage. Hops + the lash carry the in-between pressure.
        cooldown: 4.5,
        pose: 'cast',
        steps: [
          // JUMP — committed airborne leap onto the locked landing zone.
          {
            id: 'jump', trigger: { at: 0 },
            action: {
              kind: 'leap', toward: 'lockedTarget',
              // 4m peak at mid-strike — reads unmistakably as airborne,
              // not a flat charge. Deterministic travel (takeoff → marker
              // over the 0.5s strike) lands exactly on the ring.
              arcHeight: 4.0,
              // Splash radius ≈ the body/aura footprint (1.6) so the dodge
              // is "step OFF the marker," not "sprint to the far wall."
              landingRadius: 1.6,
              damage: 3,
              element: 'arcane',   // magic damage, no status (the aura carries acid)
              shake: 0.35,         // chunky boss-slam thud
              shakeDuration: 0.45,
              // Shove the player to the body's edge on impact so they're in
              // the aura, not pinned dead-centre — escapable, but costly.
              knockbackSpeed: 4.0,
              // Guarantee a real arc even if the player is hugging the body
              // at windup: the landing point is pushed out to ≥3m.
              minDistance: 3.0,
              // Launch fast, descend slow — the drop is the dodge window.
              riseFraction: 0.4,
            },
          },
          // SPILL — on touchdown, leave a slow acid puddle at the impact
          // point (the `landing` anchor the leap just wrote). It lingers 5s
          // after the king has moved on: a denied tile that slows + ticks
          // anyone who stands in it. Reuse over invention — a placed,
          // time-limited copy of the king's own body aura.
          {
            id: 'spill', trigger: { after: 'jump', on: 'land' },
            action: {
              kind: 'field', origin: 'landing',
              radius: 2.0, lifetime: 5.0,
              slow: 0.5, dps: 1, dotInterval: 1.0,
              element: 'acid',
            },
          },
        ],
      },
      // HOP — small homing chase hop so the king actually closes on a
      // kiting player BETWEEN big leaps (LAST priority: only fires when the
      // lash/leap are on cooldown). Homes to where you ARE (toward
      // 'player'), short windup + short cooldown, low arc, no ground ring
      // (it's movement, not a committed AoE). A little chip if it lands on
      // you. minRange 1.5 so it doesn't hop in your face when adjacent.
      {
        id: 'hop',
        minRange: 1.5, maxRange: 9,
        // Calmer cadence (cooldown 1.2 + a readable 0.45 windup) so the
        // king isn't constantly airborne — small deliberate hops with a
        // crawl beat between, not a jitter.
        windup: 0.45, strike: 0.40, recover: 0.35, cooldown: 1.2,
        pose: 'cast',
        steps: [{ trigger: { at: 0 }, action: {
          kind: 'leap', toward: 'player', arcHeight: 1.1, landingRadius: 0.8, damage: 1,
          element: 'arcane', shake: 0.08, knockbackSpeed: 2.0, riseFraction: 0.45,
          maxDistance: 3.2,   // small fixed step — closes a kiting player over several hops
        } }],
      },
    ],
    xp: 60,                          // significant haul — earns the depth
    // SUMMON GATE — the king spits a boiling-prince ONE AT A TIME as you wear him
    // down: at 75%, 50%, and 25% HP. Each spit is a brief untouchable clang
    // window; the instant it closes he's open again, even with princes up. The
    // fight ends when the king AND every prince is dead. Adds mount gradually
    // rather than all three landing at once.
    summonGate: { atHpFrac: 0.75, enemyId: 'boiling-prince', count: 3, radius: 1.9, invulnTime: 0.8 },
  },

  // Boiling Prince — the children of the king. Smaller, faster, no
  // further splitting. They spill out mid-fight when the king splits, extra
  // pressure while you keep working the king down.
  'boiling-prince': {
    id: 'boiling-prince',
    name: 'boiling prince',
    // No tileChar — only spawned via the king's summonGate (mid-fight, at
    // 25% HP lost). Each prince is a boss, so the boss bar tracks all three
    // (as three smaller bars). The fight ends only when the king AND every
    // prince is dead.
    isBoss: true,
    bossName: 'Spawn of the King',
    hp: 4,
    moveSpeed: 1.6,                  // a touch faster so it can pressure a kiter
    attackDamage: 1,
    attackRange: 1.0,                // legacy fields (unused — `abilities` below drives it)
    strikeRange: 0.85,
    windupTime: 0.55,
    strikeTime: 0.18,
    recoverTime: 0.45,
    damageType: 'magic',             // still acid — keeps the king's theme
    // Aim/flash the CORE like the king (it has a glowing core now) — and
    // float the damage number from roughly the core height.
    aimHeight: 0.5,
    // A smaller version of the king's kit: a committed leap (telegraphed,
    // dodgeable) + a close-range bite. No puddle — three princes spilling
    // acid would carpet the arena.
    abilities: [
      {
        id: 'prince-leap',
        minRange: 2, maxRange: 5,
        windup: 0.70, strike: 0.45, recover: 0.70, cooldown: 2.4,
        pose: 'cast',
        steps: [{ trigger: { at: 0 }, action: {
          // Toned down vs before — lower arc + shorter range so it's a
          // small hop-pounce, not a king-sized slam.
          kind: 'leap', toward: 'lockedTarget', arcHeight: 1.1, landingRadius: 1.0, damage: 1,
          element: 'arcane', shake: 0.10, shakeDuration: 0.25, knockbackSpeed: 2.5,
          minDistance: 1.5, riseFraction: 0.42,
        } }],
      },
      {
        id: 'bite',
        minRange: 0, maxRange: 1.6,
        windup: 0.35, strike: 0.14, recover: 0.40,
        pose: 'swing', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.2, damage: 1, element: 'arcane' } }],
      },
    ],
    // A miniature king: translucent body with a glowing core orb + additive
    // bloom (the withGlow look), so the spawns read as the king's children.
    creature: {
      id: 'boiling-prince',
      archetype: 'blob',
      proportions: { height: 0.9, girth: 0.4 },
      materials: {
        body: { color: 0x4a6a18, roughness: 0.55, emissive: 0x102008, emissiveIntensity: 0.7, flatShading: 'auto', dissolvable: true, transparent: true, opacity: 0.55, rim: { color: 0x88cc33, power: 2.2, intensity: 0.6 } },
        core: { color: 0x000000, emissive: 0xa8ff44, emissiveIntensity: 3.0, roughness: 1.0 },
      },
      flash: { material: 'core' },
      skin: [
        { kind: 'sphere', joint: 'core', radius: 0.4, scale: [1.1, 0.78, 1.1], jitter: 0.05, mat: 'body' },
        { kind: 'sphere', joint: 'core', radius: 0.18, pos: [0, -0.03, 0.16], jitter: 0.04, mat: 'body' },
        { kind: 'sphere', joint: 'core', radius: 0.14, pos: [0, -0.02, 0], mat: 'core' },
        { name: 'coreGlow', kind: 'sprite', joint: 'core', pos: [0, -0.02, 0], size: [0.3, 0.3], texture: 'fire-wisp', blending: 'additive', color: 0xa8ff44 },
      ],
    },
    baseEyeEmissive: 0,
    collisionRadius: 0.38,
    // Walk-through like the king (slimes don't body-block). Fixes the
    // prince pinning the player when it leaps onto them — you're never
    // stuck inside one; the threat is its leap + bite, not a wall.
    noPlayerCollision: true,
    tiltPartName: 'core',
    // Flash the CORE (glowing, like the king) — and decouple the eyes so
    // the eye system doesn't zero the core's emissive (it has no eyes).
    flashMaterialName: 'core',
    eyeMaterialName: 'no-eyes',
    presence: 'gelatinous',
    sightRange: 5,
    sightConeHalfAngle: 1.6,
    hearingRange: 2.5,
    loseSightTime: 4,
    xp: 4,
    // No splitsInto — recursion terminator.
  },

  // ── Mob variety pass ───────────────────────────────────────────────
  // Three new mob types filling underrepresented combat verbs:
  //   - stationary AoE turret (plague spore)
  //   - floating fast caster, non-humanoid (sump wisp)
  //   - fast pack melee, bleed-on-hit (carrion hound)
  // Each ships with a distinct model so the silhouette reads
  // immediately, even in low-light corridors.

  // Marrow Sovereign — Act II/III boss. Two-phase skeleton:
  //   Phase 1: 4m standing, greatscythe. Three abilities — wide
  //     scythe sweep, ground slam at player's feet (AoE), bone-
  //     spike ring around himself. Player chips through Phase-1 HP
  //     (cosmetic leg-breaks at HP thresholds let the legs literally
  //     drop off as the player damages them).
  //   Phase 2: legs gone, scythe abandoned. Skeleton crawls forward
  //     on his arms — lower silhouette, faster than expected.
  //     Different ability set: arm sweep, marrow projectile, bite.
  //     Player has to AIM HIGH (skull is the target) and read new
  //     telegraphs.
  // Pilots the multi-phase system: HP-threshold transitions, per-phase
  // ability lists, rig offset/pitch overrides, hide-parts visual.
  'marrow-sovereign': {
    id: 'marrow-sovereign',
    dropTable: 'boss',
    bloodColor: 0x8a8274,
    bloodAmount: 0.3,
    name: 'marrow sovereign',
    isBoss: true,
    bossName: 'The Marrow Sovereign',
    // Authored ~3m floor-to-skull; scale 1.7 makes him tower at ~5m,
    // greatscythe sweeping to ~7m — reads as a giant from anywhere in
    // the hall. The aim-height + hitRadius below are pinned to that
    // scale so swings still land on the chest cavity.
    scale: 1.7,
    // Aim at the marrow glow (rig y ≈ 0.18 above hip → scaled, comes
    // out near chest height). Default 0.6×scale would float the aim
    // point WAY above the body for a model rigged this tall.
    aimHeight: 1.6,
    // Hit radius — kept tight. It does double duty: it extends the
    // player's reach to the big body's surface AND widens the
    // always-hittable point-blank zone (POINT_BLANK_RADIUS + hitRadius in
    // attack.ts). At 0.7 that zone (~1.6m) sat OUTSIDE his 1.2m collision
    // shell, so you connected from any angle while standing against him —
    // "damage him anywhere". 0.45 pulls the always-hit zone back near the
    // collision boundary so a swing has to roughly FACE him, while still
    // reaching the chest cavity.
    hitRadius: 0.45,
    hp: 1,                            // unused — phases own the HP pool
    moveSpeed: 1.0,                   // slow stride in phase 1
    attackDamage: 3,                  // mirrored by per-ability damage below
    // Aggro range stays long (he sees from across the hall), but the
    // per-ability maxRange below keeps him from attempting attacks
    // from ranges he can't actually reach. He's melee-to-midrange:
    // skull-crush is the only long-range tool and it's on a slow
    // cooldown, not spammable.
    attackRange: 6.0,
    strikeRange: 3.0,
    windupTime: 1.20,
    strikeTime: 0.40,
    recoverTime: 0.80,
    damageType: 'physical',
    // Same bespoke rig + clips, on the creature pipeline (see marrowCreatureSpec).
    // The model/look/hurtbox are unchanged; what's new is one hit path + measured
    // bounds + setJointVisible-ready part-breaks shared with the rest of the roster.
    creature: marrowCreatureSpec(),
    baseEyeEmissive: 2.0,
    // Body footprint at scale 1.7 — wider than a trash mob; the player
    // can't slip THROUGH his legs but can walk past them at arm's length.
    collisionRadius: 1.2,
    physicalArmor: 0,
    tiltPartName: 'rig',
    // Marrow glow inside the ribcage is both the eye-flare target
    // (windup cue) and the damage-flash target (hit feedback). Same
    // pattern as the king's core.
    flashMaterialName: 'core',
    eyeMaterialName: 'core',
    presence: 'lurch',                // heavy, deliberate
    sightRange: 14,
    sightConeHalfAngle: Math.PI,
    hearingRange: 6,
    loseSightTime: 12,
    // Keyframe animation bundle — idle / walk / crawl + ability clips
    // (bone-arm-sweep, pile-driver, earthshatter-stomp, skull-crush-charge,
    // arm-swipe, lunge-bite, bone-fragments). See src/anim/clips-marrow.ts.
    animation: { ...MARROW_CLIPS, joints: MARROW_JOINTS },
    phases: [
      // ── PHASE 1 — Standing. Four-move physical-heavy kit covering
      //    every range, each with a distinct dodge tell so the player
      //    has to READ the silhouette before committing.
      {
        hp: 22,
        moveSpeed: 1.0,
        abilities: [
          // Bone-arm cleave — melee sweep. maxRange tightened so he
          // doesn't open a windup from out of reach. Longer recovery +
          // cooldown so the kit doesn't loop straight back to it.
          // Dodge: step INSIDE the arc or sidestep perpendicular.
          {
            id: 'bone-arm-sweep',
            minRange: 0, maxRange: 5,
            windup: 1.40, strike: 0.30, recover: 0.90, cooldown: 3.4,
            pose: 'swing',
            steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 5.0, damage: 3, element: 'physical' } }],
          },
          // Two-hand pile-driver — committed slam at the locked target.
          // Mid-range only; long cooldown so it punctuates, not spams.
          // Dodge: step OFF the marker.
          {
            id: 'pile-driver',
            minRange: 0, maxRange: 7,
            windup: 1.30, strike: 0.20, recover: 1.10, cooldown: 4.5,
            pose: 'cast',
            steps: [{ trigger: { at: 0 }, action: { kind: 'aoe', origin: 'lockedTarget', radius: 2.7, damage: 4, element: 'physical' } }],
          },
          // Earthshatter stomp — radial AoE under the skeleton with the
          // giant-step foot-lift tell. Close-range only; you can't get
          // hit by this unless you've been hugging.
          // Dodge: outside the radius before the foot lands.
          {
            id: 'earthshatter-stomp',
            minRange: 0, maxRange: 4,
            windup: 1.40, strike: 0.20, recover: 1.10, cooldown: 5.0,
            pose: 'cast',
            steps: [{ trigger: { at: 0 }, action: { kind: 'aoe', origin: 'self', radius: 3.5, damage: 3, element: 'physical' } }],
          },
          // Skull-crush charge — the ONLY long-range tool. On a heavy
          // cooldown so it reads as the signature "oh no he's coming"
          // moment, not a gap-closing spam. Snapshot dash; sidestep
          // two paces perpendicular during the wind-back and he misses.
          {
            id: 'skull-crush-charge',
            minRange: 7, maxRange: 11,
            windup: 1.30, strike: 0.80, recover: 1.40, cooldown: 8.0,
            pose: 'charge',
            steps: [{
              trigger: { at: 0 },
              action: { kind: 'dash', toward: 'lockedTarget', speed: 9.0, contactReach: 1.6, damage: 6, element: 'physical' },
            }],
          },
        ],
        // Intra-phase part-break: the RIGHT leg drops at the half-way mark
        // (a clear "I'm wearing him down" beat). The LEFT leg is NOT broken
        // early — it gives out exactly at 0% phase-1 HP, when the phase-2
        // transition hides it AND collapses him. So there's no awkward
        // legless-standing gap: one leg at 50%, then at zero the other goes
        // and he falls. Phase 1 hp = 16, so atHp 8 == 50%.
        partBreaks: [
          { atHp: 8, hideParts: ['leg-right'] },
        ],
      },
      // ── PHASE 2 — Crawling. Legs + scythe gone. Lower silhouette,
      //    faster move (insectile crawl), shorter reach.
      {
        hp: 16,
        moveSpeed: 1.8,
        // Drop the rig (legs are gone — torso has to sit low to read
        // as crawling). Was -1.7 but the pelvis + dragging hands
        // clipped the floor at scale 1.7. -1.35 raises him just enough
        // that the lowest body parts hover JUST above the floor at the
        // forward-pitched crawl pose. Tune in pairs with rigPitch:
        // steeper pitch sinks the head further, so the offset has to
        // come up to compensate.
        rigYOffset: -1.35,
        rigPitch: -0.5,
        hideParts: ['leg-left', 'leg-right'],
        invulnEntryTime: 1.5,         // downed-rising animation window
        useCrawlAnimation: true,
        abilities: [
          // Arm swipe — short-range melee. Cooldown was 1.0 which let
          // him chain swipes back-to-back; bumped to 2.0 so there's a
          // breathing window between attacks.
          {
            id: 'arm-swipe',
            minRange: 0, maxRange: 3,
            windup: 0.55, strike: 0.20, recover: 0.70, cooldown: 2.0,
            pose: 'swing',
            steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.6, damage: 2, element: 'physical' } }],
          },
          // Bone splinters — five-shard fan from the ribcage. Range
          // tightened (was 9m, way past his bone-arm reach) and
          // cooldown bumped — a 5-shard burst should be a felt event,
          // not a constant pressure.
          {
            id: 'bone-fragments',
            minRange: 2, maxRange: 7,
            windup: 0.90, strike: 0.14, recover: 0.80, cooldown: 4.0,
            pose: 'cast',
            steps: [{
              trigger: { at: 0 },
              action: {
                kind: 'projectile', projectileId: 'bone-shard',
                muzzle: [0, 0.2, 0], damage: 1,
                count: 5, spreadDeg: 26,
              },
            }],
          },
          // Lunge bite — short forward dash. Cooldown 1.5 → 2.8 so it
          // doesn't gap-close every breath.
          {
            id: 'lunge-bite',
            minRange: 0, maxRange: 2.5,
            windup: 0.45, strike: 0.18, recover: 0.60, cooldown: 2.8,
            pose: 'charge',
            steps: [{ trigger: { at: 0 }, action: { kind: 'dash', toward: 'player', speed: 5.0, contactReach: 1.2, damage: 3, element: 'physical' } }],
          },
        ],
      },
    ],
    xp: 80,
  },

  // Plague Spore — stationary fungal turret. Doesn't move; periodically
  // inflates and releases a poison cloud AoE around itself. Reads as
  // "do I kill it or sprint past?" — the player chooses commitment.
  // Verdant Rot themed but appears act 2+.
  'plague-spore': {
    id: 'plague-spore',
    bloodColor: 0x6a6e2a,
    name: 'plague spore',
    hp: 4,
    moveSpeed: 0,                  // truly stationary
    attackDamage: 2,
    attackRange: 2.4,              // AoE radius; player must clear this
    strikeRange: 2.4,
    windupTime: 1.10,              // long telegraph — body inflates
    strikeTime: 0.18,
    recoverTime: 1.40,             // long cooldown — sprint past is viable
    damageType: 'magic',
    // Stationary fungal turret — a stalk under a flattened cap with a glowing
    // spore-sac core + drooping gills. The 'gelatinous' presence gives it a
    // slow living inflate; the core brightens as it readies a burst.
    creature: {
      id: 'plague-spore',
      archetype: 'blob',
      proportions: { height: 0.9, girth: 0.42 },
      materials: {
        flesh: { color: 0x1e1710, roughness: 0.9, flatShading: 'auto', rim: { color: 0xa8d870, power: 2, intensity: 0.4, darkReactive: 0.4 } },
        core: { color: 0xa8d870, emissive: 0xa8d870, emissiveIntensity: 1.6 },
      },
      eyes: { material: 'core', emissive: 1.6 },
      flash: { material: 'flesh' },
      skin: [
        // Stalk (widens upward) + flattened cap.
        { kind: 'cylinder', joint: 'core', radius: 0.1, radiusTop: 0.15, height: 0.42, pos: [0, -0.24, 0], jitter: 0.02, mat: 'flesh' },
        { kind: 'sphere', joint: 'core', radius: 0.34, scale: [1.1, 0.55, 1.1], pos: [0, 0.14, 0], jitter: 0.04, mat: 'flesh' },
        // Glowing spore-sac under the cap.
        { kind: 'sphere', joint: 'core', radius: 0.17, pos: [0, 0.04, 0], mat: 'core' },
        // Drooping gill tendrils around the cap rim.
        { kind: 'cone', joint: 'core', radius: 0.03, height: 0.2, pos: [0.24, 0.05, 0], rot: [0, 0, 0.6], mat: 'flesh' },
        { kind: 'cone', joint: 'core', radius: 0.03, height: 0.2, pos: [-0.24, 0.05, 0], rot: [0, 0, -0.6], mat: 'flesh' },
        { kind: 'cone', joint: 'core', radius: 0.03, height: 0.2, pos: [0, 0.05, 0.24], rot: [-0.6, 0, 0], mat: 'flesh' },
        { kind: 'cone', joint: 'core', radius: 0.03, height: 0.2, pos: [0, 0.05, -0.24], rot: [0.6, 0, 0], mat: 'flesh' },
      ],
    },
    baseEyeEmissive: 1.6,
    collisionRadius: 0.40,
    tiltPartName: 'core',
    flashMaterialName: 'flesh',
    eyeMaterialName: 'core',
    presence: 'gelatinous',        // slow living inflate
    sightRange: 6,
    sightConeHalfAngle: 1.8,       // near-omnidirectional — it's a fungus
    hearingRange: 4,
    loseSightTime: 99,             // never disengages — stationary
    abilities: [{
      id: 'spore-burst',
      minRange: 0, maxRange: 2.4,
      windup: 1.10, strike: 0.18, recover: 1.40, cooldown: 1.0,
      pose: 'cast',
      steps: [{ trigger: { at: 0 }, action: { kind: 'aoe', origin: 'self', radius: 2.2, damage: 2, element: 'arcane' } }],
    }],
    // Poison-on-hit because spores. Player who eats the cloud bleeds
    // damage for a few seconds after stepping out. Chance was 0.8 (poisoned on
    // nearly every hit → a guaranteed stacking shred); halved, with a shorter
    // duration, so it's a real attrition threat without melting the player.
    onHit: { buffId: 'poison', chance: 0.4, duration: 3 },
    xp: 4,
  },

  // Sump Wisp — floating non-humanoid caster. Distinct from the
  // acolyte (humanoid robed caster) by being a small glowing orb
  // that drifts. Fast move speed + low HP = hit-and-run kiter.
  // Reads as "ambient malevolence" rather than "person."
  'sump-wisp': {
    id: 'sump-wisp',
    bloodColor: 0x2a4e5e,
    bloodAmount: 0.5,
    name: 'sump wisp',
    hp: 3,                          // one-shot for most weapons — closing matters
    moveSpeed: 1.8,                 // fast — it kites
    attackDamage: 1,
    attackRange: 8,
    strikeRange: 8,
    windupTime: 0.70,
    strikeTime: 0.14,
    recoverTime: 0.55,
    damageType: 'magic',
    // Floating will-o'-wisp — a translucent blue orb (lifted by a tall blob
    // height) with a bright core + trailing wisps. 'spectral' floats it.
    creature: {
      id: 'sump-wisp',
      archetype: 'blob',
      proportions: { height: 1.6, girth: 0.26 },
      materials: {
        glow: { color: 0x66a8e0, roughness: 0.3, flatShading: 'auto', transparent: true, opacity: 0.45,
          dissolvable: true, rim: { color: 0xaaccff, power: 2, intensity: 0.8, darkReactive: 0.8 } },
        core: { color: 0xaaccff, emissive: 0xaaccff, emissiveIntensity: 2.6 },
      },
      eyes: { material: 'core', emissive: 2.6 },
      flash: { material: 'glow' },
      skin: [
        { kind: 'sphere', joint: 'core', radius: 0.26, jitter: 0.05, mat: 'glow' },
        { kind: 'sphere', joint: 'core', radius: 0.12, mat: 'core' },
        { kind: 'cone', joint: 'core', radius: 0.06, height: 0.4, pos: [0.1, -0.22, 0], rot: [2.9, 0, 0], mat: 'glow' },
        { kind: 'cone', joint: 'core', radius: 0.05, height: 0.35, pos: [-0.1, -0.2, 0.05], rot: [3.0, 0, 0], mat: 'glow' },
        { kind: 'cone', joint: 'core', radius: 0.045, height: 0.3, pos: [0, -0.18, -0.08], rot: [3.05, 0, 0], mat: 'glow' },
      ],
    },
    baseEyeEmissive: 2.2,           // the core pulses on windup
    collisionRadius: 0.22,
    noPlayerCollision: true,        // ghosts through you, doesn't body-block
    tiltPartName: 'core',
    flashMaterialName: 'glow',
    eyeMaterialName: 'core',
    presence: 'spectral',           // floats + bobs
    phasing: true,                  // drifts through obstacles like the wraith
    sightRange: 12,
    sightConeHalfAngle: 1.6,
    hearingRange: 4,
    loseSightTime: 6,
    preferredRange: 5.5,            // backs off if you close
    attackCooldown: 0.4,
    ranged: {
      muzzleOffset: [0, 0, 0],
      projectileId: 'acolyte-spit',  // reuse the spectral spit; tinted by the wisp's blue
    },
    xp: 5,
  },

  // Mimic — chest-disguised ambush mob. Never roll-placed in a vault
  // (no tileChar). Spawned in by the chest interactable when the
  // player "opens" a chest that was marked mimic in procgen. Stats
  // skew chunky: more HP than a ghoul, slower chase, big chomping
  // bite. Doesn't perceive the world normally — sightRange/hearingRange
  // are wide so the spawn-frame aggro on the player who JUST opened
  // the chest is automatic; no need to be facing it.
  mimic: {
    id: 'mimic',
    dropTable: 'enemy-elite',
    name: 'mimic',
    // No tileChar — never roll-placed. The chest interactable is the
    // only spawn path.
    hp: 9,
    moveSpeed: 1.8,
    attackDamage: 2,
    attackRange: 1.6,
    strikeRange: 1.40,
    windupTime: 0.55,     // big maw-gape tell — long enough to read
    strikeTime: 0.18,
    recoverTime: 0.55,
    damageType: 'physical',
    // Same chest-on-legs model, on the creature pipeline (see mimicCreatureSpec).
    // The disguise/ambush is unchanged — the chest interactable spawns this id.
    creature: mimicCreatureSpec(),
    baseEyeEmissive: 2.4,
    collisionRadius: 0.32,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'lurch',
    // Wide perception so the post-reveal frame aggros the player
    // even if they jumped sideways the instant they opened it.
    sightRange: 8,
    sightConeHalfAngle: Math.PI,   // full sphere — it's already on you
    hearingRange: 4,
    loseSightTime: 8,
    xp: 12,
    // Surviving a mimic is its own loot event. Always drops a pool
    // pick (rate = 1.0) so the betrayal pays out, with quality
    // weighted toward gear over potions — the dungeon rewards a
    // player who keeps their footing after the trap springs.
  },

  // Carrion Hound — fast quadruped pack predator. Sits between rat
  // (too soft) and skirmisher (humanoid melee) in the difficulty
  // curve. Bleeds on hit so being mobbed by a pack actually adds up.
  'carrion-hound': {
    id: 'carrion-hound',
    name: 'carrion hound',
    hp: 4,
    moveSpeed: 2.6,                 // fast chase
    attackDamage: 2,
    attackRange: 1.4,
    strikeRange: 1.20,
    windupTime: 0.40,               // shorter than the skirmisher — it bites quick
    strikeTime: 0.14,
    recoverTime: 0.40,
    damageType: 'physical',
    // Bigger, leaner quadruped than the rat — long dog snout, back-swept ears,
    // a whip tail, sickly yellow-green eyes. "Starving dog, not vermin."
    creature: {
      id: 'carrion-hound',
      archetype: 'quadruped',
      proportions: { height: 0.52, girth: 0.18, legLength: 0.36, headSize: 0.15, neckLength: 0.12 },
      materials: {
        hide: { color: 0x18120c, roughness: 1, flatShading: 'auto' },   // Absorbed — no rim (mundane beast)
        eyes: { color: 0xc8d030, emissive: 0xc8d030, emissiveIntensity: 2.0 },
      },
      eyes: { material: 'eyes', emissive: 2.0 },
      flash: { material: 'hide' },
      skin: [
        { kind: 'capsule', joint: 'spine', radius: 0.16, height: 0.44, rot: [1.5708, 0, 0], jitter: 0.02, mat: 'hide' },
        // Neck — bones bridging shoulders → skull (the head FLOATED in space
        // without these; every part must chain back to the spine).
        { kind: 'bone', from: 'chest', to: 'neck', radius: 0.095, radiusTop: 0.08, mat: 'hide' },
        { kind: 'bone', from: 'neck', to: 'head', radius: 0.08, radiusTop: 0.07, mat: 'hide' },
        // Elongated skull + long snout, back-swept ears, glowing eyes.
        { kind: 'sphere', joint: 'head', radius: 0.13, scale: [0.9, 1, 1.15], jitter: 0.02, mat: 'hide' },
        // aim:'forward' = muzzle apex toward the nose (intent form; this
        // cone also shipped backward once).
        { kind: 'cone', joint: 'head', radius: 0.07, height: 0.22, pos: [0, -0.03, -0.13], aim: 'forward', mat: 'hide' },
        // Ear cones: +X rotation sweeps the apex up-BACK (−0.5 pointed them
        // up-forward, which read as horns). Slight outward yaw, asymmetric.
        { kind: 'cone', joint: 'head', radius: 0.04, height: 0.11, pos: [-0.08, 0.1, 0.05], rot: [0.6, -0.25, 0.08], mat: 'hide' },
        { kind: 'cone', joint: 'head', radius: 0.04, height: 0.11, pos: [0.08, 0.1, 0.05], rot: [0.5, 0.25, -0.06], mat: 'hide' },
        { kind: 'sphere', joint: 'head', radius: 0.028, pos: [-0.08, 0.03, -0.08], mat: 'eyes' },
        { kind: 'sphere', joint: 'head', radius: 0.028, pos: [0.08, 0.03, -0.08], mat: 'eyes' },
        // Four lean legs (the trot gait swings them).
        { kind: 'bone', from: 'frontL', to: 'footFL', radius: 0.035, mat: 'hide' },
        { kind: 'bone', from: 'frontR', to: 'footFR', radius: 0.035, mat: 'hide' },
        { kind: 'bone', from: 'hindL', to: 'footHL', radius: 0.04, mat: 'hide' },
        { kind: 'bone', from: 'hindR', to: 'footHR', radius: 0.04, mat: 'hide' },
        // Whip tail, angled up/back. +1.3 about X points the apex (tip)
        // up-BACK with the fat base at the rump; −1.3 pointed the tip INTO
        // the body and left the base hanging in space.
        { kind: 'cone', joint: 'hips', radius: 0.04, height: 0.42, pos: [0, 0.05, 0.18], rot: [1.3, 0, 0], mat: 'hide' },
      ],
    },
    baseEyeEmissive: 2.0,
    collisionRadius: 0.30,
    tiltPartName: 'spine',
    flashMaterialName: 'hide',
    eyeMaterialName: 'eyes',
    sightRange: 8,
    sightConeHalfAngle: 1.4,
    hearingRange: 4.5,
    loseSightTime: 5,
    // Bleed-on-hit — the bites tear and they STAY torn. A pack of
    // hounds quickly stacks bleed; the kill isn't the worst part. Nerfed
    // (chance + duration) vs the ~8-HP player: a 4s bleed was ~5 ticks/proc
    // and a pack stacked it to lethal almost instantly. Still ramps under a
    // swarm, just no longer a near-one-shot from a single floor-3 hound.
    onHit: { buffId: 'bleed', chance: 0.25, duration: 2.5 },
    xp: 5,
  },

  // Pit Moth — flying insectoid melee swarmer. The mob whose job is
  // teaching you to LOOK UP and to use CLEAVING swings, not single-
  // target pokes. Each moth alone is trivial (1 HP — one hit kills),
  // but they're rolled in clusters at mid-depth so encountering
  // one usually means encountering 3-5. Hovers at head-height via
  // the model's elevated 'rig' slot + the spectral presence overlay.
  // No phasing — they're physical (a sword cone catches them) — but
  // noPlayerCollision so a swarm doesn't body-block your retreat.
  'pit-moth': {
    id: 'pit-moth',
    name: 'pit moth',
    hp: 2,
    moveSpeed: 2.6,                 // fast — outruns retreat
    attackDamage: 1,
    attackRange: 1.4,
    strikeRange: 1.20,
    windupTime: 0.30,               // brief tell — the bite is fast
    strikeTime: 0.10,
    recoverTime: 0.40,
    damageType: 'physical',
    // Flying insectoid on the new 'flier' archetype: a tiny body hovering at
    // head height with four wing planes hung on wing joints (so a flap can drive
    // them later) and two oversized luminescent eyes — the moth's whole read.
    // No head zone; the generous girth gives a single catchable body sphere so a
    // cleave still connects on a fast swarmer.
    creature: {
      id: 'pit-moth',
      archetype: 'flier',
      proportions: { height: 1.55, girth: 0.14, armLength: 0.22 },
      materials: {
        // Matte near-black body with a faint sickly emissive so the silhouette
        // doesn't vanish into the dungeon black.
        body: { color: 0x100a08, roughness: 1.0, emissive: 0x100a05, emissiveIntensity: 0.5, flatShading: 'auto', dissolvable: true },
        // Dusty tan membrane, partially transparent — lit from behind it reads.
        wing: { color: 0x3a2818, roughness: 0.95, flatShading: 'auto', transparent: true, opacity: 0.78 },
        // Oversized pinprick eyes.
        eyes: { color: 0x000000, emissive: 0xffd060, emissiveIntensity: 2.6, roughness: 1.0 },
      },
      eyes: { material: 'eyes', emissive: 2.6 },
      flash: { material: 'body' },
      skin: [
        // Thorax + abdomen — a horizontal capsule and a sphere, clear waist.
        { kind: 'capsule', joint: 'core', pos: [0, 0, 0.04], rot: [Math.PI / 2, 0, 0], radius: 0.05, height: 0.10, jitter: 0.005, mat: 'body' },
        { kind: 'sphere', joint: 'core', pos: [0, 0.01, -0.07], radius: 0.06, segments: [10, 8], jitter: 0.005, mat: 'body' },
        // Eyes — angled forward on the head, big for the body.
        { kind: 'sphere', joint: 'core', pos: [-0.035, 0.025, -0.10], radius: 0.025, segments: [8, 8], mat: 'eyes' },
        { kind: 'sphere', joint: 'core', pos: [ 0.035, 0.025, -0.10], radius: 0.025, segments: [8, 8], mat: 'eyes' },
        // Wings — four paper-thin extruded teardrops on the wing joints, so a
        // future flap clip rotates them about the attach point.
        { kind: 'extrude', joint: 'wingL',  pos: [ 0.028, -0.022, 0],     rot: [0, 0,  0.40], shape: [[0, 0], [0.18, 0.04], [0.22, 0.14], [0.12, 0.16], [0.04, 0.10]], depth: 0.003, mat: 'wing' },
        { kind: 'extrude', joint: 'wingR',  pos: [-0.028, -0.022, 0],     rot: [0, Math.PI, -0.40], shape: [[0, 0], [0.18, 0.04], [0.22, 0.14], [0.12, 0.16], [0.04, 0.10]], depth: 0.003, mat: 'wing' },
        { kind: 'extrude', joint: 'wingL2', pos: [ 0.0248, 0.01, -0.044], rot: [0, 0.20,  0.55], shape: [[0, 0], [0.14, 0.03], [0.17, 0.10], [0.09, 0.13], [0.03, 0.08]], depth: 0.003, mat: 'wing' },
        { kind: 'extrude', joint: 'wingR2', pos: [-0.0248, 0.01, -0.044], rot: [0, Math.PI - 0.20, -0.55], shape: [[0, 0], [0.14, 0.03], [0.17, 0.10], [0.09, 0.13], [0.03, 0.08]], depth: 0.003, mat: 'wing' },
        // Antennae — thin forward-curving cylinders.
        { kind: 'cylinder', joint: 'core', pos: [-0.022, 0.05, -0.14], rot: [0.5, 0,  0.15], radius: 0.004, height: 0.10, segments: 5, mat: 'body' },
        { kind: 'cylinder', joint: 'core', pos: [ 0.022, 0.05, -0.14], rot: [0.5, 0, -0.15], radius: 0.004, height: 0.10, segments: 5, mat: 'body' },
      ],
    },
    baseEyeEmissive: 2.6,
    collisionRadius: 0.10,          // very small footprint
    noPlayerCollision: true,        // swarm shouldn't body-block
    tiltPartName: 'core',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    // 'spectral' gives the float + bob — exactly what we want for
    // "hovering above the floor."
    presence: 'spectral',
    // Wide spheric vision + decent hearing — they're a swarm, you
    // can't sneak past one without all of them noticing.
    sightRange: 7,
    sightConeHalfAngle: 1.8,        // near-omnidirectional eyes
    hearingRange: 3.5,
    loseSightTime: 5,
    xp: 1,
  },

  // Lasher — STATIONARY plant-creature with a long whip-arm tendril
  // ending in a fanged maw. moveSpeed: 0 (rooted), but strikeRange:
  // 3.5m means the player's safe zone is "very close OR very far."
  // The middle band (1.5–3.5m) is the kill zone — get past the
  // sweep, hug the bulb, and the maw can't reach you. Forces a
  // commit decision on approach instead of the standard backpedal
  // dance. A new attack-distance pattern in the roster (everything
  // else either chases at melee or sits at range; the lasher does
  // long-reach melee from a fixed spot).
  lasher: {
    id: 'lasher',
    dropTable: 'enemy-elite',
    name: 'lasher',
    hp: 6,
    moveSpeed: 0,                   // rooted in the floor
    attackDamage: 2,
    attackRange: 3.8,               // long reach — the threat band
    strikeRange: 3.5,
    windupTime: 0.90,               // long telegraph — you can read the lunge
    strikeTime: 0.20,
    recoverTime: 0.85,
    damageType: 'physical',
    // Rooted carnivorous plant — a fanged maw bulb atop a thick stalk (lifted
    // by a tall blob height), inner red gullet, jaundiced eyes. The lash deform
    // already elongates it toward the player on the strike.
    creature: {
      id: 'lasher',
      archetype: 'blob',
      proportions: { height: 2.0, girth: 0.34 },
      materials: {
        flesh: { color: 0x171c12, roughness: 0.9, flatShading: 'auto', },
        maw: { color: 0x4a1a1a, roughness: 0.7, flatShading: 'auto' },
        teeth: { color: 0xddd8c0, roughness: 0.5, flatShading: 'auto' },
        eyes: { color: 0xffdd44, emissive: 0xffdd44, emissiveIntensity: 2.4 },
      },
      eyes: { material: 'eyes', emissive: 2.4 },
      flash: { material: 'flesh' },
      skin: [
        // Thick stalk rooted in the floor, tapering up to the maw.
        { kind: 'cylinder', joint: 'core', radius: 0.3, radiusTop: 0.16, height: 1.0, pos: [0, -0.5, 0], jitter: 0.04, mat: 'flesh' },
        // Maw bulb + inner red gullet opening forward.
        { kind: 'sphere', joint: 'core', radius: 0.3, jitter: 0.05, mat: 'flesh' },
        { kind: 'sphere', joint: 'core', radius: 0.2, pos: [0, 0, -0.16], scale: [1, 1, 0.6], mat: 'maw' },
        // A ring of teeth around the gullet.
        { kind: 'cone', joint: 'core', radius: 0.03, height: 0.12, pos: [0, 0.16, -0.24], rot: [-1.9, 0, 0], mat: 'teeth' },
        { kind: 'cone', joint: 'core', radius: 0.03, height: 0.12, pos: [0, -0.16, -0.24], rot: [1.9, 0, 0], mat: 'teeth' },
        { kind: 'cone', joint: 'core', radius: 0.03, height: 0.12, pos: [-0.16, 0, -0.24], rot: [0, 0, -1.9], mat: 'teeth' },
        { kind: 'cone', joint: 'core', radius: 0.03, height: 0.12, pos: [0.16, 0, -0.24], rot: [0, 0, 1.9], mat: 'teeth' },
        // Jaundiced eyes above the maw.
        { kind: 'sphere', joint: 'core', radius: 0.05, pos: [-0.13, 0.18, -0.2], mat: 'eyes' },
        { kind: 'sphere', joint: 'core', radius: 0.05, pos: [0.13, 0.18, -0.2], mat: 'eyes' },
      ],
    },
    baseEyeEmissive: 2.4,
    collisionRadius: 0.40,          // the bulb is wide
    physicalArmor: 1,
    tiltPartName: 'core',
    flashMaterialName: 'flesh',
    eyeMaterialName: 'eyes',
    // 'coiled' fits — a tense plant ready to strike. The shoulder-
    // bob shows up faintly on the maw segment.
    presence: 'coiled',
    // Near-omnidirectional perception so the lasher isn't bypassable
    // from the side; it's a deliberate room-control encounter.
    sightRange: 7,
    sightConeHalfAngle: 1.8,
    hearingRange: 3.5,
    loseSightTime: 99,              // stationary — sticks indefinitely
    xp: 8,
  },

  // Burrower — floor ambush predator. Spawns BURIED under a small
  // dirt-mound tell; emerges when the player walks within 2m. Once
  // surfaced it's a normal chunky melee mob — slower than a ghoul
  // but bigger bite (the ambush is the threat, not the chase).
  // Pairs with the pit moth thematically: moths teach "look up,"
  // burrowers teach "scan the floor."
  burrower: {
    id: 'burrower',
    name: 'burrower',
    hp: 4,
    moveSpeed: 1.6,                  // moderate — the surprise IS the threat
    attackDamage: 2,
    attackRange: 1.5,
    strikeRange: 1.30,
    windupTime: 0.50,                // medium telegraph — the maw gapes
    strikeTime: 0.16,
    recoverTime: 0.55,
    damageType: 'physical',
    // Worm-predator on the blob skeleton: a tapering trunk rising from the
    // floor, capped by an oversized fanged maw with a glowing gullet. All skin
    // hangs on the single 'core' joint (at height*0.5), so the 'lurch'/lash
    // tilt lunges the whole creature at the player on a strike. No head zone —
    // it's one mass. The burrow rise (enemy.ts) drives built.group.y directly,
    // so it still works unchanged on a creature.
    creature: {
      id: 'burrower',
      archetype: 'blob',
      proportions: { height: 1.3, girth: 0.36 },
      materials: {
        // Pale corpse-flesh with a faint internal glow so it reads at low light.
        body: { color: 0xa89880, roughness: 0.95, emissive: 0x2a1810, emissiveIntensity: 0.4, flatShading: 'auto', dissolvable: true },
        // Darker leathery claws.
        hide: { color: 0x382820, roughness: 0.95, flatShading: 'auto' },
        // Wet red gullet — this is what the windup flare drives (eyeMaterialName).
        throat: { color: 0x4a0a0c, emissive: 0xc4202a, emissiveIntensity: 1.6, roughness: 0.7 },
        // Yellowed bone fangs.
        fang: { color: 0xb8a87a, emissive: 0x2a1808, emissiveIntensity: 0.4, roughness: 0.6, flatShading: 'auto' },
      },
      // The maw has no eyes; route the eye-flare hook onto the gullet so the
      // throat FLARES on windup instead of pinprick eyes.
      eyes: { material: 'throat', emissive: 1.6 },
      flash: { material: 'body' },
      skin: [
        // Trunk — three tapering jittered cylinders, widest at the floor.
        { kind: 'cylinder', joint: 'core', pos: [0, -0.50, 0], radius: 0.32, radiusTop: 0.28, height: 0.30, segments: 10, jitter: 0.022, mat: 'body' },
        { kind: 'cylinder', joint: 'core', pos: [0, -0.15, 0], radius: 0.28, radiusTop: 0.22, height: 0.40, segments: 10, jitter: 0.020, mat: 'body' },
        { kind: 'cylinder', joint: 'core', pos: [0,  0.23, 0], radius: 0.22, radiusTop: 0.17, height: 0.34, segments: 10, jitter: 0.018, mat: 'body' },
        // Maw — flattened bulb where the head would be, with an inset glowing gullet.
        { kind: 'sphere', joint: 'core', pos: [0, 0.40, 0],     scale: [1.2, 0.8, 1.2], radius: 0.20, segments: [14, 10], jitter: 0.018, mat: 'body' },
        { kind: 'sphere', joint: 'core', pos: [0, 0.40, -0.06], scale: [1.0, 0.6, 1.3], radius: 0.14, segments: [12, 8], mat: 'throat' },
        // Fang ring — 8 cones around the maw rim, points outward like a closing trap.
        ...Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          const r = 0.21;
          return {
            joint: 'core', kind: 'cone' as const,
            pos: [Math.cos(a) * r, 0.40 + Math.sin(a) * r * 0.55, -0.04] as Vec3,
            rot: [Math.PI / 2 + 0.05, 0, -a] as Vec3,
            radius: 0.025, height: 0.10, segments: 6, mat: 'fang',
          };
        }),
        // Forelimbs — stubby shoulders, thin arms, hooked claws. The lateral
        // menace silhouette that reads as "predator," not "tube with teeth."
        { kind: 'sphere',  joint: 'core', pos: [-0.26, 0.20, 0.04], radius: 0.07, segments: [8, 6], jitter: 0.010, mat: 'body' },
        { kind: 'sphere',  joint: 'core', pos: [ 0.26, 0.20, 0.04], radius: 0.07, segments: [8, 6], jitter: 0.010, mat: 'body' },
        { kind: 'capsule', joint: 'core', pos: [-0.32, 0.05, 0.08], rot: [-0.3, 0,  0.5], radius: 0.035, height: 0.16, jitter: 0.010, mat: 'body' },
        { kind: 'capsule', joint: 'core', pos: [ 0.32, 0.05, 0.08], rot: [-0.3, 0, -0.5], radius: 0.035, height: 0.16, jitter: 0.010, mat: 'body' },
        { kind: 'cone',    joint: 'core', pos: [-0.42, -0.09, 0.16], rot: [-0.6, 0,  0.5], radius: 0.025, height: 0.12, segments: 6, mat: 'hide' },
        { kind: 'cone',    joint: 'core', pos: [ 0.42, -0.09, 0.16], rot: [-0.6, 0, -0.5], radius: 0.025, height: 0.12, segments: 6, mat: 'hide' },
      ],
    },
    baseEyeEmissive: 1.6,
    collisionRadius: 0.32,
    tiltPartName: 'core',
    flashMaterialName: 'body',
    eyeMaterialName: 'throat',
    presence: 'lurch',
    // Buried — emerge at 2m. The trigger distance is generous so
    // the player has half a beat to react; the emergeTime is short
    // (0.45s) so the rise reads as a BURST, not a slow elevator.
    burrowed: {
      triggerDistance: 2.0,
      emergeTime: 0.45,
    },
    // Once emerged, wide-sphere perception so the post-emerge
    // aggro on the player who just triggered it is automatic.
    sightRange: 8,
    sightConeHalfAngle: Math.PI,
    hearingRange: 4,
    loseSightTime: 8,
    xp: 8,
  },
};

// Per-enemy ASCII tile chars are GONE. Placement is always either
// procgen-driven (X / B slots in a vault map, expanded by
// populateTemplate into SpawnCell records) or explicit (a vault
// author drops { kind: 'spawn', enemyId, x, z } in the props array).
// The 26-letter ceiling can't bite a new mob anymore.
