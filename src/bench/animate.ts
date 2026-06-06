// Bench animation drivers. The studio renders static geometry; these turn a
// subject into a posed sequence the studio samples as a contact sheet (one
// image = the whole animation arc). The first driver is mob telegraphs —
// windup → strike → recover — driven through the SAME applyTelegraphPose the
// live game uses (mobs/pose-clips.ts), so a bench animation grid and the
// in-game attack are the identical silhouette.
//
// Next drivers on this same interface: weapon swing-state, effect lifetimes.

import type { BuiltModel } from '../ecs/build-model';
import type { EnemySpec } from '../content/enemies';
import { resolveAbilities } from '../content/abilities';
import { applyTelegraphPose, telegraphNodesFor, type TelegraphNodes } from '../mobs/pose-clips';

export interface SubjectAnimator {
  /** Suggested frame count for a balanced contact sheet. */
  frames: number;
  /** Pose the rig for grid tile i of n (i across the whole arc, 0→end). */
  poseAt(i: number, n: number): void;
  /** Human label, e.g. 'swing · 0.5/0.15/0.4s'. */
  label: string;
}

/** Drive a mob's primary-ability telegraph across its windup/strike/recover
 *  timeline. Frame i maps to a real point in the attack so spacing reads true:
 *  a long windup gets more frames than a snappy strike. */
export function makeMobAnimator(built: BuiltModel, spec: EnemySpec): SubjectAnimator {
  const nodes: TelegraphNodes = telegraphNodesFor(built, spec);
  const ability = resolveAbilities(spec)[0];
  const style = ability?.pose ?? 'swing';
  const w = ability?.windup ?? spec.windupTime ?? 0.5;
  const s = ability?.strike ?? spec.strikeTime ?? 0.15;
  const r = ability?.recover ?? spec.recoverTime ?? 0.4;
  const total = Math.max(w + s + r, 0.001);

  function poseAt(i: number, n: number): void {
    const tau = (i / Math.max(1, n - 1)) * total;   // 0 → total across the sheet
    if (tau < w) {
      applyTelegraphPose(nodes, style, 'windup', w > 0 ? tau / w : 1);
    } else if (tau < w + s) {
      applyTelegraphPose(nodes, style, 'strike', 1);
    } else {
      applyTelegraphPose(nodes, style, 'recover', r > 0 ? (tau - w - s) / r : 1);
    }
  }

  return { frames: 8, poseAt, label: `${style} · ${w}/${s}/${r}s` };
}
