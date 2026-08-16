// Colour-grade presets — the ART-DIRECTION layer of the PSX post pipeline.
//
// Each preset is DATA: a bag of grade parameters the final composite in
// render-webgpu.ts reads. This is the seam a design/content layer authors
// against — no shader edits needed to try a new look, just a new entry here or
// a URL scalar on the phone.
//
// ── The load-bearing idea (Josh, 2026-07-31) ─────────────────────────────────
// The old grade ended with AMBER_TINT — a fixed warm multiply over the WHOLE
// frame. So every surface drifted toward the same amber regardless of the light
// actually hitting it: "brown soup." Drop that bias and the LIGHT drives the
// hue — a blood-red torch makes red stone, a blue vault makes blue bone. That's
// the Mörk Borg "the skeleton takes the colour of its light" look, and it was
// already physically happening; the tint was painting over it.
//
// Split-tone is the second lever: push only the SHADOWS cool and the HIGHLIGHTS
// warm. Warm key against cold dark is the contrast the eye reads as DEPTH — the
// single biggest "cinematic" win for a torchlit game, and cheap (pure ALU in
// the tail pass).
//
// Amber stays the BASELINE identity of the dungeon. Presets are departures from
// it — a bluish vault, a harsher Mörk Borg register — selected per taste and,
// later, per-vault by the design layer.
//
// Selection:  ?grade=<name>   (coldfire | morkborg | ember | baseline)
// Live axes:  ?split= ?blacks= ?sat= ?expo= ?amber= ?vig= ?bloomth=
// DEV console: window.__grade('coldfire') / window.__gradeSet({ split: 0.7 })

export interface GradeSpec {
  readonly name: string;
  /** Global brightness knob, baked in before bloom. */
  readonly exposure: number;
  /** pow() on the graded image — >1 crushes mids/darks, keeps highlights. */
  readonly contrast: number;
  /** Push away from luminance. >1 punchier, <1 drained toward grey. */
  readonly saturation: number;
  /** Depth-crush target with distance. Lower = truer blacks far away. */
  readonly crushFloor: number;
  /** Global warm bias multiply. [1,1,1] = OFF → light drives the hue. */
  readonly amberTint: readonly [number, number, number];
  /** Split-tone strength: 0 = off (baseline), 1 = full shadow/highlight tint. */
  readonly splitStrength: number;
  /** Colour the SHADOWS lerp toward (cool: blue up, red down). */
  readonly shadowTint: readonly [number, number, number];
  /** Colour the HIGHLIGHTS lerp toward (warm: red up, blue down). */
  readonly highlightTint: readonly [number, number, number];
  /** Multiply on the distance-fog inscatter colour — cold far air reads as depth. */
  readonly inscatterTint: readonly [number, number, number];
  /** Bloom cutoff. Lower = more edges/props catch a halo (silhouette read). */
  readonly bloomThreshold: number;
  /** Edge darkening. */
  readonly vignette: number;
  /** Scales the dark-adaptation lift+gain. 1 = current (readable darks), 0 = let
   *  the shadows fall to true black (more drama, less "eyes adjust" legibility). */
  readonly adaptScale: number;
}

const WHITE: readonly [number, number, number] = [1, 1, 1];

// ── BASELINE ────────────────────────────────────────────────────────────────
// The exact look shipping today, expressed as a preset so ?grade=baseline is an
// honest A/B against everything below. Do not "improve" these numbers — this is
// the reference the others are measured against.
const BASELINE: GradeSpec = {
  name: 'baseline',
  exposure: 0.277,
  contrast: 1.04,
  saturation: 1.15,
  crushFloor: 0.16,
  amberTint: [1.025, 1.0, 0.96],
  splitStrength: 0.0,
  shadowTint: WHITE,
  highlightTint: WHITE,
  inscatterTint: WHITE,
  bloomThreshold: 1.0,
  vignette: 0.22,
  adaptScale: 1.0,
};

// ── COLDFIRE ──────────────────────────────────────────────────────────────── the recommended signature
// Warm torch, COLD dark. Amber bias off (light owns the hue). Shadows pushed
// blue, highlights kept warm — the classic torchlit-cinema contrast. Blacks
// crush truer at distance and the far fog goes cold, so a corridor reads as
// near-warm → deep-cold-black instead of one flat amber plane. Bloom threshold
// eased so a blade edge or a rune catches a halo and separates from the wall.
const COLDFIRE: GradeSpec = {
  name: 'coldfire',
  exposure: 0.38,
  contrast: 1.09,
  saturation: 1.12,
  crushFloor: 0.05,
  amberTint: WHITE,
  splitStrength: 0.55,
  shadowTint: [0.80, 0.92, 1.18],   // cool blue in the darks
  highlightTint: [1.10, 1.01, 0.86], // warm in the lights
  inscatterTint: [0.66, 0.83, 1.25], // far air goes cold even off warm bloom
  bloomThreshold: 0.85,
  vignette: 0.28,
  adaptScale: 0.4,
};

