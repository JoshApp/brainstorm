// WHICH LEVEL SPECS ARE DISPOSABLE — the bookkeeping behind the run-start reset.
//
// The loader caches every spec it gets from `generate()` into the shared LEVELS
// registry, so a stairs.targetLevel pointing back at the current floor resolves
// to the same spec within a run. Across runs that cache is wrong: run 2 would
// ask for 'depth-1', hit run 1's entry, and replay that floor despite a fresh
// seed. So run start drops the generated floors.
//
// THE RULE: only the loader knows what it generated, so only what it generated
// may be dropped. This used to be inferred instead — a snapshot of the registry
// keys taken at loader init, with everything else treated as generated. That
// quietly means "registered late = disposable", and every PER-RUN authored level
// is registered late by construction. The starter chamber rolls three weapons
// and picks its stair target per run, so main.ts writes LEVELS['starter'] on
// each descend; startRun() then reset before loading it, the chamber was
// deleted, the loader fell through to procgen, and every run opened on a
// generated depth-0 floor instead of the weapon-select chamber.
//
// Tracking the ids we actually cached makes registration order irrelevant.
// Lives in its own file so the rule is testable without dragging the loader's
// import graph (and its font assets) into a node test.

const generatedIds = new Set<string>();

/** Record that `id`'s spec in the registry came from the generator. */
export function markGenerated(id: string): void {
  generatedIds.add(id);
}

/** Drop every generated spec from `levels`, leaving authored ones alone —
 *  however late they were registered. Idempotent. */
export function dropGeneratedLevels(levels: Record<string, unknown>): void {
  for (const id of generatedIds) delete levels[id];
  generatedIds.clear();
}

/** Test seam: forget what we've marked, without needing a registry to clear. */
export function resetGeneratedTracking(): void {
  generatedIds.clear();
}
