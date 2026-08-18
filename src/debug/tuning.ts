// ── SELF-REGISTERING TUNING KNOBS ────────────────────────────────────────────
//
// Josh: *"the url dials always reload the full game, is there something else we
// can do for me to tune these without it being annoying? like maybe an ingame
// menu of some sort thats self building from options you provide so you dont
// have to handwork."*
//
// Yes, and the reload was doing more damage than being annoying: a full reload
// per value is ~3 minutes of level rebuild, which is why every tuning pass this
// far has been me guessing a number, waiting, and guessing again. A knob you
// can drag is a different activity from a knob you can only re-roll.
//
// A module DECLARES a knob where the value is used, and it appears in the
// panel. No registration list, no UI code at the call site, nothing to keep in
// sync — the declaration IS the registration:
//
//     const relief = tuneUniform({
//       id: 'relief', group: 'Surface', label: 'Relief',
//       min: 0, max: 0.6, value: 0.25,
//     });
//     // …then use `relief` directly as a TSL node.
//
// ── THE THREE COSTS OF CHANGING A VALUE ──────────────────────────────────────
// Not every number can be live, and pretending otherwise would just produce a
// panel whose sliders silently do nothing. Three honest tiers:
//
//   LIVE     the value is a TSL uniform. The shader reads it every frame, so
//            dragging updates the picture immediately. Use for any scalar the
//            shader multiplies by.
//   REBAKE   the value feeds the CPU texture generator, so the texture has to
//            be regenerated. Cheap (a few ms) and still instant to the eye —
//            the new pixels are copied into the SAME texture object, so nothing
//            downstream rebinds or recompiles.
//   RELOAD   the value changes the shader's STRUCTURE — a loop count that gets
//            unrolled into the node graph, for instance. Nothing can fix that
//            short of rebuilding the pipeline, so the panel says so plainly
//            rather than pretending the slider worked.
//
// DEV-only by construction: nothing here is imported by a production path, and
// the panel that reads it is behind the DEV gate.
import { uniform as tslUniform } from 'three/tsl';
import { DEV } from './dev';

export type ApplyCost = 'live' | 'rebake' | 'reload';

export interface KnobSpec {
  /** Stable id — also the URL param name, so ?relief=0.3 still seeds it. */
  id: string;
  /** Tab the knob appears under. */
  group: string;
  label: string;
  min: number;
  max: number;
  /** Default; overridden by a URL param of the same name if present. */
  value: number;
  step?: number;
  /** Defaults to 'live' for uniforms, 'rebake' for plain numbers. */
  apply?: ApplyCost;
  /** One line shown under the slider — say what it DOES, not what it is. */
  hint?: string;
}

export interface Knob {
  spec: Required<Omit<KnobSpec, 'hint'>> & { hint?: string };
  get(): number;
  set(v: number): void;
  /** The value this knob started at — after the URL and the saved set have had
   *  their say. */
  readonly initial: number;
  /** The value declared in CODE, before anything seeded it. This is what RESET
   *  goes back to and what the A/B compares against — not `initial`, which is
   *  already contaminated by whatever the last session left behind. */
  readonly authored: number;
}

const knobs = new Map<string, Knob>();
const rebakeHooks = new Set<() => void>();
const changeHooks = new Set<(k: Knob) => void>();

// ── YOUR SET SURVIVES A RELOAD ───────────────────────────────────────────────
// Josh: *"a cached setting that when the tools open i can kinda have default and
// what i am setting and a way to toggle between easily."*
//
// Every value moved off its authored default is written here and re-applied at
// registration, so a reload comes back to the look you were working on rather
// than to the shipped one. It has to happen at REGISTRATION and not when the
// panel opens: the textures bake from these numbers during level build, long
// before anyone taps TUNE.
//
// PRECEDENCE: a URL param beats the saved set beats the authored default. The
// URL wins on purpose — a link is how a specific look gets communicated, and it
// would be worthless if the receiving browser's leftovers overrode it.
const SAVE_KEY = 'delve.tune.mine';
let mine: Record<string, number> = {};
try {
  if (DEV && typeof window !== 'undefined') {
    mine = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') as Record<string, number>;
  }
} catch { mine = {}; }

// Lazily reached so this module does not import tuning-presets, which imports
// this one — a cycle that would bite at module-init time rather than at a call.
type PresetApi = { list(): string[]; apply(n: string): string; save(n: string): string; del(n: string): string };
let presetApiRef: PresetApi | null = null;
export function registerPresetApi(api: PresetApi): void { presetApiRef = api; }
function presetApi(): PresetApi {
  return presetApiRef ?? {
    list: () => [], apply: () => 'presets not loaded (open the TUNE panel once)',
    save: () => 'presets not loaded', del: () => 'presets not loaded',
  };
}