// ── MÖRK BORG ─────────────────────────────────────────────────────────────── harsh, near-monochrome + accent
// Black, bone-yellow, blood-red. Colour drained hard so any real hue (a red
// torch, a green fountain) SCREAMS. Highlights go acid/bone; shadows go dead
// cold-black. High contrast, near-zero adaptation (let the black BE black),
// bloom low so highlights burn. This is the "uniquely yours / experiment" lane.
const MORKBORG: GradeSpec = {
  name: 'morkborg',
  exposure: 0.36,
  contrast: 1.16,
  saturation: 0.55,
  crushFloor: 0.02,
  amberTint: WHITE,
  splitStrength: 0.65,
  shadowTint: [0.72, 0.86, 1.05],    // dead cold-black
  highlightTint: [1.18, 1.10, 0.62], // bone / acid yellow
  inscatterTint: [0.75, 0.80, 1.0],
  bloomThreshold: 0.72,
  vignette: 0.36,
  adaptScale: 0.0,
};

// ── EMBER ─────────────────────────────────────────────────────────────────── keep the amber soul, fix the values
// For when you want to STAY warm but lose the mud: the amber identity survives,
// but blacks crush true and a faint split keeps the shadows from going muddy-
// warm. The safe "it's the same game, just deeper" option.
const EMBER: GradeSpec = {
  name: 'ember',
  exposure: 0.37,
  contrast: 1.10,
  saturation: 1.18,
  crushFloor: 0.06,
  amberTint: [1.05, 1.0, 0.92],
  splitStrength: 0.30,
  shadowTint: [0.92, 0.96, 1.06],    // just a breath of cool in the darks
  highlightTint: [1.08, 1.0, 0.88],
  inscatterTint: [0.9, 0.92, 1.05],
  bloomThreshold: 0.9,
  vignette: 0.26,
  adaptScale: 0.6,
};

const PRESETS: Record<string, GradeSpec> = {
  baseline: BASELINE,
  coldfire: COLDFIRE,
  morkborg: MORKBORG,
  ember: EMBER,
};

/** Per-axis live overrides (URL scalars + DEV console), merged over the preset. */
interface GradeOverrides {
  split?: number;   // splitStrength
  blacks?: number;  // crushFloor
  sat?: number;     // saturation
  expo?: number;    // exposure
  amber?: number;   // lerp amberTint → [1,1,1] by (1-amber); amber=1 keeps preset, 0 = off
  vig?: number;     // vignette
  bloomth?: number; // bloomThreshold
}

function readUrl(): { name: string; ov: GradeOverrides } {
  const ov: GradeOverrides = {};
  // THE SHIPPING GRADE — stays 'baseline'.
  //
  // I switched this to 'coldfire' to kill the global amber multiply, and Josh
  // reversed it with the better argument: *"its good that we have light that is
  // cold or warm, we have other lights as well, i wouldnt switch the base light
  // but rather do a kinda engineering on floor and walls and how they react to
  // light — its already good, light kinda tints the walls."*
  //
  // The point being that a GRADE is a bias applied to the whole frame after the
  // fact, and this game already earns its colour the honest way: coloured
  // torches tint the stone they light, and the room-mood system varies those
  // deliberately. Flattening everything cold trades a real, per-light,
  // per-room signal for a global constant — the same category of mistake the
  // amber multiply was, pointed the other way.
  //
  // So the amber question gets answered in MATERIAL RESPONSE instead: what the
  // stone does with the light that hits it. That's config.ts's surface colours
  // and style/surface-detail.ts, not here.
  let name = 'baseline';
  if (typeof location === 'undefined') return { name, ov };
  const q = new URLSearchParams(location.search);
  const g = q.get('grade');
  if (g && PRESETS[g]) name = g;
  const num = (k: string): number | undefined => {
    const v = q.get(k);
    if (v == null) return undefined;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };
  ov.split = num('split');
  ov.blacks = num('blacks');
  ov.sat = num('sat');
  ov.expo = num('expo');
  ov.amber = num('amber');
  ov.vig = num('vig');
  ov.bloomth = num('bloomth');
  return { name, ov };
}

const _url = readUrl();
let activeName = _url.name;
let overrides: GradeOverrides = _url.ov;

function lerp3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The active grade with live overrides applied. Called each pipeline build. */
export function getActiveGrade(): GradeSpec {
  const base = PRESETS[activeName] ?? BASELINE;
  const o = overrides;
  const has = (v: number | undefined): v is number => v != null && Number.isFinite(v);
  return {
    ...base,
    exposure: has(o.expo) ? o.expo : base.exposure,
    saturation: has(o.sat) ? o.sat : base.saturation,
    crushFloor: has(o.blacks) ? o.blacks : base.crushFloor,
    splitStrength: has(o.split) ? o.split : base.splitStrength,
    vignette: has(o.vig) ? o.vig : base.vignette,
    bloomThreshold: has(o.bloomth) ? o.bloomth : base.bloomThreshold,
    // amber override lerps the preset's amberTint toward neutral [1,1,1].
    amberTint: has(o.amber) ? lerp3(WHITE, base.amberTint, Math.max(0, Math.min(1, o.amber))) : base.amberTint,
  };
}

/** Names available for ?grade= / the video-settings dropdown. */
export function gradeNames(): string[] {
  return Object.keys(PRESETS);
}

/** Switch the active preset (DEV console / settings). Returns false if unknown. */
export function setActiveGrade(name: string): boolean {
  if (!PRESETS[name]) return false;
  activeName = name;
  return true;
}

/** Merge live per-axis overrides (DEV console dial-in). Pass {} to clear. */
export function setGradeOverrides(partial: GradeOverrides, replace = false): void {
  overrides = replace ? { ...partial } : { ...overrides, ...partial };
}

export function activeGradeName(): string {
  return activeName;
}
