import type { Entity, EntityId } from './types';

// Singleton entity registry. One process, one world.
//
// For prototype scale (single player, ~10 active entities at a time) a Map
// keyed by EntityId is plenty. If we ever need spatial queries or massive
// entity counts, switch to a proper ECS lib then.

const entities = new Map<EntityId, Entity>();

let nextAutoId = 0;

export function generateEntityId(prefix: string): EntityId {
  return `${prefix}-${nextAutoId++}`;
}

export function spawn(entity: Entity): EntityId {
  entities.set(entity.id, entity);
  return entity.id;
}

export function destroy(id: EntityId): void {
  entities.delete(id);
}

export function get(id: EntityId): Entity | undefined {
  return entities.get(id);
}

export function* all(): IterableIterator<Entity> {
  yield* entities.values();
}

export function clear(): void {
  entities.clear();
  nextAutoId = 0;
}
