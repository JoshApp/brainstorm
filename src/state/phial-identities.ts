import { TAINTED_MUTATIONS } from '../content/tainted-mutations';
import { gameRng } from '../engine/rng';

// Per-run PHIAL IDENTITIES — the Isaac-pill mechanic in DELVE's voice.
//
// Each phial item id (murky / black / pale) maps to ONE mutation for
// the whole run, rolled lazily on first taste. Until you drink one,
// the label tells you nothing; after the first, every phial of that
// color is a KNOWN, deliberate trade — find two more murky phials and
// you can stack the brand on purpose. The identity map persists with
// the run save (a reload doesn't re-roll your knowledge) and clears
// on a new run, so the gamble resets every descent.
//
// Identities avoid duplicates across phial colors where the pool
// allows, so three colors = three different bargains per run.

let identities: Record<string, string> = {};

/** Resolve (rolling if first taste) the mutation id behind a phial. */
export function phialMutationId(phialItemId: string): string {
  const known = identities[phialItemId];
  if (known) return known;
  const taken = new Set(Object.values(identities));
  const fresh = TAINTED_MUTATIONS.filter((m) => !taken.has(m.id));
  const pool = fresh.length > 0 ? fresh : TAINTED_MUTATIONS;
  const rolled = pool[Math.floor(gameRng() * pool.length)].id;
  identities[phialItemId] = rolled;
  return rolled;
}

/** Has this phial color been tasted (identity revealed) this run? */
export function isPhialKnown(phialItemId: string): boolean {
  return phialItemId in identities;
}

export function clearPhialIdentities(): void {
  identities = {};
}

export function serializePhialIdentities(): Record<string, string> {
  return { ...identities };
}

export function hydratePhialIdentities(map: Record<string, string> | undefined): void {
  identities = map ? { ...map } : {};
}
