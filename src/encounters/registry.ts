import * as THREE from 'three';
import { emit, on } from '../broadcast/event-bus';

// Encounter layer — the one abstraction that boss fights, arena gauntlets,
// room-clear gates, rituals, and ambushes all collapse into. An Encounter is
// a region/trigger-scoped stateful process with a lifecycle:
//
//   dormant ──activate()──▶ active ──complete()──▶ complete
//
// While ACTIVE it ticks its own logic (waves, phases, a timer); on the
// transitions it emits bus events so REACTORS (a gate sealing, music swapping,
// lighting reddening, a reward spawning) can bind to it declaratively instead
// of every consumer hand-rolling its own "is it done yet?" polling + globals.
//
// This file owns the primitive + the registry + the reactor helpers. Specific
// encounters (see level/arena-waves.ts) supply a Behavior; nothing here knows
// about waves or bosses.
//
// Migration status: the arena is the first user. boss-encounter.ts / room-clear
// / fog-gate are intended to fold in next (each becomes a Behavior).

export type EncounterState = 'dormant' | 'active' | 'complete';

/** The encounter-specific logic. The registry owns state + events; the
 *  behavior owns what the encounter DOES. `tick` runs only while active.
 *  The behavior calls `handle.complete()` when its work is finished. */
export interface EncounterBehavior {
  onActivate?(): void;
  tick?(dt: number, playerPos: THREE.Vector3): void;
  onComplete?(): void;
}

export interface EncounterHandle {
  readonly id: string;
  state(): EncounterState;
  /** Mark the encounter resolved (idempotent). Behaviors call this. */
  complete(): void;
}

interface Entry {
  id: string;
  state: EncounterState;
  behavior: EncounterBehavior;
}

const encounters = new Map<string, Entry>();

/** Register an encounter (starts dormant). Returns a handle the behavior uses
 *  to mark itself complete. Re-registering an id replaces it (level rebuild). */
export function registerEncounter(id: string, behavior: EncounterBehavior): EncounterHandle {
  const entry: Entry = { id, state: 'dormant', behavior };
  encounters.set(id, entry);
  return {
    id,
    state: () => entry.state,
    complete() {
      if (entry.state === 'complete') return;
      entry.state = 'complete';
      emit({ type: 'encounter:complete', id });
      entry.behavior.onComplete?.();
    },
  };
}

export function hasEncounter(id: string): boolean {
  return encounters.has(id);
}

export function encounterState(id: string): EncounterState | null {
  return encounters.get(id)?.state ?? null;
}

export function isEncounterActive(id: string): boolean {
  return encounters.get(id)?.state === 'active';
}

/** A dormant or unknown encounter reports NOT-complete; only a resolved one is
 *  complete. (Callers gating on completion want `false` until it truly ends.) */
export function isEncounterComplete(id: string): boolean {
  return encounters.get(id)?.state === 'complete';
}

/** Fire the trigger: dormant → active (idempotent). */
export function activateEncounter(id: string): void {
  const e = encounters.get(id);
  if (!e || e.state !== 'dormant') return;
  e.state = 'active';
  emit({ type: 'encounter:activated', id });
  e.behavior.onActivate?.();
}

/** Tick every ACTIVE encounter. Called once per frame from the system loop. */
export function tickEncounters(dt: number, playerPos: THREE.Vector3): void {
  for (const e of encounters.values()) {
    if (e.state === 'active') e.behavior.tick?.(dt, playerPos);
  }
}

/** Wipe on level teardown so a new floor's encounters start fresh. */
export function clearEncounters(): void {
  encounters.clear();
}

// ── Reactor helpers ──────────────────────────────────────────────────────
// Declarative-ish bindings on top of the bus. A reactor reacts to an
// encounter's lifecycle without polling. Returns an unsubscribe fn.

export function onEncounterActivated(id: string, cb: () => void): () => void {
  return on((e) => { if (e.type === 'encounter:activated' && e.id === id) cb(); });
}

export function onEncounterComplete(id: string, cb: () => void): () => void {
  return on((e) => { if (e.type === 'encounter:complete' && e.id === id) cb(); });
}
