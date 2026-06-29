import * as THREE from 'three';
import { stdMat } from '../style/material-registry';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { damagePlayer } from '../player/health';
import { pooledBox, pooledPlane } from '../scene/geometry-pool';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Spike trap — a pressure plate hazard. Player steps onto the plate; a
// brief telegraph (plate sinks, an audible click) gives them a moment to
// step off; if they're still on it when the timer elapses, spikes shoot
// up and damage them. Resets after a cooldown so the trap is reusable
// (matters for backtracking, future enemies-trigger-traps, etc).
//
// State machine:
//   armed     — at rest, spikes hidden below floor, plate flush
//   triggered — player on plate; plate sinks; countdown to fire
//   firing    — spikes are up; damage hits anyone on the plate
//   cooldown  — spikes retracting; not yet armed again
//
// Auto-trigger, not USE-button — promptLabel stays empty so the prompt
// UI ignores it. tick() drives all state.

const PLATE_SIZE = 1.2;
const PLATE_THICKNESS = 0.05;
const PLATE_TRIGGER_RADIUS = 0.55;     // half the plate, roughly
const PLATE_SINK_AMOUNT = 0.025;       // how far the plate dips during telegraph
const TELEGRAPH_DEFAULT = 0.45;        // seconds between step-on and spikes-up
const FIRING_DURATION = 0.6;           // how long spikes stay up + damage
const COOLDOWN_DURATION = 1.4;         // before re-arming
const SPIKE_RAISED_Y = 0.5;            // peak spike height
const SPIKE_HIDDEN_Y = -0.6;           // start hidden well below the plate

// A trap's 3×3 spikes rise/fall TOGETHER, so they're one merged geometry (xz
// offsets baked in) animated as a single mesh — 1 draw per trap instead of 9.
// Identical across traps (grid derives from PLATE_SIZE), so build it once and
// share. This was the biggest unmerged decor cost in the draw report (36 cones
// across the floor's traps → ~4 draws).
let spikeGridGeo: THREE.BufferGeometry | null = null;
function getSpikeGridGeo(): THREE.BufferGeometry {
  if (spikeGridGeo) return spikeGridGeo;
  const grid = 3;
  const step = PLATE_SIZE * 0.7 / (grid - 1);
  const start = -PLATE_SIZE * 0.35;
  const cones: THREE.BufferGeometry[] = [];
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const g = new THREE.ConeGeometry(0.06, 0.45, 6);
      g.translate(start + i * step, 0, start + j * step);   // bake the grid offset
      cones.push(g);
    }
  }
  spikeGridGeo = mergeGeometries(cones);
  for (const g of cones) g.dispose();
  return spikeGridGeo!;
}

