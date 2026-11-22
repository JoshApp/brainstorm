// A set-piece enemy's PHASES and SUMMON GATE.
//
// Phases (spec.phases): a boss's HP is the CURRENT phase's pool. Emptying it
// enters the next phase instead of dying — refill, new abilities, maybe hidden
// parts and a lower rig — behind a short invulnerability window, optionally
// played as a collapse (the skeleton's downed fall). Part breaks hide named
// parts at HP thresholds within a phase.
//
// Summon gate (spec.summonGate): the boss spits ONE add per HP threshold and is
// untouchable only for the brief spit itself.
//
// Split out of createEnemy (Phase 3, docs/OPEN-ITEMS.md). It owns the phase and
// summon state; the enemy-side consequences of a phase change (abilities, poise,
// the AI state) come back through `hooks`. tests/enemy-golden.test.ts pins it
// (the boiling king's summons, the marrow sovereign's phase change).

import * as THREE from 'three';
import type { EnemySpec } from '../content/enemies';
import type { BuiltModel } from '../ecs/build-model';
import type { Creature } from '../content/creature-types';
import type { SkinnedCreature } from './creature-skinned';
import type { CoreReactor } from './enemy-presentation';
import type { Enemy } from './enemy';
import { playEnemyWindup, playSurfaceHit } from '../audio/sfx';
import { kickShake } from '../combat/screen-shake';

type PhaseSpec = NonNullable<EnemySpec['phases']>[number];
type SummonGate = NonNullable<EnemySpec['summonGate']>;

export interface BossPhaseParts {
  spec: EnemySpec;
  built: BuiltModel;
  container: THREE.Group;
  creature: Creature | null;
  skinned: SkinnedCreature;
  coreReactor: CoreReactor;
  /** The rig node a phase lowers / tilts (falls back to built.group). */
  tiltPart: THREE.Object3D | undefined;
  /** The builder's hook that spawns a summon gate's brood into the level. */
  onSummon?: (gate: SummonGate, atPos: THREE.Vector3) => Enemy[];
}

export interface BossPhaseHooks {
  /** Before anything changes — clear what the dying-into-next-phase ability held open. */
  leaving(): void;
  /** The new phase is in place: the enemy takes its abilities, HP, poise and AI state. */
  entered(next: PhaseSpec): void;
}

export interface BossPhases {
  /** The current phase's index (0 for a single-phase enemy). */
  readonly index: number;
  /** Number of phases (1 for a single-phase enemy). */
  readonly count: number;
  /** The current phase's spec, or null for a single-phase enemy. */
  readonly current: PhaseSpec | null;
  /** The CURRENT phase's HP pool (spec.hp for a single-phase enemy). */
  readonly maxHp: number;
  /** HP and abilities at spawn: phase 0's, else the spec's. */
  readonly initialHp: number;
  readonly initialAbilities: NonNullable<EnemySpec['abilities']>;
  /** In a phase-entry window: takes no damage, no poise. */
  readonly phaseInvulnerable: boolean;
  /** Mid-spit: blows clang off. */
  readonly summonInvulnerable: boolean;
  /** HP ran out: is there a next phase to enter instead of dying? */
  hasNextPhase(): boolean;
  /** Enter the next phase. `animate` plays the collapse over the invuln
   *  window (the real fight); false snaps to the settled pose (debug). */
  enterNext(animate: boolean): void;
  /** Spit every add whose threshold this HP has crossed. */
  fireCrossedSummons(hpNow: number): void;
  /** Hide the parts of every part-break threshold this HP has crossed. */
  breakCrossedParts(hpNow: number): void;
  /** The clang of a blow landing mid-spit (no wound, no wound-cry). */
  summonHitReact(): void;
  /** Advance the timers and the collapse. True while the collapse plays:
   *  the enemy is inert for that frame. */
  tick(dt: number): boolean;
  /** DEV: step straight to phase `index`, settled, out of any invuln. */
  debugJumpTo(index: number): void;
}

