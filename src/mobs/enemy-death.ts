// An enemy's death, from the killing blow to the empty floor.
//
// THE THREE BEATS of a death: REACT (the body answers the blow) → REST (it
// lies still — sells the kill, lets the player breathe) → RECLAIM (the
// dissolve: essence rises into the player, the husk goes down to the dungeon).
//
// Once hp hits zero the mesh is NOT removed at once. A dissolve ramps 0→1 while
// essence drifts up and the body topples, hangs or fades by `spec.deathStyle`;
// only when the sequence ends does the container leave the scene.
//
// Split out of createEnemy (Phase 3, docs/OPEN-ITEMS.md). It owns its own state
// and reads the enemy only through the parts handed to it, the same shape as
// enemy-presentation.ts. tests/enemy-golden.test.ts pins its behaviour.

import * as THREE from 'three';
import type { EnemySpec } from '../content/enemies';
import type { BuiltModel } from '../ecs/build-model';
import type { DamageEvent } from '../combat/damage';
import type { EyePresenter } from './enemy-presentation';
import type { SkinnedCreature } from './creature-skinned';
import { emitGoreSplash } from '../scene/splat-map';
import { spawnShatterBurst } from '../effects/shatter-burst';
import { spawnFlungPart, COLLAPSE_PRESET } from '../effects/flung-parts';
import { spawnXpWisps } from '../effects/xp-wisps';
import { getDeathSink } from '../debug/death-debug';
import { tagPerfEvent } from '../debug/perf-recorder';

/** Joints a crumble drops when the spec names none — also the set the
 *  debris-template warm bakes at spawn (enemy.ts), so the two agree by
 *  definition. */
export const DEFAULT_SEVERABLE = ['head', 'shoulderL', 'shoulderR', 'hipL', 'hipR'];

/** Slower dissolve so the corpse + flung parts linger, readable. */
const DEATH_DURATION = 0.85;
// Collapse (flesh): topple over COLLAPSE_TOPPLE, lie still for the rest beat,
// THEN melt into the floor over DEATH_DURATION. The rest beat is what makes a
// body feel dead instead of instantly consumed; scaled lightly by mob size so
// a rat doesn't overstay and a brute earns its moment.
const COLLAPSE_TOPPLE = 0.38;
// Crumble (skeleton / construct): the strings go slack. It HANGS — teeters off
// vertical, losing tension — then the strings cut and it falls into its actual
// bone pieces (real joint subtrees dropped via flung-parts, not fake debris).
// The pieces SETTLE + lie on the floor, then powder away as the dissolve ramps.
const CRUMBLE_HANG = 0.5;       // teeter upright before the collapse
const CRUMBLE_SETTLE = 1.4;     // pieces fall, land, and lie before powdering

const tmpEssenceOrigin = new THREE.Vector3();

export interface EnemyDeathParts {
  scene: THREE.Object3D;
  container: THREE.Group;
  built: BuiltModel;
  spec: EnemySpec;
  skinned: SkinnedCreature;
  eyes: EyePresenter;
  /** Height essence lifts from (the measured body centre × scale). */
  essenceRigY: number;
}

export interface EnemyDeath {
  /** True from the killing blow until the container has left the scene. */
  readonly dying: boolean;
  /** The killing blow landed: pick and splash the severed limb, arm the
   *  sequence. `playerXZ` is where the player stood (the cut's direction). */
  begin(event: DamageEvent, playerXZ: THREE.Vector3, essenceTotal: number): void;
  /** Advance the death by `dt`; removes the container when it ends. */
  tick(dt: number): void;
}

