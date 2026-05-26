// Game event bus. In-world systems emit events here; the broadcast layer
// (achievements, future LLM narration, future audience reactions) subscribes.
//
// This is the architectural seam that keeps the snarky DCC tribute layer
// SEPARATE from the grimdark in-world experience, per CLAUDE.md Tone Layering.
// In-world code just emits "the player took damage" — it doesn't know or care
// that somewhere an AI announcer is making a joke about it.

export type GameEvent =
  | { type: 'attack:swing' }
  | { type: 'attack:hit'; damage: number }
  | { type: 'enemy:killed' }
  | { type: 'player:damaged'; hpLeft: number }
  | { type: 'player:killed' }
  | { type: 'item:picked-up'; itemId: string }
  | { type: 'room:cleared'; roomId: string }
  | { type: 'level:loaded'; levelId: string };

type Handler = (event: GameEvent) => void;

const handlers: Set<Handler> = new Set();

export function emit(event: GameEvent) {
  for (const h of handlers) h(event);
}

export function on(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
