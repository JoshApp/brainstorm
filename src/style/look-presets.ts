import * as THREE from 'three';
import { CONFIG } from '../config';
import { setActiveGrade, setGradeOverrides } from './grade-presets';
import {
  setWebGPUBrightness, setWebGPUDarkAdapt, setWebGPULegibility,
  setWebGPUBloomEnabled, setWebGPULeanBloom, setWebGPUInscatterEnabled,
  setWebGPUDepthCrushEnabled, setSSAO, setWebGPUInk,
} from './render-webgpu';
import { installBandedLightingWebGPU, setLeanLightingWebGPU } from './banded-lighting-webgpu';
import { setPS1Scale } from './render-frame';

// ── A LOOK IS A THING YOU CAN NAME ───────────────────────────────────────────
//
// Josh, asking how studios find an art style: *"can we make it so this process
// is rather quick than having to fully implement it all the time? so we can
// quickly prototype and then take what looks good."*
//
// The reason that was slow is that a LOOK was not an object. The knobs that
// decide how DELVE looks are real and they are all reachable at runtime —
// grade, fog, banding, bloom, SSAO, inscatter, depth crush, render scale,
// brightness — but they live in six modules and are set by six different
// callers, so trying a look meant editing code in six places and trying two
// looks meant remembering what you changed.
//
// So: one struct, a registry of them, and one function that applies one. Now a
// look is DATA. Authoring a new one is a literal you add below; comparing eight
// of them is one command (`npm run delve look --sheet`); and nothing has to be
// "fully implemented" to be seen — you only implement the ones that survive.
//
// The rule that makes this a process rather than a settings menu: EVERY preset
// states what it is TRYING, in one line, in `note`. A variant you cannot
// summarise is a variant you cannot judge, and it dies on the sheet.
//
// A preset can only reach knobs that EXIST. When this file was written that
// excluded the highest-value lever — an INK contour on depth/normal
// discontinuity, the thing that makes composed primitives read as DRAWN rather
// than as untextured boxes. It is built now (render-webgpu.ts setWebGPUInk) and
// is a preset field like any other, which is the point of the whole exercise:
// the expensive part was deciding to try it, not wiring it in.

export interface LookPreset {
  id: string;
  /** Shown on the contact sheet. Keep it short — it goes under a thumbnail. */
  name: string;
  /** What this look is TRYING. One line. Required on purpose (see above). */
  note: string;

  /** Named colour grade (grade-presets.ts): baseline / coldfire / morkborg / ember. */
  grade?: string;
  /** Per-knob grade overrides on top of the named preset. */
  gradeOv?: {
    split?: number; blacks?: number; sat?: number;
    expo?: number; amber?: number; vig?: number; bloomth?: number;
  };

  /** Distance haze. `color` is the single biggest lever on the whole frame:
   *  black recedes into nothing, a tinted wash recedes into AIR. */
  fog?: { color?: number; near?: number; far?: number };

  /** Hard light banding — flat fills instead of gradients. */
  banded?: boolean;
  /** The cheap lighting model (fewer terms, flatter response). */
  lean?: boolean;

  bloom?: boolean;
  leanBloom?: boolean;
  /** false disables it outright; an object tunes it. */
  ssao?: { strength?: number; radius?: number } | false;
  inscatter?: boolean;
  depthCrush?: boolean;

  /** Scene render scale — the PS1 chunk. 1 = native, 0.35 = very lo-fi. */
  ps1?: number;

  brightness?: number;
  darkAdapt?: number;
  /** The daylight legibility curve (0 = darkest, 1 = full sun preset). */
  legibility?: number;

  /** CONTOUR. `strength` 0 = off (and the depth+normal G-buffer is not even
   *  rendered, so a look without ink pays nothing). `width` is in UV units, so
   *  the line keeps its weight across resolutions; `depth` and `normal` are how
   *  hard a silhouette step / a crease has to be before it inks. */
  ink?: { strength: number; width?: number; depth?: number; normal?: number };
}

/**
 * THE SET. Deliberately includes two CONTROLS — `current` (what ships today)
 * and `washed` (a known-bad) — because a sheet of eight plausible variants with
 * no anchor tells you which you prefer today, not which is better.
 */
