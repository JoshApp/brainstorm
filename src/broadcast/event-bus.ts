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
  | { type: 'level:loaded'; levelId: string }
  | { type: 'xp:absorbed' }
  | { type: 'gold:absorbed' }
  | { type: 'level:up'; level: number }
  | { type: 'starter:chosen'; weaponId: string };

type Handler = (event: GameEvent) => void;

const handlers: Set<Handler> = new Set();

export function emit(event: GameEvent) {
  for (const h of handlers) h(event);
}

export function on(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
