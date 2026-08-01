import { BAKED_RELIC_ART } from './relic-art-index';

// RELIC ART RESOLVER — the ONE seam the rest of the game asks "does this relic
// have a shipped 2.5D sprite, and where?" A relic's Flux/2.5D art (public/relics/
// <id>.webp, authored via `delve art relic` + baked) supersedes its procedural
// 3D thumbnail EVERYWHERE it's shown — the reliquary plate, the bag cell, the
// detail header, the in-world drop — through this single lookup. Until a relic is
// baked it returns null and each surface falls back to getItemThumbnail (the 3D
// render), so the whole game degrades gracefully with zero art present today.

const BASE = import.meta.env.BASE_URL;
const baked = new Set(BAKED_RELIC_ART);

/** True if this relic has a shipped 2.5D sprite. */
export function hasRelicArt(id: string): boolean {
  return baked.has(id);
}

/** The URL of a relic's 2.5D sprite, or null to fall back to the 3D thumbnail. */
export function relicArtUrl(id: string): string | null {
  return baked.has(id) ? `${BASE}relics/${id}.webp` : null;
}
