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
  /** The value this knob started at, for the panel's reset. */
  readonly initial: number;
}

const knobs = new Map<string, Knob>();
const rebakeHooks = new Set<() => void>();
const changeHooks = new Set<(k: Knob) => void>();

/** Seed from the URL so every existing ?param= keeps working unchanged. */
function seed(id: string, dflt: number, min: number, max: number): number {
  if (!DEV || typeof window === 'undefined') return dflt;
  const v = new URLSearchParams(window.location.search).get(id);
  if (v == null) return dflt;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
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
    get,
    set(v: number) {
      const c = Math.max(spec.min, Math.min(spec.max, v));
      set(c);
      if (apply === 'rebake') for (const h of rebakeHooks) h();
      for (const h of changeHooks) h(knob);
    },
  };
  set(initial);
  knobs.set(spec.id, knob);
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

/** Run whenever a 'rebake' knob moves — regenerate the CPU textures here. */
export function onRebake(fn: () => void): void { rebakeHooks.add(fn); }
/** Run on ANY knob change — the panel uses this to keep its readouts honest. */
export function onKnobChange(fn: (k: Knob) => void): void { changeHooks.add(fn); }

export function listKnobs(): Knob[] { return [...knobs.values()]; }
export function knobGroups(): string[] {
  return [...new Set([...knobs.values()].map((k) => k.spec.group))];
}
export function getKnob(id: string): Knob | undefined { return knobs.get(id); }

/** Current settings as a URL query, so a look found by dragging can be shared
 *  or pasted back — the panel's "copy" button. Only non-default values. */
export function knobsAsQuery(): string {
  const parts: string[] = [];
  for (const k of knobs.values()) {
    const v = k.get();
    if (Math.abs(v - k.initial) > 1e-6) parts.push(`${k.spec.id}=${+v.toFixed(4)}`);
  }
  return parts.join('&');
}
