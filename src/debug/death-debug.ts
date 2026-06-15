import { DEV } from './dev';

// DEV toggle for inspecting the death RECLAIM beat.
//
// Shipped behaviour pulls a dissolving corpse + its bone pieces UNDER the floor
// (the "dungeon takes the husk" look) while the shader dissolves them — but the
// sink can hide the dissolve if you want to study it. Flip this off to let
// everything dissolve IN PLACE so the shader + dust read fully.
//
// Default ON = production behaviour. DEV-gated: the window hook is stripped from
// the live build, and `getDeathSink()` constant-folds toward the shipped path.
let deathSink = true;

export function getDeathSink(): boolean { return deathSink; }
export function setDeathSink(on: boolean): void { deathSink = on; }

if (DEV) {
  (window as unknown as { __death?: unknown }).__death = {
    /** __death.sink(false) → corpses/bones dissolve in place; sink(true) restores. */
    sink: (on = true) => { setDeathSink(on); return `death sink ${on ? 'ON' : 'OFF'}`; },
  };
}