function persist(): void {
  // Transient knobs never reach the saved set — see markTransient.
  const keep: Record<string, number> = {};
  for (const [k, v] of Object.entries(mine)) if (!transient.has(k)) keep[k] = v;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(keep)); } catch { /* private mode */ }
}

/** Seed from the URL, then the saved set, then the authored default. */
function seed(id: string, dflt: number, min: number, max: number): number {
  if (!DEV || typeof window === 'undefined') return dflt;
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const v = new URLSearchParams(window.location.search).get(id);
  if (v != null) {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return clamp(n);
  }
  const s = mine[id];
  return typeof s === 'number' && Number.isFinite(s) ? clamp(s) : dflt;
}

function register(spec: KnobSpec, apply: ApplyCost, get: () => number, set: (v: number) => void): Knob {
  const initial = seed(spec.id, spec.value, spec.min, spec.max);
  const knob: Knob = {
    spec: {
      id: spec.id, group: spec.group, label: spec.label,
      min: spec.min, max: spec.max, value: initial,
      step: spec.step ?? (spec.max - spec.min) / 200,
      apply, hint: spec.hint,
    },
    initial,
    authored: spec.value,
    get,
    set(v: number) {
      const c = Math.max(spec.min, Math.min(spec.max, v));
      set(c);
      if (apply === 'rebake') for (const h of rebakeHooks) h();
      for (const h of changeHooks) h(knob);
    },
  };
  set(initial);
  // A value that arrived from a URL counts as part of YOUR SET, so the A/B can
  // compare a shared link against the shipped look the moment it opens — which
  // is the main thing you'd want to do with a link someone sent you.
  //
  // In memory only, deliberately NOT persisted: the URL is already the record
  // of that look, and writing it to localStorage would make a link you opened
  // once stick to the browser forever, which is a surprise nobody asked for.
  // Saved values are in `mine` already; slider drags and __tune.set persist.
  if (Math.abs(initial - spec.value) > 1e-6) mine[spec.id] = initial;
  knobs.set(spec.id, knob);
  reseedLater();
  return knob;
}

/**
 * A LIVE knob backed by a TSL uniform. Returns the uniform NODE — use it
 * directly in the shader graph and the slider moves the picture with no
 * rebuild, no rebake, no reload.
 */
export function tuneUniform(spec: KnobSpec): { value: number } {
  const u = (tslUniform as unknown as (v: number) => { value: number })(spec.value);
  register(spec, spec.apply ?? 'live', () => u.value, (v) => { u.value = v; });
  return u;
}

/**
 * A plain-number knob. Returns a GETTER, not the value, because the value can
 * change at any moment — reading it once at module load is the bug this whole
 * file exists to remove.
 */
export function tuneNumber(spec: KnobSpec): () => number {
  let v = spec.value;
  register(spec, spec.apply ?? 'rebake', () => v, (n) => { v = n; });
  return () => v;
}

// ── SEEDING A VALUE IS NOT APPLYING IT ───────────────────────────────────────
//
// Josh: *"some of the dark parameters, like crush start and crush end, are only read when I
// nudge the sliders again even though they are set. Same with the viewmodel."*
//
// `register()` stores the seeded value and returns. Nothing is notified — the change hooks
// fire on a CHANGE, and arriving from a URL or a saved set is not one. So every consumer
// that has to PUSH its value somewhere (a TSL uniform, a visibility flag, a camera angle)
// had to hand-roll its own boot-time apply, and each hand-rolled apply runs at whatever
// moment its module happens to be imported — which is either too early, before the thing it
// configures exists, or fine today and wrong after the next import moves.
//
// The evidence that this was a class and not a bug: tuning-view.ts had grown a 250ms poll,
// forty times, to keep re-asserting `showvm` at anything that might have been built since.
//
// One call, at one stated moment, that tells every knob's listeners what the knob says. A
// module then only needs a change hook — the path it already has — and gets its seeded
// value through the same path, which means there is one way a knob reaches a system instead
// of two.
//
// REBAKE HOOKS ARE DELIBERATELY NOT FIRED. A rebake knob is read by the bake when the bake
// runs, and the bakes happen after boot anyway; firing them here would regenerate every CPU
// texture on a value that is already correct.
let seeded = false;
let reseedQueued = false;