export function createEnemyDeath(parts: EnemyDeathParts): EnemyDeath {
  const { scene, container, built, spec, skinned, eyes } = parts;
  const style: 'collapse' | 'fade' | 'crumble' =
    spec.deathStyle ?? (spec.presence === 'spectral' ? 'fade' : 'collapse');
  const collapseRest = 1.3 + Math.min(0.8, Math.max(0, spec.collisionRadius - 0.2)) * 1.5;
  const duration = style === 'collapse' ? COLLAPSE_TOPPLE + collapseRest + DEATH_DURATION
    : style === 'crumble' ? CRUMBLE_HANG + CRUMBLE_SETTLE + DEATH_DURATION
    : DEATH_DURATION;
  const severPos = new THREE.Vector3();

  let timer = -1;   // -1 = not dying; >=0 = ticking
  // Crumble bookkeeping: the joint the KILLING blow already flung (skip it when
  // the rest of the frame collapses), and a once-guard for the collapse trigger.
  let severedJoint: string | undefined;
  let crumbleCollapsed = false;
  // STAGED GIBS (2026-07-03 phone triage): building a chunk means CPU-skinning a
  // limb's verts into the death pose + the new mesh's first-encode cost — doing
  // the killing-blow sever AND the whole crumble in single frames was the last
  // big in-play hitch (90-200ms frames on the phone, tagged death/sever). The
  // sever now builds ONE FRAME after the blow (inside the death hit-pause, so
  // the flung limb's 16ms head start is invisible) and the crumble cuts ONE
  // piece per tick during the topple — a progressive collapse that spreads the
  // cost and reads MORE organic than the old single-frame burst.
  let pendingSever: { joint: string; dirX: number; dirZ: number } | null = null;
  let crumbleQueue: string[] | null = null;
  // Flung crumble chunks share the body materials but, on WebGPU, read their OWN
  // per-object dissolve (mesh.userData.dissolve) — so we track them and drive their
  // dissolve in sync with the body each frame (they no longer powder via a shared
  // uniform). Cleared as they self-remove is handled by the flung-parts pool.
  const chunks: THREE.Mesh[] = [];
  // Pre-collect every dissolve uniform we need to drive. Walking
  // `built.materials` per-frame would work too, but caching the refs
  // here keeps the per-frame tick branch-free.
  const dissolveUniforms: Array<{ value: number }> = [];
  for (const m of built.materials.values()) {
    const u = m.userData.uDissolve as { value: number } | undefined;
    if (u) dissolveUniforms.push(u);
  }
  // Essence-emit counter — how many XP particles have been spawned out of the
  // dissolving body so far, spawned incrementally as the dissolve progresses.
  let essenceSpawned = 0;
  let essenceTotal = 0;

  /** The joint the killing blow lops, or undefined. Two ways to pick it:
   *  1) ZONE — the struck hurtzone maps to a joint. Limb zones are named
   *     'limb-<joint>' (arms=shoulderL/R, legs=hipL/R); head zone = 'head'.
   *  2) ANGLE — a side-SLASH kill (severSide) lops a limb on that side even
   *     if the killing zone was the torso, so directional cuts read. */
  function pickSeverJoint(event: DamageEvent, playerXZ: THREE.Vector3): string | undefined {
    const killZoneId = event.hitZoneId;
    let severJoint = killZoneId
      ? (killZoneId.startsWith('limb-') ? killZoneId.slice(5) : killZoneId)
      : undefined;
    if (!(severJoint && spec.severable?.includes(severJoint))) severJoint = undefined;
    if (!severJoint && event.severSide && spec.severable) {
      // Directional: lop the limb the player SEES on the cut side. We can't
      // use the joint's anatomical name (shoulderL is the mob's OWN left,
      // which faces the player's RIGHT — mirrored). Instead pick by world
      // position: project each candidate onto the player's view-right axis
      // and take the one furthest to the cut side. Correct for any facing.
      const fx = container.position.x - playerXZ.x;
      const fz = container.position.z - playerXZ.z;
      const fl = Math.hypot(fx, fz) || 1;
      // player-right = forward (player→mob) rotated -90° about +Y.
      const rx = -fz / fl, rz = fx / fl;
      const wantLeft = event.severSide === 'L';
      const pickSideLimb = (candidates: string[]): string | undefined => {
        let best: string | undefined;
        let bestLat = wantLeft ? Infinity : -Infinity;
        for (const j of candidates) {
          if (!spec.severable!.includes(j)) continue;
          const obj = built.slots.get(j);
          if (!obj) continue;
          obj.getWorldPosition(severPos);
          const lat = (severPos.x - container.position.x) * rx
                    + (severPos.z - container.position.z) * rz;
          if (wantLeft ? lat < bestLat : lat > bestLat) { bestLat = lat; best = j; }
        }
        return best;
      };
      // Prefer an arm on the cut side; fall back to a leg.
      severJoint = pickSideLimb(['shoulderL', 'shoulderR'])
                ?? pickSideLimb(['hipL', 'hipR']);
    }
    return severJoint;
  }

  function begin(event: DamageEvent, playerXZ: THREE.Vector3, essence: number): void {
    timer = 0;
    // DISMEMBER on the killing blow: lop the joint subtree, burst gore + fling
    // the severed part as a tumbling chunk in the creature's own colour.
    const severJoint = pickSeverJoint(event, playerXZ);
    if (severJoint) {
      const jointObj = built.slots.get(severJoint);
      if (jointObj) {
        jointObj.getWorldPosition(severPos);
        const dirX = severPos.x - playerXZ.x;
        const dirZ = severPos.z - playerXZ.z;
        const bc = spec.bloodColor ?? 0x5e1210;
        emitGoreSplash(
          severPos.x, severPos.z, severPos.y, dirX, dirZ,
          1.3 * (spec.bloodAmount ?? 1), bc,
          { sizeMul: Math.min(1.6, 0.7 + spec.collisionRadius * 0.8) },
        );
        // Queue the limb snapshot for the NEXT dying tick — the gore splash
        // lands NOW, the chunk build + first encode land one frame later,
        // inside the death hit-pause where they can't hitch.
        pendingSever = { joint: severJoint, dirX, dirZ };
        severedJoint = severJoint;   // crumble skips this one — it's getting flung
      }
    }
    // CRUMBLE — the killing-blow piece (above) flies off; the REST of the
    // skeleton collapses LATER, staged in tick: it teeters upright for
    // CRUMBLE_HANG, then the strings cut and the real bone joints drop into a
    // pile (flung-parts, COLLAPSE_PRESET). Nothing to spawn here at the kill
    // instant — the immediate debris pop is what made it read as "shatters
    // while standing rigid"; the collapse is deferred so it FALLS first.
    essenceTotal = essence;
    essenceSpawned = 0;
  }

  // Pick a random emit point across the body volume (a cylinder ~the mob's
  // collision radius, full body height) for an essence mote — so the XP lifts
  // off the WHOLE corpse + where its limbs scattered, not just its centreline.
  function setEssenceOrigin(): void {
    const ang = Math.random() * Math.PI * 2;
    const rad = spec.collisionRadius * 1.05 * Math.sqrt(Math.random());
    const h = Math.max(0.6, parts.essenceRigY * 1.25);
    tmpEssenceOrigin.set(
      container.position.x + Math.cos(ang) * rad,
      container.position.y + 0.1 + Math.random() * h,
      container.position.z + Math.sin(ang) * rad,
    );
  }

  function tick(dt: number): void {
    timer += dt;
    if (pendingSever) {
      // The killing-blow limb, deferred off the kill frame (see begin). Build
      // + fling now — one chunk's cost on a calm frame.
      const { joint, dirX, dirZ } = pendingSever;
      pendingSever = null;
      tagPerfEvent('sever');   // perf timeline — names the geo+1 render cost of the chunk
      const chunk = skinned.severBoneChunk(joint, spec.id);
      if (chunk) {
        // Track it like the crumble chunks: per-object dissolve (WebGPU reads
        // chunk.userData.dissolve) must be DRIVEN or the killing-blow limb
        // never powders — it used to pop out solid at its life cap.
        chunk.userData.dissolve = 0;
        chunks.push(chunk);
        spawnFlungPart(scene, chunk, dirX, dirZ);
      }
    }
    const t = Math.min(1, timer / duration);

    // Dissolve PROGRESS (the RECLAIM beat) — held back until the body has
    // finished reacting + RESTING, so the corpse lies solid for a beat before
    // the dungeon takes it. 'fade' dissolves from frame one (no body to claim).
    const dissolveT =
      style === 'collapse' ? Math.max(0, Math.min(1, (timer - COLLAPSE_TOPPLE - collapseRest) / DEATH_DURATION))
      : style === 'crumble' ? Math.max(0, Math.min(1, (timer - CRUMBLE_HANG - CRUMBLE_SETTLE) / DEATH_DURATION))
      : t;
    // Drive the dissolve uniform on every dissolvable material on the mob — and,
    // because collapsed/flung parts SHARE these materials, on every detached
    // bone too, so the whole skeleton powders in sync. (build-model.ts injects
    // uDissolve as a top-down ragged discard with an emissive edge band.)
    for (const u of dissolveUniforms) u.value = dissolveT;   // WebGL path (onBeforeCompile uDissolve)
    // WebGPU path: dissolve is a PER-OBJECT node reading mesh.userData.dissolve, so it
    // can't leak across the species (killing one mob no longer dissolves the rest — see
    // build-model objectScalar). Drive the body here; flung crumble chunks get theirs
    // set as they spawn (they share the material but read their own userData).
    skinned.mesh.userData.dissolve = dissolveT;
    // Pieces that SETTLED into bone litter opted out of the corpse's powder —
    // flung-parts owns their (much later) reclaim; overwriting here would eat
    // the litter the instant its owner finished dying.
    for (const ch of chunks) if (!ch.userData.litter) ch.userData.dissolve = dissolveT;

    if (style === 'collapse') {
      // TOPPLE backward, LIE (rest), then SINK as it melts. The enemy faced the
      // player, so local backward (+rotX) is away from the blow. dissolveT is 0
      // through the rest beat, so it lies flat until the dissolve starts.
      const tp = Math.min(1, timer / COLLAPSE_TOPPLE);
      const e = 1 - (1 - tp) * (1 - tp);
      built.group.rotation.x = e * 1.45;
      // MELT INTO THE FLOOR during RECLAIM — sink the corpse so the dungeon
      // takes the husk from the ground instead of it popping away. The opaque
      // floor occludes the submerged part; the shader eats the rest. (DEV
      // __death.sink(false) holds it on the floor so the dissolve is visible.)
      const sink = getDeathSink() ? 0.6 * dissolveT * dissolveT : 0;
      built.group.position.y = -0.05 * e - sink;
    } else if (style === 'crumble') {
      if (timer < CRUMBLE_HANG) {
        // HANG — the strings go slack. Teeter off vertical + a slow sway so it
        // reads as a puppet losing tension, not a body standing at attention.
        const hp = timer / CRUMBLE_HANG;
        built.group.rotation.x = 0.14 * hp * hp;
        built.group.rotation.z = Math.sin(timer * 7) * 0.05 * hp;
      } else {
        // STAGED CRUMBLE — one piece per tick instead of the whole body in one
        // frame (see the staged-gibs note by the state vars): each tick severs
        // one limb off the toppling frame and flings it; when the queue drains,
        // the leftover torso goes as the final piece. Same chunks, same
        // materials/dissolve — only the timing spreads, and the limbs peeling
        // off the falling skeleton one by one reads better than the old
        // simultaneous burst.
        const flingChunk = (ch: THREE.Mesh, cx: number, cz: number): void => {
          let dx = ch.position.x - cx, dz = ch.position.z - cz;
          if (Math.hypot(dx, dz) < 0.05) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; }
          ch.userData.dissolve = dissolveT;   // seed per-object dissolve; driven below
          chunks.push(ch);
          spawnFlungPart(scene, ch, dx, dz, COLLAPSE_PRESET);
        };
        if (!crumbleQueue) {
          crumbleQueue = (spec.severable ?? DEFAULT_SEVERABLE)
            .filter((j) => j !== severedJoint);
          tagPerfEvent('crumble');   // perf timeline — the staged chunk builds start here
          spawnShatterBurst(scene, container.position.x, container.position.y + 0.3, container.position.z, true, spec.bloodColor ?? 0x8a8274);
        }
        if (!crumbleCollapsed) {
          const cx = container.position.x, cz = container.position.z;
          const joint = crumbleQueue.shift();
          if (joint !== undefined) {
            const ch = skinned.severBoneChunk(joint, spec.id);
            if (ch) flingChunk(ch, cx, cz);
          } else {
            crumbleCollapsed = true;
            // Everything still attached (the torso frame) drops as one piece.
            for (const ch of skinned.crumbleToChunks([], spec.id)) flingChunk(ch, cx, cz);
          }
        }
        // The remaining frame (ribcage/spine) topples to the floor, then sinks
        // as it powders. The limbs have already dropped as their own pieces.
        const tp = Math.min(1, (timer - CRUMBLE_HANG) / 0.4);
        const e = 1 - (1 - tp) * (1 - tp);
        built.group.rotation.x = 0.14 + e * (1.35 - 0.14);
        const sink = getDeathSink() ? 0.6 * dissolveT * dissolveT : 0;
        built.group.position.y = -0.05 * e - sink;
      }
    } else {
      // FADE — spectral rises (sells the float), others sag a touch.
      built.group.position.y = spec.presence === 'spectral' ? 0.55 * t : -0.08 * t;
    }

    // Eye flare — spike then crash. The mob "sees clearly" the instant
    // it dies, then the lights go out before the body is gone.
    const eyeT = t < 0.18
      ?  t / 0.18
      :  1 - (t - 0.18) / 0.82;
    eyes.setFlare(Math.max(0, eyeT));

    // Halo opacity fades alongside.
    eyes.setHaloOpacity(Math.max(0, 1 - t));

    // Essence emission — spawn XP motes incrementally during the dissolve so
    // the body visibly becomes essence flowing into the player. Each mote lifts
    // from a RANDOM point across the whole body volume (and where the limbs
    // scattered), so it reads as the entire corpse coming apart into essence,
    // not a single column rising from its centre.
    if (essenceTotal > 0) {
      const target = Math.floor(dissolveT * essenceTotal);
      while (essenceSpawned < target && essenceSpawned < essenceTotal) {
        setEssenceOrigin();
        spawnXpWisps(scene, tmpEssenceOrigin, 1);
        essenceSpawned++;
      }
    }

    if (t >= 1) {
      // Catch any straggler XP that the integer-floor schedule missed
      // (e.g. essenceTotal=5 but we only spawned 4 because t hit 1.0
      // exactly on the same frame).
      while (essenceSpawned < essenceTotal) {
        setEssenceOrigin();
        spawnXpWisps(scene, tmpEssenceOrigin, 1);
        essenceSpawned++;
      }
      // Animation complete — remove the container and mark fully done.
      scene.remove(container);
      timer = -1;
      // Geometry is NOT disposed here. Materials are safe to leak (the program
      // cache key dedup means subsequent spawns hit the cached compile), and
      // POOLED geometries are shared across every mob of the type.
      //
      // WEBGPU: don't dispose synchronously AT ALL. The render loop is
      // fire-and-forget renderAsync, so a frame is usually in flight; freeing a
      // buffer its command encoder still references invalidates that frame's whole
      // draw — and since every mob of the species renders in the same pass, they ALL
      // collapse to a few stray verts (the reported death-dissolve "species goes
      // invisible" bug). Same class + same fix as the vase-dispose hazard: let GC
      // reclaim the per-mob geometry once the group leaves the scene.
    }
  }

  return {
    get dying() { return timer >= 0; },
    begin,
    tick,
  };
}
