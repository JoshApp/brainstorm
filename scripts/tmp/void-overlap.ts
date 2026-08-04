// How often does a carved void sit under something that was placed on the floor?
import { generateFloor } from '../../src/level/procgen';
type P = { kind: string; x: number; z: number; _dbg?: string; model?: { id?: string } };
type V = { x: number; z: number; w: number; d: number };
const MAJOR = new Set(['fountain','altar','blood-altar','starter-altar','tithe-basin','reliquary',
  'tome-pillar','merchant','trinket-merchant','blacksmith','chest','stash-chest','offering',
  'challenge-offering','corpse','searchable','spike-trap']);
for (const depth of [3, 5, 8]) {
  let voids = 0, floors = 0, over = 0, near = 0, props = 0;
  const worst = new Map<string, number>();
  for (let s = 0; s < 150; s++) {
    const spec = generateFloor(depth, 9000 + s * 7919) as unknown as { props: P[]; voids?: V[] };
    const vs = spec.voids ?? [];
    voids += vs.length; floors++;
    for (const p of spec.props) {
      const kind = p.kind === 'model' ? `model:${p.model?.id ?? '?'}` : p.kind;
      if (!MAJOR.has(p.kind)) continue;
      props++;
      for (const v of vs) {
        const dx = Math.abs(p.x - v.x) - v.w / 2;
        const dz = Math.abs(p.z - v.z) - v.d / 2;
        if (dx <= 0 && dz <= 0) { over++; worst.set(kind, (worst.get(kind) ?? 0) + 1); break; }
        // "slightly over it" — within half a metre of the lip
        if (dx <= 0.5 && dz <= 0.5) { near++; worst.set(kind + '(lip)', (worst.get(kind + '(lip)') ?? 0) + 1); break; }
      }
    }
  }
  const top = [...worst.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`d${depth}: ${(voids/floors).toFixed(1)} voids/floor | ${props} placed things | IN the void ${over} (${(over/props*100).toFixed(1)}%), on the lip ${near} (${(near/props*100).toFixed(1)}%)`);
  if (top) console.log(`      offenders: ${top}`);
}