// ── SOME KNOBS ARE AN ACTION, NOT A VALUE ────────────────────────────────────
//
// The replay below pushes every knob's value into whatever listens, which is right for a
// knob a system HOLDS — a fog distance, a shader uniform, a visibility flag. It is wrong for
// a knob that DOES something when you move it. Camera pitch and yaw are the case: they are
// an inspection override for framing a shot, and replaying one at boot points the camera
// somewhere nobody asked for.
//
// It cost the title screen. A yaw left at 2.36 rad in a saved set — mine, from a rotation
// sweep an hour earlier, since `__tune.set` persists — was replayed at boot and turned the
// vignette camera away from its bonfire. Josh: *"my camera position in the loading screen
// changed, I am no longer looking at the bonfire."* The knob had been sitting there
// harmlessly for as long as nothing replayed it.
//
// Declared by the module that owns the knob, because that module is the only one that knows
// whether its knob is a value or a verb.
// A verb is also not something to REMEMBER. Persisting one is what makes it fire forever:
// a yaw dragged once to frame a screenshot went into localStorage, and from then on every
// level entry — including the title screen's own vignette, which is a level like any other —
// turned the camera to it. Excluding it from the boot replay was not enough, because the
// level-entry re-assert is a second path to the same place. So: not replayed, not saved, and
// any value already in the saved set is dropped the moment the knob registers, so a stale
// one cures itself on the next boot rather than needing a console.
//
// A URL param still works — `?yaw=-0.7` is someone deliberately posing a shot, for that page
// load only — and a drag still works for the session. Neither is remembered.
const transient = new Set<string>();
export function markTransient(id: string): void {
  transient.add(id);
  if (mine[id] !== undefined) { delete mine[id]; persist(); }
}

export function reapplyKnobs(): void {
  seeded = true;
  for (const k of knobs.values()) {
    if (transient.has(k.spec.id)) continue;
    for (const h of changeHooks) h(k);
  }
}

/**
 * A tab imported AFTER boot gets the same treatment.
 *
 * Half the knob modules are pulled in by the game (the dark tab is imported by the systems
 * loop); the rest arrive when the panel is first opened, which is long after main has called
 * reapplyKnobs. Those would be back where they started — seeded and unapplied.
 *
 * On a MICROTASK, and this is the whole reason it can be automatic: a module registers its
 * knobs and only then registers its change hook, so firing at registration would shout into
 * an empty room. A microtask runs after the module body finishes, when the hook is there.
 * Deduped, so importing a tab with nine knobs costs one pass.
 */
function reseedLater(): void {
  if (!seeded || reseedQueued) return;
  reseedQueued = true;
  queueMicrotask(() => { reseedQueued = false; reapplyKnobs(); });
}

/** Run whenever a 'rebake' knob moves — regenerate the CPU textures here. */
export function onRebake(fn: () => void): void { rebakeHooks.add(fn); }
/** Run on ANY knob change — the panel uses this to keep its readouts honest. */
export function onKnobChange(fn: (k: Knob) => void): void { changeHooks.add(fn); }

export function listKnobs(): Knob[] { return [...knobs.values()]; }
export function knobGroups(): string[] {
  return [...new Set([...knobs.values()].map((k) => k.spec.group))];
}
export function getKnob(id: string): Knob | undefined { return knobs.get(id); }

// ── window.__tune — the same knobs, from a console or a script ───────────────
// The panel is for a thumb; this is for everything else. It exists because
// verifying a live knob without it means a full page reload with a ?param —
// which is precisely the loop this file was written to kill, and I walked
// straight back into it the first time I tried to check my own work.
//
// It also makes a look SCRIPTABLE: an A/B screenshot pair is now two
// __tune.set() calls between two captures, instead of two level rebuilds.
if (DEV && typeof window !== 'undefined') {
  (window as unknown as { __tune?: unknown }).__tune = {
    /** Every knob as 'group/id = value', for finding the id you want. */
    list: () => listKnobs().map((k) => `${k.spec.group}/${k.spec.id} = ${k.get()}`),
    get: (id: string) => knobs.get(id)?.get(),
    /** Set one knob. Returns the clamped value, or a message if the id is
     *  wrong — silently doing nothing is the failure mode to avoid here.
     *  RECORDS, like a slider drag does: a console set is an edit, and if it
     *  weren't recorded the A/B would flip to DEFAULT and then "back" to
     *  nothing. (Found exactly that way.) */
    set: (id: string, v: number) => {
      const k = knobs.get(id);
      if (!k) return `no knob '${id}' — try __tune.list()`;
      k.set(v);
      recordKnob(id, k.get());
      return k.get();
    },
    /** Set several at once: __tune.setAll({ flrwarm: 0.6, flrrough: 0.9 }). */
    setAll: (vals: Record<string, number>) =>
      Object.entries(vals).map(([id, v]) => {
        const k = knobs.get(id);
        if (!k) return `${id}: UNKNOWN`;
        k.set(v);
        recordKnob(id, k.get());
        return `${id}: ${k.get()}`;
      }),
    query: () => knobsAsQuery(),
    // Presets, from the console as well as the panel — savePreset captures
    // whatever currently differs from the defaults, so a look found by dragging
    // can be kept without a round trip through me.
    presets: () => presetApi().list(),
    preset: (name: string) => presetApi().apply(name),
    savePreset: (name: string) => presetApi().save(name),
    deletePreset: (name: string) => presetApi().del(name),
    notes: () => knobsAsNotes(),
    reset: () => { resetKnobs(); return 'every knob back to authored defaults'; },
    /** One tab's worth — the same scope the panel's RESET button uses. */
    resetTab: (group: string) => {
      if (!knobGroups().includes(group)) return `no group '${group}' — try ${knobGroups().join(', ')}`;
      resetKnobs(group);
      return `${group} back to authored defaults`;
    },
    ab: () => toggleKnobsShowing(),
  };
}

