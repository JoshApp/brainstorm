// The RELIQUARY (docs/BUILD-ECONOMY.md) — relics you COLLECT, not equip. Every
// relic here applies AT ONCE: no slots, no cap, no management (the Isaac/RoR2
// stacking model). This is the build variance — you accrete a machine rather
// than juggle equip slots. The stat pipeline (combat/modifiers.ts) and
// getPlayerOnHits (equipment.ts) read this as one more uncapped source alongside
// the three gear slots (weapon / offhand / vestment).

import type { ItemSpec } from '../content/items';
import type { AffixInstance } from '../content/affixes';

export interface RelicEntry { spec: ItemSpec; affixes: AffixInstance[]; }

let relics: RelicEntry[] = [];
type Listener = (r: readonly RelicEntry[]) => void;
const listeners = new Set<Listener>();
function notify(): void { for (const l of listeners) l(relics); }

/** Collect a relic — it applies immediately and permanently (never displaces). */
export function addRelic(spec: ItemSpec, affixes: AffixInstance[] = []): void {
  relics.push({ spec, affixes });
  notify();
}

/** Every collected relic, in pickup order (the reliquary display + the stat
 *  pipeline iterate this whole array — that's why they all apply). */
export function getReliquary(): readonly RelicEntry[] { return relics; }

/** Wipe the reliquary (new run / death). */
export function clearReliquary(): void { relics = []; notify(); }

export function onReliquaryChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