export const LOOKS: Record<string, LookPreset> = {
  // ── CONTROLS ──────────────────────────────────────────────────────────────
  current: {
    id: 'current', name: 'CURRENT', note: 'What ships today. The anchor — judge everything against this.',
  },
  washed: {
    id: 'washed', name: 'WASHED (bad)', note: 'Deliberately wrong: bright, flat, far fog. The floor of the comparison.',
    grade: 'baseline', gradeOv: { expo: 0.75, sat: 0.7, blacks: 0.0, vig: 0.05 },
    fog: { color: 0x2a2a30, near: 6, far: 40 }, brightness: 1.4, legibility: 0.9,
  },

  // ── THE HOLLOW-KNIGHT-ADJACENT BUNDLE, IN PIECES ──────────────────────────
  // Each isolates ONE idea so the sheet says which idea is doing the work.
  flatfill: {
    id: 'flatfill', name: 'FLAT FILL', note: 'Hard banding + lean lighting: forms as flat fills, not gradients.',
    banded: true, lean: true, ssao: false,
    gradeOv: { sat: 0.9, blacks: 0.06 },
  },
  colouredair: {
    id: 'colouredair', name: 'COLOURED AIR', note: 'Distance fades to a desaturated hue, not to black — depth as atmosphere.',
    fog: { color: 0x2b2430, near: 3, far: 16 },
    gradeOv: { sat: 1.05, vig: 0.3 },
  },
  boneink: {
    id: 'boneink', name: 'BONE INK', note: 'Mörk Borg grade, crushed blacks, tight fog — near-black silhouettes on bone.',
    grade: 'morkborg', gradeOv: { blacks: 0.12, sat: 0.45, vig: 0.42 },
    fog: { color: 0x0a0a0c, near: 2, far: 11 }, banded: true,
  },
  drawn: {
    id: 'drawn', name: 'DRAWN', note: 'The full pitch: ink contour + banded fills + coloured air + crushed blacks.',
    grade: 'morkborg', gradeOv: { blacks: 0.10, sat: 0.7, vig: 0.34 },
    fog: { color: 0x241f2b, near: 2.5, far: 15 },
    banded: true, lean: true, ssao: false, leanBloom: true,
    ink: { strength: 0.85, width: 0.0016, depth: 2.2, normal: 1.0 },
  },

  // ── INK, ISOLATED ─────────────────────────────────────────────────────────
  // On its own against the CURRENT look, so the sheet can answer the actual
  // question — is the contour doing the work, or is it the banding and the fog?
  ink: {
    id: 'ink', name: 'INK ONLY', note: 'Contour alone, everything else as it ships. Is the LINE doing the work?',
    ink: { strength: 0.85, width: 0.0016, depth: 2.2, normal: 1.0 },
  },
  inkheavy: {
    id: 'inkheavy', name: 'INK HEAVY', note: 'A fatter, more willing line — where does it stop reading as drawn and start as noise?',
    ink: { strength: 1.0, width: 0.0028, depth: 1.4, normal: 0.7 },
  },

  // ── SIGNATURE SWINGS ──────────────────────────────────────────────────────
  voidedge: {
    id: 'voidedge', name: 'VOID', note: 'Very short fog to pure black: the world is drawn into being around the lamp.',
    fog: { color: 0x000000, near: 1.0, far: 6.5 },
    gradeOv: { blacks: 0.16, vig: 0.5, expo: 0.42 }, banded: true,
  },
  deepcold: {
    id: 'deepcold', name: 'DEEP COLD', note: 'Cold wash + banding — what a lower act could look like if hue means depth.',
    grade: 'coldfire', gradeOv: { sat: 0.85, vig: 0.34 },
    fog: { color: 0x101a26, near: 2.5, far: 14 }, banded: true, lean: true,
  },
  emberwarm: {
    id: 'emberwarm', name: 'EMBER', note: 'Warm wash — the same idea as DEEP COLD, opposite end of the act palette.',
    grade: 'ember', gradeOv: { sat: 1.0, vig: 0.3 },
    fog: { color: 0x241410, near: 2.5, far: 14 }, banded: true, lean: true,
  },
  chunky: {
    id: 'chunky', name: 'CHUNKY', note: 'Lo-fi render scale against the flat-fill lighting — does coarseness help or hide?',
    ps1: 0.42, banded: true, lean: true, ssao: false,
    gradeOv: { sat: 0.85, blacks: 0.08 },
  },
};

/** Ids in the order the contact sheet should read — controls first. */
export const LOOK_ORDER: readonly string[] = [
  'current', 'ink', 'drawn', 'inkheavy',
  'flatfill', 'colouredair', 'boneink', 'voidedge',
  'deepcold', 'emberwarm', 'chunky', 'washed',
];

/**
 * Put a look on the running game.
 *
 * Applies the FULL surface every time — a field the preset omits is reset to
 * the game's default rather than left wherever the previous preset put it.
 * Without that, flipping between looks in one session silently compounds them
 * and the sheet is a lie: cell 5 would be "preset 5 on top of whatever 4 did."
 */
export function applyLook(id: string, scene: THREE.Scene): boolean {
  const look = LOOKS[id];
  if (!look) return false;

  setActiveGrade(look.grade ?? 'baseline');
  setGradeOverrides(look.gradeOv ?? {}, true);   // replace, don't merge

  const fog = scene.fog;
  if (fog instanceof THREE.Fog) {
    fog.color.setHex(look.fog?.color ?? CONFIG.FOG_COLOR);
    fog.near = look.fog?.near ?? CONFIG.FOG_NEAR;
    fog.far = look.fog?.far ?? CONFIG.FOG_FAR;
  }

  installBandedLightingWebGPU(look.banded ?? false);
  setLeanLightingWebGPU(look.lean ?? false);
  setWebGPUBloomEnabled(look.bloom ?? true);
  setWebGPULeanBloom(look.leanBloom ?? false);
  setWebGPUInscatterEnabled(look.inscatter ?? true);
  setWebGPUDepthCrushEnabled(look.depthCrush ?? true);
  if (look.ssao === false) setSSAO(0);
  else setSSAO(look.ssao?.strength, look.ssao?.radius);
  setPS1Scale(look.ps1 ?? 1);
  setWebGPUBrightness(look.brightness ?? 1);
  setWebGPUDarkAdapt(look.darkAdapt ?? 1);
  if (look.legibility !== undefined) setWebGPULegibility(look.legibility);
  setWebGPUInk(look.ink?.strength ?? 0, look.ink);

  return true;
}