/** Current settings as a URL query, so a look found by dragging can be shared
 *  or pasted back. Only values that differ from what the CODE declares —
 *  compared against `authored`, not `initial`, so the export is "everything I
 *  changed from the shipped look" and not "everything I changed since the page
 *  loaded", which would come out empty on the reload after a good session. */
export function knobsAsQuery(): string {
  const parts: string[] = [];
  for (const k of knobs.values()) {
    const v = k.get();
    if (Math.abs(v - k.authored) > 1e-6) parts.push(`${k.spec.id}=${+v.toFixed(4)}`);
  }
  return parts.join('&');
}

/** The same set, written for a HUMAN — group, label and value, one per line.
 *  The query string is what a browser needs; this is what you paste into a
 *  message when the point is to say what you want changed. */
export function knobsAsNotes(): string {
  const rows: string[] = [];
  for (const k of knobs.values()) {
    const v = k.get();
    if (Math.abs(v - k.authored) > 1e-6) {
      rows.push(`${k.spec.group} · ${k.spec.label}: ${+v.toFixed(3)}  (was ${+k.authored.toFixed(3)})`);
    }
  }
  return rows.length ? rows.join('\n') : '(everything at defaults)';
}

// ── MINE vs DEFAULT ──────────────────────────────────────────────────────────
// Josh: *"a way to toggle between easily without it being complicated."*
//
// The comparison that matters while tuning is against the look you started
// from, and holding two states in your head while dragging eight sliders is
// exactly the thing an eye is bad at. So the panel keeps BOTH: `mine` is every
// value you have moved, and the authored defaults are always recoverable
// because they are declared in code and never overwritten.
//
// Flipping to DEFAULT does not discard anything — it applies the authored
// values without recording them, so flipping back restores your set intact.
// That is the whole reason recording is a separate call from `set` rather than
// something `set` does for you: the A/B has to move knobs WITHOUT it counting
// as an edit.
let showing: 'mine' | 'default' = 'mine';
export function knobsShowing(): 'mine' | 'default' { return showing; }

/** Record an edit into the saved set. The panel calls this when a SLIDER moves;
 *  programmatic sets (the A/B, a reset) deliberately do not. */
export function recordKnob(id: string, v: number): void {
  const k = knobs.get(id);
  if (!k) return;
  if (Math.abs(v - k.authored) < 1e-6) delete mine[id];
  else mine[id] = v;
  persist();
  showing = 'mine';
}

/** Flip between your set and the shipped defaults. Returns what is now showing. */
export function toggleKnobsShowing(): 'mine' | 'default' {
  showing = showing === 'mine' ? 'default' : 'mine';
  for (const k of knobs.values()) {
    const target = showing === 'default' ? k.authored : (mine[k.spec.id] ?? k.authored);
    if (Math.abs(k.get() - target) > 1e-6) k.set(target);
  }
  return showing;
}

/** Throw the saved set away and go back to what the code declares. */
/** Throw the saved set away and go back to what the code declares.
 *
 *  Scoped to ONE GROUP when given one. Josh: *"can you make the reset just reset
 *  the tab."* Right call — the panel is used one surface at a time, and a button
 *  sitting under the Wall tab that silently discards your Floor work as well is
 *  the kind of thing you only discover by losing something. The blast radius of
 *  a destructive control should match what you can see when you press it.
 *
 *  No argument still resets everything; that is what window.__tune.reset() uses,
 *  and it is the escape hatch for wiping a whole session's set at once. */
export function resetKnobs(group?: string): void {
  showing = 'mine';
  for (const k of knobs.values()) {
    if (group !== undefined && k.spec.group !== group) continue;
    delete mine[k.spec.id];
    if (Math.abs(k.get() - k.authored) > 1e-6) k.set(k.authored);
  }
  persist();
}

/** How many values are currently moved off the shipped defaults — the panel
 *  shows it so "I have a set" is visible without opening every tab. */
export function knobsChangedCount(): number {
  let n = 0;
  for (const k of knobs.values()) if (Math.abs(k.get() - k.authored) > 1e-6) n++;
  return n;
}
