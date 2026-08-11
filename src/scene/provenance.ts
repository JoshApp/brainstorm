import type * as THREE from 'three';

// ── PROVENANCE: every drawable says what made it ─────────────────────────────
//
// A drawable's ORIGIN is the system that generated it — `polyfloor`, `clutter`,
// `doorframe`, `prop`. It is not decoration. Four separate systems already
// branch on it:
//
//   - scene/static-batch.ts   resolves a group's room rect from it, and its
//                             lookup is an implicit ALLOWLIST — an untagged
//                             group falls straight through `continue` and pays
//                             a render object forever
//   - level/room-culling.ts   toggles shells by the rect encoded in it
//   - debug/draw-report.ts    attributes draws to populations by it
//   - debug/scene-audit.ts    categorises the scene by it
//
// So an untagged mesh is not merely unlabelled — it is invisible to the batcher
// gate and uncountable in every audit. Measured on a full un-culled floor:
// 1042 meshes, of which 929 were loose static in 375 anonymous kinds
// (`untagged:000000·36v` ×80, `untagged:1a1512·24v` ×37 …), while the report
// claimed `shell: 0, prop: 0, fixture: 0`. Not because the floor has no shell —
// because most geometry never said so. scene-audit.ts had already hit this and
// answered it by walking up and BORROWING a parent's name, marked `↑`; that is
// a workaround for a missing fact, and it cannot tell you what to bake.
//
// THE RULE: whatever adds a group to the level root tags it. Lookup walks UP,
// so tagging the group covers every mesh under it — you do not tag per mesh.
//
// ── THE STRING FORMAT IS LOAD-BEARING ───────────────────────────────────────
// `dbgSource` doubles as the ROOM-RECT carrier. static-batch's `shellRectId`
// and room-culling both parse `"<system> · <rectId>"` — text after the `·`, up
// to the first space. Get that wrong and stone does not merely go unlabelled,
// it gets filed under the wrong room and BLINKS OUT while the player is looking
// straight at it (the doorframe bug). Hence `tagOrigin` builds the string
// rather than every call site interpolating it by hand, and a test pins the
// format against the real parser.

/**
 * The system that generated a drawable. Deliberately a closed-ish vocabulary:
 * the point is to make populations COUNTABLE, and a free-for-all of strings
 * gives back the 375 anonymous kinds this exists to kill. Add a member when a
 * genuinely new generating system appears — not per prop, per room or per call.
 */
export type OriginSystem =
  // Room shell — the surfaces themselves.
  | 'floor' | 'ceiling' | 'wall' | 'trim'
  // Circulation.
  | 'corridor' | 'doorframe' | 'door' | 'stairs' | 'archway'
  // A threshold that GLOWS on approach. Not cosmetic bookkeeping: room-culling
  // and leak-scan both branch on `dbgKind === 'frame'`, so this member exists
  // because removing it would silently change culling behaviour.
  | 'frame'
  // Dressing.
  | 'prop' | 'clutter' | 'fixture' | 'destructible'
  // Things with behaviour.
  | 'interactable' | 'enemy' | 'fx' | 'sprite'
  // Output of a merge/batch pass — already collapsed, counted separately so a
  // batch is never mistaken for a population that still needs work.
  | 'batched';

export interface OriginOptions {
  /** Room/corridor rect id this belongs to. Encoded so the culler + batcher can
   *  read it back; omit only when the thing genuinely belongs to no room. */
  rect?: string | null;
  /** Free-text detail for humans, appended after the rect. Never parsed. */
  detail?: string;
}

/** Read side: `dbgKind` is the coarse class, `dbgSource` the parseable string. */
interface OriginUserData {
  dbgKind?: string;
  dbgSource?: string;
}

/**
 * Stamp a drawable (normally the GROUP a system adds to the level root) with the
 * system that made it. Tag once, at the generating call site.
 */
export function tagOrigin(obj: THREE.Object3D, system: OriginSystem, opts: OriginOptions = {}): void {
  const ud = obj.userData as OriginUserData;
  ud.dbgKind = system;
  // `<system> · <rect> <detail>` — the exact shape shellRectId expects. The rect
  // must contain no spaces (it is delimited by one); a rect id with a space in
  // it would truncate and file the object under a different room.
  let s = system;
  if (opts.rect) s += ` · ${opts.rect}`;
  if (opts.detail) s += `${opts.rect ? '' : ' ·'} ${opts.detail}`;
  ud.dbgSource = s;
}

/** The system that made this drawable, walking up to the nearest tagged
 *  ancestor. Returns null when NOTHING in the chain is tagged — which is the
 *  thing worth counting, so it is a null rather than a guess. */
export function originOf(obj: THREE.Object3D): { system: string; rect: string | null } | null {
  let n: THREE.Object3D | null = obj;
  while (n) {
    const ud = n.userData as OriginUserData | undefined;
    const src = ud?.dbgSource;
    if (typeof src === 'string' && src) {
      return { system: (ud?.dbgKind as string) || src.split(/[ ·]/)[0], rect: rectOf(src) };
    }
    if (typeof ud?.dbgKind === 'string' && ud.dbgKind) return { system: ud.dbgKind, rect: null };
    n = n.parent;
  }
  return null;
}

/** Room rect encoded in a dbgSource string, or null. The one parser — kept here
 *  beside the writer so the two can never drift (they were separate, and the
 *  format was reproduced by hand at ~20 call sites). */
export function rectOf(dbgSource: string): string | null {
  const dot = dbgSource.indexOf('·');
  if (dot < 0) return null;
  const rest = dbgSource.slice(dot + 1).trim();
  const sp = rest.search(/\s/);
  return (sp < 0 ? rest : rest.slice(0, sp)) || null;
}

export interface UntaggedReport {
  /** Drawables with no origin anywhere up their chain. */
  count: number;
  /** Shape-and-colour hint → count, so the biggest anonymous populations are
   *  identifiable enough to go find in the code. */
  kinds: Record<string, number>;
}

/**
 * Count drawables that no system claims. THE RATCHET: this number should only
 * ever go down, and it is the honest measure of whether the population
 * accounting is real or still guesswork.
 */
export function untaggedDrawables(root: THREE.Object3D): UntaggedReport {
  const kinds: Record<string, number> = {};
  let count = 0;
  root.traverse((o) => {
    const d = o as THREE.Mesh & { isSprite?: boolean; isPoints?: boolean };
    if (!(d.isMesh || d.isSprite || d.isPoints)) return;
    if (originOf(o)) return;
    count++;
    const verts = d.geometry?.attributes?.position?.count ?? 0;
    const mat = d.material as THREE.MeshStandardMaterial | undefined;
    const hint = d.name || mat?.color?.getHexString?.() || d.type;
    const key = `${hint}·${verts}v`;
    kinds[key] = (kinds[key] ?? 0) + 1;
  });
  return { count, kinds };
}