export function spawnSpikeTrap(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  damage: number = 2,
  telegraphTime: number = TELEGRAPH_DEFAULT,
) {
  const group = new THREE.Group();
  group.position.copy(pos);
  parent.add(group);

  // Plate — distinctively darker than the floor with a thin grime ring so
  // a careful player notices it before stepping. Slight emissive on the
  // ring during ARMED state hints "this is a trap" without making it free
  // intel: the player has to look.
  const plateMat = stdMat({
    color: 0x1a1410,
    roughness: 0.95,
    metalness: 0.3,
  });
  const plate = new THREE.Mesh(
    pooledBox(PLATE_SIZE, PLATE_THICKNESS, PLATE_SIZE),
    plateMat,
  );
  plate.position.y = PLATE_THICKNESS / 2 + 0.005;
  plate.receiveShadow = true;
  group.add(plate);

  // Recessed border — a slightly larger flat plane underneath the plate
  // with a different color, so the plate reads as set into the floor.
  const borderMat = stdMat({
    color: 0x3a2818,
    roughness: 1.0,
  });
  const border = new THREE.Mesh(
    pooledPlane(PLATE_SIZE * 1.18, PLATE_SIZE * 1.18),
    borderMat,
  );
  border.rotation.x = -Math.PI / 2;
  border.position.y = 0.005;
  border.receiveShadow = true;
  group.add(border);

  // Spikes — 3×3 grid of thin cones. Start hidden well below the plate
  // (so they emerge dramatically rather than just "growing"). Stored so
  // we can animate Y in tick.
  const spikeMat = stdMat({
    color: 0x6a5040,
    roughness: 0.4,
    metalness: 0.85,
    emissive: 0x1a0808,
    emissiveIntensity: 0.4,
  });
  // The 3×3 spike grid as ONE merged, animated mesh (they rise together): 1 draw
  // per trap instead of 9. xz offsets are baked into the geometry; only Y moves.
  const spikes = new THREE.Mesh(getSpikeGridGeo(), spikeMat);
  spikes.position.y = SPIKE_HIDDEN_Y;
  spikes.castShadow = false;   // floor clutter — out of the lamp cube map
  group.add(spikes);

  // State machine.
  type State = 'armed' | 'triggered' | 'firing' | 'cooldown';
  let state: State = 'armed';
  let stateTimer = 0;
  let hasDamagedThisCycle = false;

  // Audio: a thunk when the plate sinks, a snap when spikes fire. Could
  // tap audio/sfx; for now keep silent and let the visual + the damage
  // pause carry it. (Hooking a click sfx is easy: add to audio/sfx.ts.)

  const interactable = {
    id: generateEntityId('spike-trap'),
    position: pos.clone(),
    radius: 0,  // no interact prompt; this is auto-trigger
    promptLabel: '',
    onUse() { /* no-op — not a USE target */ },
    tick(dt: number, playerPos: THREE.Vector3) {
      stateTimer += dt;
      const dx = playerPos.x - pos.x;
      const dz = playerPos.z - pos.z;
      const onPlate = Math.hypot(dx, dz) < PLATE_TRIGGER_RADIUS;

      switch (state) {
        case 'armed': {
          // Plate flush, spikes hidden, hostile-emissive ring off.
          plate.position.y = PLATE_THICKNESS / 2 + 0.005;
          if (onPlate) {
            state = 'triggered';
            stateTimer = 0;
            hasDamagedThisCycle = false;
          }
          break;
        }
        case 'triggered': {
          // Plate sinks linearly as countdown runs. Visual telegraph —
          // a player paying attention can see + step off.
          const t = Math.min(1, stateTimer / telegraphTime);
          plate.position.y = PLATE_THICKNESS / 2 + 0.005 - PLATE_SINK_AMOUNT * t;
          if (stateTimer >= telegraphTime) {
            state = 'firing';
            stateTimer = 0;
          }
          break;
        }
        case 'firing': {
          // Spikes shoot up in the first ~0.12s, hold, then start retracting.
          const t = Math.min(1, stateTimer / 0.12);
          const targetY = SPIKE_HIDDEN_Y + (SPIKE_RAISED_Y - SPIKE_HIDDEN_Y) * t;
          spikes.position.y = targetY;
          // Damage applies once per cycle, the first frame after spikes
          // reach full extension AND the player is on the plate.
          if (!hasDamagedThisCycle && t >= 1 && onPlate) {
            damagePlayer(damage, null, 'physical', false, 'a spike trap');
            hasDamagedThisCycle = true;
          }
          if (stateTimer >= FIRING_DURATION) {
            state = 'cooldown';
            stateTimer = 0;
          }
          break;
        }
        case 'cooldown': {
          // Retract spikes + raise plate back to flush. Trap is INERT
          // here — stepping on the plate while retracting doesn't
          // re-trigger; have to wait for the cycle to finish.
          const tDown = Math.min(1, stateTimer / 0.4);
          const targetY = SPIKE_RAISED_Y + (SPIKE_HIDDEN_Y - SPIKE_RAISED_Y) * tDown;
          spikes.position.y = targetY;
          plate.position.y = PLATE_THICKNESS / 2 + 0.005;
          if (stateTimer >= COOLDOWN_DURATION) {
            state = 'armed';
            stateTimer = 0;
          }
          break;
        }
      }
    },
    destroyed: false,
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };
  registerInteractable(interactable);
}
