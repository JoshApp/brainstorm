// How the torch bake fares on real floors: static lights per floor, how many
// fit in the channels, the texture size, and the bake's CPU time.
//
//   npx tsx scripts/light-bake-stats.ts [depths…]      (default 1..12)
import '../tests/support/vite-assets';
import '../src/headless/dom-stub';
import * as THREE from 'three';

const { generateFloor } = await import('../src/level/procgen');
const { buildLevel } = await import('../src/level/builder');
const { buildMaterials } = await import('../src/style/materials');
const { bootstrapSimWorld } = await import('../src/engine/sim-bootstrap');
const { spawn: spawnEntity, clear: clearWorld } = await import('../src/ecs/world');
const { resetSimState } = await import('../src/engine/sim-state');
const { seedRng } = await import('../src/engine/rng');
const { setDeterministicClock } = await import('../src/engine/game-clock');
const { forEachLight, clearLightPool } = await import('../src/scene/light-pool');
const { bakeLightVisibility } = await import('../src/scene/light-bake');
const { CONFIG } = await import('../src/config');

const stubRenderer = new Proxy(
  {
    capabilities: { isWebGL2: true, maxTextures: 16, getMaxAnisotropy: () => 1 },
    getContext: () => null, setRenderTarget: () => {}, render: () => {},
    info: { render: {}, memory: {} }, extensions: { get: () => null },
    properties: { get: () => ({}) }, outputColorSpace: '',
  },
  { get: (t: Record<string, unknown>, k) => (k in t ? t[k] : () => {}) },
) as never;

const depths = process.argv.slice(2).map(Number).filter((n) => n > 0);
for (const depth of depths.length ? depths : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  clearWorld(); clearLightPool();
  seedRng(1000 + depth); setDeterministicClock(true);
  const scene = new THREE.Scene();
  const materials = buildMaterials(stubRenderer);
  bootstrapSimWorld(scene);
  spawnEntity({ id: 'player', kind: 'player', hp: { base: CONFIG.PLAYER_HP_MAX, current: CONFIG.PLAYER_HP_MAX }, buffs: [], passives: [] });
  resetSimState();
  const level = buildLevel(scene, generateFloor(depth, 1000 + depth), materials);
  const lights: Array<{ id: string; x: number; z: number; range: number; intensity: number; decay: number }> = [];
  forEachLight('environment', (s) => lights.push({ id: s.id, x: s.position.x, z: s.position.z, range: s.distance, intensity: s.intensity * 1.2, decay: s.decay }));
  for (const K of [4, 8]) {
    const b = bakeLightVisibility(lights, level.walkable.listWalls(), { channels: K });
    console.log(`depth ${depth} K=${K}: ${b.stats.lights} lights, baked ${b.stats.baked}, live ${b.live.length}, conflicts ${b.stats.conflicts}, grid ${b.w}x${b.h}, ${b.stats.ms} ms`);
  }
}
