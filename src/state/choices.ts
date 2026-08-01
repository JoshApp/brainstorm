import { on } from '../broadcast/event-bus';
import { ITEMS } from '../content/items';
import type { DomainId } from '../content/domains';

// THE LEDGER OF CHOICES — what you took at a fork, and what you turned down. The
// dungeon keeps score of both: every offering ACCEPTED (a taken relic, a bought
// ware) and every one DECLINED (walked away from, abandoned on descent) lands
// here, tagged with its domain. It's the memory the deep draws on — "you have
// refused the blood three times now" — and a seam a later system can read to
// bend the run toward (or against) what you keep choosing. Recorded off the
// transaction grammar (transaction:resolved / :declined), so any event that
// makes an offer feeds it for free. (Kept THREE-free so it's node-testable.)
//
// Cleared by startNewRun, serialized by commitFloorEntry, rehydrated on reload —
// same lifetime contract as run-mutations.ts.

export type Decision = 'taken' | 'declined';

export interface Choice {
  itemId: string;
  domain: DomainId | 'cursed' | null;
  decision: Decision;
}

let choices: Choice[] = [];

function domainOf(itemId: string): DomainId | 'cursed' | null {
  const spec = ITEMS[itemId];
  if (!spec) return null;
  if (spec.domain) return spec.domain;
  return spec.rarity === 'cursed' ? 'cursed' : null;
}

function record(itemId: string, decision: Decision): void {
  if (!ITEMS[itemId]) return;   // only real items are choices worth remembering
  choices.push({ itemId, domain: domainOf(itemId), decision });
}

// Wire once at module load — the transaction stream is always live.
on((e) => {
  if (e.type === 'transaction:resolved') {
    for (const id of e.outcome.itemIds ?? []) record(id, 'taken');
  } else if (e.type === 'transaction:declined') {
    if (e.itemId) record(e.itemId, 'declined');
  }
});

/** Every choice this run, in order. */
export function getChoices(): readonly Choice[] { return choices; }

/** The items refused this run (walked-away offerings). */
export function getDeclined(): Choice[] { return choices.filter((c) => c.decision === 'declined'); }

/** How many offerings of a domain the player has DECLINED (the refusal count the
 *  deep taunts with). Pass a decision to count takes instead. */
export function countByDomain(domain: DomainId | 'cursed', decision: Decision = 'declined'): number {
  return choices.filter((c) => c.domain === domain && c.decision === decision).length;
}

export function clearChoices(): void { choices = []; }

export function serializeChoices(): Choice[] { return choices.map((c) => ({ ...c })); }

export function hydrateChoices(saved: readonly Choice[] | undefined): void {
  choices = Array.isArray(saved) ? saved.map((c) => ({ ...c })) : [];
}
