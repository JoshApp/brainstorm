// Content-hashed URLs for the menu surfaces.
//
// These are imported THROUGH Vite (not string-referenced from public/) on purpose:
// Vite fingerprints the emitted filename by content (parchment-<hash>.webp), so a
// regenerated texture gets a NEW url and can never be served stale from an old
// HTTP/service-worker cache — the url itself is the version. (public/ assets keep
// a stable name, which is exactly what let the old textures linger.)
//
// Workflow: bake a promoted run → src/assets/textures/<name>.webp (delve optimize
// targets that dir), add an import here. Used by the menu chrome, keyed by name.
import parchment from '../assets/textures/parchment.webp?url';
import mapstain from '../assets/textures/mapstain.webp?url';
import grimoireBorder from '../assets/textures/grimoire-border.webp?url';

export const TEXTURE_URL: Record<string, string> = {
  parchment,
  mapstain,
  'grimoire-border': grimoireBorder,
};