export function createBossPhases(parts: BossPhaseParts, hooks: BossPhaseHooks): BossPhases {
  const { spec, built, container, creature, skinned, coreReactor, tiltPart, onSummon } = parts;
  const phases = spec.phases ?? null;
  const initialHp = phases ? phases[0].hp : spec.hp;
  const initialAbilities = phases ? phases[0].abilities : (spec.abilities ?? []);

  let index = 0;
  let maxHp = initialHp;
  // Per-phase partBreaks: which thresholds have fired, so parts aren't
  // re-hidden every hit. Reset on phase entry.
  let firedPartBreaks = new Set<number>();
  let phaseInvulnTimer = 0;
  // Phase-transition COLLAPSE (the skeleton's downed fall). While active the
  // boss is inert (no AI) AND invulnerable, and the rig EASES to the new
  // phase's crawl pose instead of snapping there — so the transition reads as
  // a fall, not a teleport.
  let fallActive = false;
  let fallElapsed = 0;
  let fallDuration = 0;
  let fallNode: THREE.Object3D | null = null;
  let fallFromY = 0, fallToY = 0;
  let fallFromPitch = 0, fallToPitch = 0;

  // SUMMON GATE — fires as HP first drops to/below each threshold: the boss
  // spits its brood (onSummon) and is untouchable ONLY for a brief invuln
  // window covering the spit itself — like a phase transition. The instant the
  // window closes it's vulnerable again, even with the brood still alive. See
  // the summonGate doc in enemy-types.ts.
  const gate = spec.summonGate ?? null;
  let summonsFired = 0;   // adds spat so far — one per HP threshold
  let summonInvulnTimer = 0;

  // Hide named model parts. A single logical part (a whole leg) is authored as
  // MANY primitives sharing one `name`, but built.parts is a Map (one entry per
  // name) — so traverse the live tree and hide EVERY object with a matching
  // name, not just the one the map kept. Without this, "hide the legs" only
  // dropped a single foot bone. Unknown names are silent no-ops.
  function hidePartsByName(names: readonly string[]): void {
    const want = new Set(names);
    // Creature path: names are JOINTs — hide the joint subtree + its zones
    // (the clean part-break). Legacy path: traverse + hide meshes by name.
    if (creature) {
      for (const n of names) {
        creature.setJointVisible(n, false);
        skinned.severBone(n);   // collapse the limb out of the skinned mesh
      }
    }
    built.group.traverse((o) => {
      if (o.name && want.has(o.name)) o.visible = false;
    });
  }

  function hasNextPhase(): boolean {
    return !!phases && index + 1 < phases.length;
  }

  function enterNext(animate: boolean): void {
    if (!phases || index + 1 >= phases.length) return;
    hooks.leaving();
    const next = phases[index + 1];
    index++;
    maxHp = next.hp;
    firedPartBreaks = new Set();
    phaseInvulnTimer = animate ? (next.invulnEntryTime ?? 0) : 0;
    if (next.hideParts) hidePartsByName(next.hideParts);
    if (next.rigYOffset !== undefined || next.rigPitch !== undefined) {
      // Lower / tilt the RIG node (not built.group): the per-frame pose bob
      // OWNS built.group.position.y and would clobber an offset there. The
      // rig's position.y is bob-safe; pitch goes on built.group (also safe).
      const node = tiltPart ?? built.group;
      if (animate) {
        fallNode = node;
        fallFromY = node.position.y;
        fallToY = node.position.y + (next.rigYOffset ?? 0);
        fallFromPitch = built.group.rotation.x;
        fallToPitch = next.rigPitch ?? built.group.rotation.x;
        fallElapsed = 0;
        // Fall across the invuln window so he's untouchable + inert as he
        // drops, then rises as the crawler. Floor at 0.4s for readability.
        fallDuration = Math.max(0.4, next.invulnEntryTime ?? 0.8);
        fallActive = true;
      } else {
        // Instant settle — snap the model to the new phase's crawl pose.
        node.position.y += next.rigYOffset ?? 0;
        if (next.rigPitch !== undefined) built.group.rotation.x = next.rigPitch;
        fallActive = false;
      }
    }
    hooks.entered(next);
  }

  // Thresholds step down evenly from atHpFrac (count=3, atHpFrac=0.75 → 0.75,
  // 0.5, 0.25). The Nth-add threshold: atHpFrac * (count - summonsFired) / count.
  function nextSummonThreshold(): number {
    if (!gate) return -1;
    return gate.atHpFrac * (gate.count - summonsFired) / gate.count;
  }

  function fireSummon(): void {
    if (!gate || summonsFired >= gate.count) return;
    const spawned = onSummon ? onSummon(gate, container.position.clone()) : [];
    if (spawned.length === 0) return;   // nothing spawned — no split beat, stay vulnerable
    summonsFired++;
    summonInvulnTimer = gate.invulnTime ?? 0.9;
    coreReactor.hit();                                   // a bright flare as it splits
    playEnemyWindup('medium', container.position);       // a summoning roar
    playSurfaceHit('metal', container.position);         // the split rings out
    kickShake(0.26, 0.45);
  }

  // `while` so a big hit that vaults two thresholds still owes both adds; never
  // on a killing blow (the lowest threshold is well above 0).
  function fireCrossedSummons(hpNow: number): void {
    while (gate && summonsFired < gate.count && hpNow > 0
        && hpNow <= maxHp * nextSummonThreshold()) {
      fireSummon();
    }
  }

  function breakCrossedParts(hpNow: number): void {
    if (!phases) return;
    const phase = phases[index];
    if (!phase.partBreaks) return;
    for (let i = 0; i < phase.partBreaks.length; i++) {
      if (firedPartBreaks.has(i)) continue;
      if (hpNow <= phase.partBreaks[i].atHp) {
        firedPartBreaks.add(i);
        hidePartsByName(phase.partBreaks[i].hideParts);
      }
    }
  }

  // Split-window hit feedback: the blow glances off mid-spit. A metallic clang +
  // a whisper of shake, but NO core flare / wound-cry (those read as "I hurt it").
  function summonHitReact(): void {
    playSurfaceHit('metal', container.position);
    kickShake(0.06, 0.12);
  }

  function tick(dt: number): boolean {
    // Phase entry invuln window (e.g. skeleton's downed → crawl rise).
    if (phases && phaseInvulnTimer > 0) phaseInvulnTimer = Math.max(0, phaseInvulnTimer - dt);

    // Summon-gate split window: tick the brief invuln down; when it closes the
    // core flares open to signal "vulnerable again". The boss keeps fighting
    // throughout — the window only blocks damage, not AI.
    if (summonInvulnTimer > 0) {
      summonInvulnTimer = Math.max(0, summonInvulnTimer - dt);
      if (summonInvulnTimer === 0) coreReactor.hit();
    }

    // Phase-transition collapse — ease the body into the crawl pose while
    // he's down. He's INERT here (the caller skips all AI/movement/abilities)
    // and already invulnerable (the invuln gate above), so the fall plays out
    // untouched, then normal AI resumes as the crawler.
    if (fallActive && fallNode) {
      fallElapsed += dt;
      const t = fallDuration > 0 ? Math.min(1, fallElapsed / fallDuration) : 1;
      const e = t * t;   // ease-IN: knees buckle slow, then he drops fast
      fallNode.position.y = fallFromY + (fallToY - fallFromY) * e;
      built.group.rotation.x = fallFromPitch + (fallToPitch - fallFromPitch) * e;
      if (t >= 1) {
        fallNode.position.y = fallToY;
        built.group.rotation.x = fallToPitch;
        fallActive = false;
      }
      return true;
    }
    return false;
  }

  function debugJumpTo(target: number): void {
    if (!phases) return;
    // Step instantly up to the target phase (settled poses, no animation).
    while (index < target && index + 1 < phases.length) enterNext(false);
    phaseInvulnTimer = 0;   // a posed phase shouldn't be mid-invuln
  }

  return {
    get index() { return index; },
    get count() { return phases ? phases.length : 1; },
    get current() { return phases ? phases[index] : null; },
    get maxHp() { return maxHp; },
    initialHp,
    initialAbilities,
    get phaseInvulnerable() { return phaseInvulnTimer > 0; },
    get summonInvulnerable() { return summonInvulnTimer > 0; },
    hasNextPhase,
    enterNext,
    fireCrossedSummons,
    breakCrossedParts,
    summonHitReact,
    tick,
    debugJumpTo,
  };
}
