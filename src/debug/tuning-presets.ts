// ── NAMED LOOKS ──────────────────────────────────────────────────────────────
//
// Josh: *"can you keep both as presets so i can switch between."*
//
// The A/B button already compares a set against the SHIPPED defaults, which is
// the right tool while you are dragging one slider. It cannot hold two rival
// looks at once, and that is the thing he actually has — two wall treatments
// that differ across eleven knobs, both plausible, and no way to see them back
// to back without re-typing a URL.
//
// A preset is just a named map of id -> value. Applying one sets those knobs and
// leaves every other knob alone, which matters: a wall preset should not silently
// reset the floor. That also means presets compose — a wall look and a floor look
// can be applied one after the other.
//
// BUILT-IN presets live here as data so they are in git and survive a cleared
// browser. USER presets are captured from whatever is currently set and saved to
// localStorage, so a look found by dragging can be kept without a round trip
// through me.
import { listKnobs, getKnob, recordKnob, registerPresetApi } from './tuning';

export interface Preset {
  name: string;
  values: Record<string, number>;
  /** One line on what this look DOES, shown under the selector. A preset's name
   *  says which one it is; the blurb says why you would pick it, which is the
   *  thing a list of names cannot tell you. */
  blurb?: string;
}

// ── BUILT-INS ───────────────────────────────────────────────────────────────
//
// BASE PROFILE is the shipped look, and it is first because it is the one to
// come back to. Josh, 2026-08-17, handing over the set: *"new defaults, make a
// profile, call it base profile and make it the default."*
//
// It is written out here in full even though every value equals the authored
// default, which makes the chip a no-op when nothing has been touched. That is
// deliberate. The authored defaults are spread across two files and fifteen
// declarations, and they move — three of them moved yesterday for reasons that
// had nothing to do with taste (the floor's specular was a stale shared value,
// joint matte was arithmetically dead, the joint width followed the set-out
// fix). This list is the look as ONE object, at one moment, chosen by eye. When
// the next mechanical fix moves a default underneath it, the difference between
// "the current defaults" and "the look Josh signed off" stops being invisible.
//
// The two wall sets below it stay as rivals. SHEEN runs the stone specular well
// above MATTE on a rougher, brighter surface with much LESS damage; MATTE is the
// darker, drier, more broken one. Both predate BASE and neither is the default
// any more — applying one changes the wall and leaves the floor alone.
const BUILT_IN: Preset[] = [
  {
    // ── HOW FAR YOU CAN SEE, 2026-08-18 ──────────────────────────────────────
    //
    // Josh, handing over the set: *"make a new light config profile toggle like the other
    // profiles, and these settings."*
    //
    // The first profile about VISIBILITY rather than about stone. Every other preset here
    // tunes a surface; this one moves the wall the player is looking at, and it moves it by
    // taking three of the four systems that darken distance and standing them down so the
    // fourth can do the work alone.
    //
    // What it is doing, in the order it matters:
    //   · FOG FAR 9 -> 30.46. Fog was the range limit AND the render gate. At 9m a wide
    //     poly room was black before its far wall — the room got bigger when the floors went
    //     polygonal and the sight distance did not follow.
    //   · CRUSH END 12 -> 15, so what fog stops doing is not immediately re-done by the
    //     crush at a slightly longer range.
    //   · LAMP REACH 5.5 -> 20. There is no point seeing 30m by fog if the lantern dies at
    //     five: raising the range without raising the light only reveals more black.
    //   · EYE ADAPTATION off. It exists to lift the near-black you no longer have, and
    //     while it is on you cannot tell which of the two is doing the lifting.
    //   · VEIL STRENGTH 0.92 -> 0.9. THE THRESHOLDS ARE THE GATE NOW. This is the trade the
    //     whole profile is: distance stops being what hides the next room, and the doorway
    //     starts being it — which is a rule the player can read and walk through, where fog
    //     was a rule they could only bump into.
    //   · STONE ROUGHNESS 1 -> 0.904, a touch of highlight back on the wall, because a
    //     surface lit at 20m by a lamp needs something for the light to catch.
    //
    // `showvm` came over with the set and is deliberately NOT in it: hiding the hands is an
    // inspection affordance, and a lighting profile that disarms you when you pick it is a
    // profile nobody can use in play.
    name: 'long sight',
    blurb: 'fog out to 30m, lamp to 20m, no adaptation — the doorway gates the view, not the distance',
    values: {
      fogfar: 30.46, crushend: 15, lampdist: 20, adaptmul: 0,
      veilstr: 0.9, wallrough: 0.904,
    },
  },
  {
    // ── THE SHIPPED LOOK, 2026-08-17 ─────────────────────────────────────────
    // Josh: *"new default profile, add it as new profile ... this is the new
    // profile i want."*
    //
    // Where BASE PROFILE was a stone that still took a highlight, this one is
    // dry all the way through: floor AND wall roughness pinned at 1.0, the
    // floor's albedo down a third (1.072 -> 0.76), and its polish threshold up
    // to 0.95 so only a couple of worn lanes shine at all. The lighting goes the
    // other way — bands much SOFTER (0.075 -> 0.4) with the response curve and
    // the specular curve both flattened to 1.0, and the specular posterised into
    // 5 regions instead of 9. So: fewer, broader, softer steps over matte stone,
    // where base was harder steps over stone that could gleam.
    name: 'soft matte',
    blurb: 'dry stone, broad soft bands — floor and wall fully matte, 5 specular steps',
    values: {
      bandsoft: 0.4, bandcurve: 1, speccurve: 1, banddither: 0.08,
      bandwarp: 0.495, bandwarpn: 0.45, specbands: 5,
      flrwarm: -0.35, flrbright: 0.76, flrrough: 1,
      flrpolish: 0.303, flrpolishat: 0.95,
      wallrough: 1,
    },
  },
  {
    name: 'base profile',
    blurb: 'the 2026-08-16 look — stone that still takes a highlight, harder bands',
    values: {
      // ── THESE TWELVE WERE ADDED WHEN 'soft matte' BECAME THE DEFAULT ────────
      // and the panel's own preview is what caught it: picking base profile
      // reported "1 of 17 differ from now", because the only knob it shared with
      // the new default was wallrough. Every band and floor value soft matte
      // moved was one base profile had never named, so choosing it would have
      // restored yesterday's colours on top of today's lighting — a look neither
      // profile is. A preset has to name what it restores, which is the whole
      // argument for writing them out as explicit objects rather than deltas.
      bandsoft: 0.075, bandcurve: 1.35, speccurve: 1.16, banddither: 0.14,
      bandwarp: 0.55, bandwarpn: 0.4, specbands: 9,
      flrwarm: -0.44, flrbright: 1.072, flrrough: 0.796,
      flrpolish: 0.345, flrpolishat: 0.61,
      // relief
      pomdepth: 0.1005, relief: 0.351,
      // wall stone
      wallwarm: -0.09, wallbright: 1.012, wallrough: 0.904, wallpolish: 0.306,
      gritw: 1.53, cornerw: 0.915,
      // wall joints
      mortarmattew: 0.315, mortardirtw: 0.295, jointw2w: 0.708,
      // floor
      stonespecf: 0.63, mortarhuef: 0.475, mortarmattef: 0.495,
      mortardirtf: 0.67, mortarwarmf: 0.32, jointw2f: 1.198,
    },
  },
  {
    name: 'wall · matte',
    blurb: 'wall only: darker, drier, more broken — leaves the floor alone',
    values: {
      stonespecw: 0.3525, mortarmattew: 0.8, wallbright: 1.12, wallrough: 0.872,
      cracksw: 0.575, erodew: 0.715, tallvar: 0.5, gritw: 1.5,
      chipw: 1.845, cornerw: 1.08, crackwebw: 1.065,
    },
  },
  {
    name: 'wall · sheen',
    blurb: 'wall only: brighter and glossier with much less damage',
    values: {
      // Specular pulled back from 0.87 to 0.59 — Josh's call once this became
      // the shipped look rather than a rival to it.
      stonespecw: 0.59, mortarmattew: 0.76, wallbright: 1.186, wallrough: 0.94,
      cracksw: 0.24, erodew: 0.735, tallvar: 0.455, gritw: 1.515,
      chipw: 1.605, cornerw: 0.78, crackwebw: 0.525,
    },
  },
];

