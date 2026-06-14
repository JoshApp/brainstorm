// Game event bus. In-world systems emit events here; the broadcast layer
// (achievements, future LLM narration, future audience reactions) subscribes.
//
// This is the architectural seam that keeps the snarky DCC tribute layer
// SEPARATE from the grimdark in-world experience, per CLAUDE.md Tone Layering.
// In-world code just emits "the player took damage" — it doesn't know or care
// that somewhere an AI announcer is making a joke about it.

export type GameEvent =
  | { type: 'attack:swing' }
  | { type: 'attack:hit'; damage: number; crit?: boolean; cls?: import('../content/items').WeaponClass }
  | { type: 'enemy:killed'; enemyId: string }
  | { type: 'player:damaged'; hpLeft: number; amount: number; attacker?: import('../ecs/types').EntityId }
  | { type: 'player:killed' }
  | { type: 'item:picked-up'; itemId: string; displayName?: string }
  | { type: 'note:read'; noteBody: string }
  | { type: 'room:cleared'; roomId: string }
  | { type: 'boss:engaged' }
  | { type: 'boss:defeated' }
  | { type: 'boss:phase'; phase: number }
  | { type: 'level:loaded'; levelId: string }
  | { type: 'encounter:activated'; id: string }
  | { type: 'encounter:complete'; id: string }
  // ── Gate lifecycle (a sealed/raised arena threshold) ──
  // Emitted by interactables/door.ts at the physical moments; the feedback
  // orchestrator (feedback/encounter-feedback.ts) turns each into its
  // sound + shake + dust stinger, and the future voice-in-the-deep can
  // notice a threshold being sealed on the same stream. Carry the world
  // position so subscribers can place positional audio + effects.
  | { type: 'gate:slam'; x: number; y: number; z: number }     // grate hit the floor
  | { type: 'gate:raise'; x: number; y: number; z: number }    // winch began lifting it
  | { type: 'gate:settle'; x: number; y: number; z: number }   // grate reached the top
  | { type: 'xp:absorbed' }
  | { type: 'gold:absorbed' }
  | { type: 'level:up'; level: number }
  | { type: 'starter:chosen'; weaponId: string }
  // ── Transactions (content/transactions.ts owns the grammar) ──
  // One stream for every deal the dungeon makes: blood altars, trials,
  // fountains, merchant buys, tithes. Subscribers: broadcast snark,
  // epitaphs, the future attention meter.
  | { type: 'transaction:offered';  family: import('../content/transactions').TransactionFamily; id: string }
  | { type: 'transaction:accepted'; family: import('../content/transactions').TransactionFamily; id: string;
      price: import('../content/transactions').TransactionPrice }
  | { type: 'transaction:resolved'; family: import('../content/transactions').TransactionFamily; id: string;
      outcome: import('../content/transactions').TransactionOutcome };

type Handler = (event: GameEvent) => void;

const handlers: Set<Handler> = new Set();

export function emit(event: GameEvent) {
  for (const h of handlers) h(event);
}

export function on(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
