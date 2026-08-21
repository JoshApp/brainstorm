/**
 * What do a stepped stair run's faces actually LOOK LIKE to the shader?
 *
 * Four passes at "the risers read flat" have each been reasoned from the shader source, and each
 * fixed something real without fixing the complaint. The shader picks its projection from the
 * NORMAL — `|ny| >= max(|nx|, |nz|)` means "lay this out in the ground plane" — so if a riser's
 * normal is not what I think it is, every inference downstream of that is wrong.
 *
 * So: build the real geometry and count.
 *
 *   npx tsx scripts/stair-normals.ts
 */
import { makeSteppedRampGeometry } from '../src/level/geometry-prims';

const rect = { x: 0, z: 0, w: 2, d: 6 };
// A 6m run dropping 1.2m — an ordinary stair corridor.
const groundY = (_x: number, z: number): number => -1.2 * ((z + 3) / 6);

const geo = makeSteppedRampGeometry(rect, groundY, 0.18, false);
if (!geo) throw new Error('no geometry');

const pos = geo.getAttribute('position');
const nrm = geo.getAttribute('normal');
console.log(`vertices ${pos.count} · has normals: ${!!nrm}`);
if (!nrm) {
  console.log('NO NORMAL ATTRIBUTE — the shader would read (0,0,0) and every face takes the '
    + '"flat" ground-plane branch, which on a vertical riser is a vertical smear.');
  process.exit(0);
}

let up = 0, down = 0, side = 0;
const sideAxes = new Map<string, number>();
for (let i = 0; i < nrm.count; i++) {
  const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
  const ay = Math.abs(ny), ax = Math.abs(nx), az = Math.abs(nz);
  if (ay >= Math.max(ax, az)) { if (ny > 0) up++; else down++; } else {
    side++;
    const k = ax >= az ? 'x' : 'z';
    sideAxes.set(k, (sideAxes.get(k) ?? 0) + 1);
  }
}
console.log(`up-facing ${up} · down-facing ${down} · SIDE-facing ${side}`);
console.log('side axis split:', [...sideAxes].map(([k, v]) => `${k}:${v}`).join(' '));
console.log('');
console.log(side === 0
  ? 'NO SIDE FACES — the run has no vertical geometry the shader can see, so there is nothing '
    + 'for a wall projection to act on.'
  : `${((side / nrm.count) * 100).toFixed(0)}% of vertices are vertical faces; those take the `
    + 'wall branch (sU = along the face, sV = world Y) and should show stone.');