const USER_KEY = 'delve.tune.presets';

function loadUser(): Preset[] {
  try { return JSON.parse(localStorage.getItem(USER_KEY) ?? '[]') as Preset[]; }
  catch { return []; }
}
function saveUser(list: Preset[]): void {
  try { localStorage.setItem(USER_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

export function allPresets(): Preset[] {
  return [...BUILT_IN, ...loadUser()];
}

/** Apply a preset. Only the knobs it names move; everything else is left alone,
 *  so a wall preset cannot quietly reset the floor. Recorded as edits, because
 *  choosing a preset IS choosing a look and should survive a reload. */
export function applyPreset(name: string): string {
  const p = allPresets().find((x) => x.name === name);
  if (!p) return `no preset '${name}'`;
  let n = 0;
  for (const [id, v] of Object.entries(p.values)) {
    const k = getKnob(id);
    if (!k) continue;             // a preset outliving a renamed knob is not an error
    k.set(v);
    recordKnob(id, k.get());
    n++;
  }
  const missing = Object.keys(p.values).filter((id) => !getKnob(id));
  return missing.length
    ? `${p.name}: ${n} applied, ${missing.length} unknown (${missing.join(', ')})`
    : `${p.name}: ${n} knobs`;
}

/** Capture everything currently off its authored default as a new user preset.
 *  Saving the DELTA rather than every knob keeps a preset about what it changes
 *  — so it stays composable, and a later default change still reaches it. */
export function savePreset(name: string): string {
  const values: Record<string, number> = {};
  for (const k of listKnobs()) {
    if (Math.abs(k.get() - k.authored) > 1e-6) values[k.spec.id] = k.get();
  }
  if (!Object.keys(values).length) return 'nothing differs from the defaults — nothing to save';
  const list = loadUser().filter((p) => p.name !== name);
  list.push({ name, values });
  saveUser(list);
  return `saved '${name}' with ${Object.keys(values).length} values`;
}

export function deletePreset(name: string): string {
  if (BUILT_IN.some((p) => p.name === name)) return `'${name}' is built in — edit tuning-presets.ts`;
  const before = loadUser().length;
  const list = loadUser().filter((p) => p.name !== name);
  saveUser(list);
  return before === list.length ? `no preset '${name}'` : `deleted '${name}'`;
}

// Hand the console API over. Done here rather than in tuning.ts so that module
// keeps no dependency on this one — the cycle would fire at import time.
registerPresetApi({
  list: () => allPresets().map((p) => p.name),
  apply: applyPreset,
  save: savePreset,
  del: deletePreset,
});
