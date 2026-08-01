// BAKED RELIC ART INDEX — the list of relic ids that have a shipped 2.5D sprite
// in public/relics/<id>.webp. WRITTEN BY `scripts/bake-relics.ts` (do not hand-
// edit): after `delve art relic all` generates + `delve art promote <id>` picks
// the keepers, the bake step trims each promoted run to a transparent sprite,
// writes it under public/relics/, and regenerates this array. Empty until the
// first bake runs — every relic falls back to its 3D thumbnail (relic-art-assets
// .ts). Kept as plain DATA (not a glob) so the resolver is synchronous and the
// bundle only references sprites that actually exist.
export const BAKED_RELIC_ART: readonly string[] = [
];
