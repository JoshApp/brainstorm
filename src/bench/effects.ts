// Effect demos — the first time the effects in src/effects/* are ENUMERABLE
// and previewable. Each effect module has a bespoke spawn/tick signature and
// no registry, so this is the small adapter seam that lets the bench drive them
// in isolation: spawn one into the bare studio at the origin and sample its
// lifetime as a contact sheet (one image = the whole effect over time).
//
// Two natural shapes, both conforming to the bench's SubjectAnimator:
//   - telegraphs are PROGRESS-driven (setProgress 0→1) — sample per tile
//   - bursts are dt-TICKED — advance the clock per tile (tiles render in order)

import * as THREE from 'three';
import type { SubjectAnimator } from './animate';
import { spawnShatterBurst, tickShatterBurst, clearShatterBurst } from '../effects/shatter-burst';
import { spawnBloodBurst, tickBloodBurst, clearBloodBurst } from '../effects/blood-burst';
import { spawnDustPuff, tickDustPuff, clearDustPuff } from '../effects/dust-puff';
import { spawnParrySpark, tickParrySpark, clearParrySpark } from '../effects/parry-spark';
import { spawnXpWisps, tickXpWisps, clearXpWisps } from '../effects/xp-wisps';
import { spawnGoldCoins, tickGoldCoins, clearGoldCoins } from '../effects/gold-coins';
import { spawnAoeTelegraph } from '../effects/aoe-telegraph';
import { spawnSummonTelegraph } from '../effects/summon-telegraph';
import { spawnLashTendril } from '../effects/lash-tendril';

export interface EffectDemo {
  id: string;        // 'fx-shatter-burst'
  label: string;
  /** Framing distance + camera elevation (floor telegraphs want a higher look-down). */
  radius: number;
  el: number;
  /** Spawn the effect into root and return the animator that samples it. */
  start(root: THREE.Object3D): SubjectAnimator;
}

/** A dt-ticked burst: advance the effect's clock to τ_i across the sheet.
 *  Tiles render in index order, so ticking the delta each call is monotonic. */
function ticked(frames: number, total: number, tick: (dt: number) => void): SubjectAnimator {
  let last = 0;
  return {
    frames,
    label: '',
    poseAt: (i, n) => {
      const tau = (i / Math.max(1, n - 1)) * total;
      tick(Math.max(0, tau - last));
      last = tau;
    },
  };
}

const PLAYER = new THREE.Vector3(0, 1.4, 1.2);   // a stand-in "player" for homing effects

export const EFFECT_DEMOS: EffectDemo[] = [
  {
    id: 'fx-shatter-burst', label: 'shatter burst', radius: 1.0, el: 14,
    start(root) {
      spawnShatterBurst(root, 0, 0.4, 0);
      return { ...ticked(8, 1.2, tickShatterBurst), label: 'shatter · 1.2s' };
    },
  },
  {
    id: 'fx-blood-burst', label: 'blood burst', radius: 1.0, el: 14,
    start(root) {
      spawnBloodBurst(root, 0, 0.5, 0);
      return { ...ticked(8, 1.0, tickBloodBurst), label: 'blood · 1.0s' };
    },
  },
  {
    id: 'fx-dust-puff', label: 'dust puff', radius: 1.4, el: 14,
    start(root) {
      spawnDustPuff(root, 0, 0.1, 0, { count: 12, spread: 1.1, size: 0.5, rise: 1.1, life: 0.8 });
      return { ...ticked(8, 0.9, tickDustPuff), label: 'dust · gate slam' };
    },
  },
  {
    id: 'fx-parry-spark', label: 'parry spark', radius: 1.0, el: 6,
    start(root) {
      spawnParrySpark(root, 0, 0.5, 0);
      return { ...ticked(8, 0.45, tickParrySpark), label: 'parry · clash' };
    },
  },
  {
    id: 'fx-xp-wisps', label: 'xp wisps', radius: 1.6, el: 10,
    start(root) {
      spawnXpWisps(root, new THREE.Vector3(0, 0.5, 0), 12);
      return { ...ticked(8, 1.4, (dt) => tickXpWisps(dt, PLAYER)), label: 'xp wisps · homing' };
    },
  },
  {
    id: 'fx-gold-coins', label: 'gold coins', radius: 1.8, el: 18,
    start(root) {
      spawnGoldCoins(root, new THREE.Vector3(0, 0.5, 0), 30);
      return { ...ticked(8, 1.6, (dt) => tickGoldCoins(dt, PLAYER)), label: 'gold · arc + tumble' };
    },
  },
  {
    id: 'fx-aoe-telegraph', label: 'aoe telegraph', radius: 1.8, el: 38,
    start(root) {
      const fx = spawnAoeTelegraph(root, 0, 0, 1.1);
      return { frames: 8, label: 'aoe · windup 0→1', poseAt: (i, n) => fx.setProgress(i / Math.max(1, n - 1)) };
    },
  },
  {
    id: 'fx-summon-telegraph', label: 'summon telegraph', radius: 1.5, el: 34,
    start(root) {
      const fx = spawnSummonTelegraph(root, 0, 0);
      return { frames: 8, label: 'summon · windup 0→1', poseAt: (i, n) => fx.setProgress(i / Math.max(1, n - 1)) };
    },
  },
  {
    id: 'fx-lash-tendril', label: 'lash tendril', radius: 2.0, el: 12,
    start(root) {
      const fx = spawnLashTendril(root, 0.6, 1.6, 0x88ff66);
      return { frames: 8, label: 'lash · reach 0→1', poseAt: (i, n) => fx.setProgress(i / Math.max(1, n - 1)) };
    },
  },
];

export function effectDemo(id: string): EffectDemo | undefined {
  return EFFECT_DEMOS.find((e) => e.id === id);
}

/** Release any module-global effect state between bench loads. */
export function clearAllEffects(): void {
  clearShatterBurst();
  clearBloodBurst();
  clearParrySpark();
  clearDustPuff();
  clearXpWisps();
  clearGoldCoins();
}
