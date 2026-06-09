import { ITEMS, type ItemSpec } from './items';
import { AFFIXES } from './affixes';
import { SETS } from './sets';
import { BUFFS } from './buffs';
import { ENEMIES, type EnemySpec } from './enemies';
import { isProjectileRegistered } from '../combat/projectile-pool';
import type { ModelSpec } from '../ecs/model-types';

// Content cross-reference validator. TypeScript proves the SHAPE of every
// spec, but it cannot prove that a STRING ID points at something real:
// a weapon's `onHit.buffId`, a drop pool's `itemId`, a `ranged.projectileId`,
// an `affixPool` entry, a `setId`. A typo in any of those compiles fine and
// then silently no-ops at runtime — the exact bug that kept the wand's chill
// dormant for weeks.
//
// validateContent() walks the whole content web once at boot and THROWS with
// every broken reference listed at once, so an author (human or LLM) sees a
// precise, complete error instead of a quiet dead feature. This is what makes
// the content layer safe to author by editing data alone: get a reference
// wrong and the game refuses to start with a message naming the offender.
//
// Run AFTER registerProjectiles() (projectile ids are registered at runtime).
// Mirrors the tile-char validation already living at the bottom of enemies.ts.

function isBuff(id: string): boolean { return id in BUFFS; }
function isItem(id: string): boolean { return id in ITEMS; }
function isAffix(id: string): boolean { return id in AFFIXES; }
function isSet(id: string): boolean { return id in SETS; }
function isEnemy(id: string): boolean { return id in ENEMIES; }

/** Validate a model: every part's `mat` must exist in `materials`, and
 *  every `parent` must name a known part or slot. Catches the two most
 *  common model-authoring typos. These are WARNINGS, not throws — a bad
 *  material usually surfaces visually (wrong-coloured mesh) rather than
 *  silently, and parametric builders (creature()) have nesting the static
 *  check can't always follow — so we don't want a model edge case to
 *  white-screen the game the way a dead id reference must. */
function validateModel(model: ModelSpec, where: string, warns: string[]): void {
  const mats = new Set(Object.keys(model.materials ?? {}));
  const partNames = new Set<string>();
  for (const p of model.parts) if (p.name) partNames.add(p.name);
  const slotNames = new Set(Object.keys(model.slots ?? {}));
  for (let i = 0; i < model.parts.length; i++) {
    const p = model.parts[i];
    if ('mat' in p && p.mat && !mats.has(p.mat)) {
      warns.push(`${where}: model '${model.id}' part[${i}] uses material '${p.mat}' not in materials {${[...mats].join(', ')}}`);
    }
    if (p.parent && !partNames.has(p.parent) && !slotNames.has(p.parent)) {
      warns.push(`${where}: model '${model.id}' part[${i}] parent '${p.parent}' is not a known part name or slot`);
    }
  }
}

function validateItem(id: string, item: ItemSpec, errs: string[], warns: string[]): void {
  const w = `item '${id}'`;
  if (item.weapon?.onHit && !isBuff(item.weapon.onHit.buffId)) {
    errs.push(`${w}: weapon.onHit.buffId '${item.weapon.onHit.buffId}' is not a registered buff`);
  }
  if (item.weapon?.ranged && !isProjectileRegistered(item.weapon.ranged.projectileId)) {
    errs.push(`${w}: weapon.ranged.projectileId '${item.weapon.ranged.projectileId}' is not a registered projectile`);
  }
  if (item.consumableBuff && !isBuff(item.consumableBuff.buffId)) {
    errs.push(`${w}: consumableBuff.buffId '${item.consumableBuff.buffId}' is not a registered buff`);
  }
  for (const aid of item.affixPool ?? []) {
    if (!isAffix(aid)) errs.push(`${w}: affixPool entry '${aid}' is not a registered affix`);
  }
  if (item.setId && !isSet(item.setId)) {
    errs.push(`${w}: setId '${item.setId}' is not a registered set`);
  }
  validateModel(item.dropModel, w, warns);
  if (item.viewmodel) validateModel(item.viewmodel, w, warns);
}

function validateEnemy(id: string, spec: EnemySpec, errs: string[], warns: string[]): void {
  const w = `enemy '${id}'`;
  if (spec.onHit && !isBuff(spec.onHit.buffId)) {
    errs.push(`${w}: onHit.buffId '${spec.onHit.buffId}' is not a registered buff`);
  }
  if (spec.ranged && !isProjectileRegistered(spec.ranged.projectileId)) {
    errs.push(`${w}: ranged.projectileId '${spec.ranged.projectileId}' is not a registered projectile`);
  }
  if (spec.splitsInto && !isEnemy(spec.splitsInto.enemyId)) {
    errs.push(`${w}: splitsInto.enemyId '${spec.splitsInto.enemyId}' is not a registered enemy`);
  }
  for (const ab of spec.abilities ?? []) {
    for (const step of ab.steps) {
      const a = step.action;
      if (a.kind === 'projectile' && !isProjectileRegistered(a.projectileId)) {
        errs.push(`${w}: ability '${ab.id}' projectile '${a.projectileId}' is not a registered projectile`);
      }
    }
  }
  const drops = spec.drops;
  if (drops) {
    for (const gid of drops.guaranteed ?? []) {
      if (!isItem(gid)) errs.push(`${w}: guaranteed drop '${gid}' is not a registered item`);
    }
    for (const p of drops.pool ?? []) {
      if (!isItem(p.itemId)) errs.push(`${w}: drop pool '${p.itemId}' is not a registered item`);
    }
  }
}

function validateAffixesAndSets(errs: string[]): void {
  for (const [id, a] of Object.entries(AFFIXES)) {
    if (a.onHit && !isBuff(a.onHit.buffId)) {
      errs.push(`affix '${id}': onHit.buffId '${a.onHit.buffId}' is not a registered buff`);
    }
  }
  for (const [id, s] of Object.entries(SETS)) {
    for (const b of s.bonuses) {
      if (b.onHit && !isBuff(b.onHit.buffId)) {
        errs.push(`set '${id}': bonus(${b.pieces}) onHit.buffId '${b.onHit.buffId}' is not a registered buff`);
      }
    }
    // Orphan check — a set nobody belongs to is dead content; warn loudly
    // but don't fail (it may be authored ahead of its items).
    const members = Object.values(ITEMS).filter((it) => it.setId === id).length;
    if (members === 0) {
      console.warn(`[content] set '${id}' has no member items (no ItemSpec.setId === '${id}')`);
    }
  }
}

/**
 * Validate every cross-reference in the content registries. Throws with a
 * complete list of broken references if any are found. Call once at boot,
 * AFTER registerProjectiles().
 */
export function validateContent(): void {
  const errs: string[] = [];
  const warns: string[] = [];
  for (const [id, item] of Object.entries(ITEMS)) validateItem(id, item, errs, warns);
  for (const [id, spec] of Object.entries(ENEMIES)) validateEnemy(id, spec, errs, warns);
  validateAffixesAndSets(errs);
  for (const warn of warns) console.warn(`[content] ${warn}`);
  if (errs.length) {
    throw new Error(
      `Content validation failed (${errs.length} broken reference${errs.length === 1 ? '' : 's'}):\n  - ` +
      errs.join('\n  - '),
    );
  }
}
