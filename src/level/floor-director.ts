// The FLOOR DIRECTOR — the one manager that owns a floor's content PLAN.
//
// Before this, the floor's decisions were scattered inline in vault-compose:
// roll the budget here, place a fire there, stage a find lower down. The
// director gathers all of it into a single pure decision: given the floor's
// rooms (roles), its dumb markers, and what's already baked in, decide WHAT
// content this floor gets and WHERE — the fire, the combat budget, the defining
// find, and the one staged deal — then hand a plan back for the composer to
// execute (docs/FLOOR-DIRECTOR.md; the resolveFloor layer of LEVEL-PIPELINE).
//
// It also owns VARIETY: duplicates are allowed, but the floor never SPAMS one
// kind — a second heal fountain kills run tension, so the director won't choose
// one when the floor already has it (soft caps below; the manifest is the hard
// backstop). Pure + deterministic: same inputs + seed → same plan.

import { floorContentBudget, type FloorContentBudget } from './content-budget';
import {
  fillDefiningFind, fillQuestion,
  type ContentSpot, type DefiningFind, type StagedDeal, type DealKind,
} from './floor-fill';
import type { FloorRoles } from './floor-roles';
import type { PropSpec } from './types';
import { CONFIG } from '../config';

/** A candidate bonfire site — an authored fire anchor or an open floor cell. */
export interface FireSite { x: number; z: number; roomId: string }

export interface DirectorInput {
  depth: number;
  rand: () => number;
  roles: FloorRoles;
  /** Authored fire anchors (already reserved off the enemy pool). */
  fireAnchors: readonly FireSite[];
  /** Open floor cells the fire may fall back to when no anchor fits. */
  fireFallbackCells: readonly FireSite[];
  /** Dumb content markers the find + deal may claim. */
  contentSpots: readonly ContentSpot[];
  /** Everything already placed (vault-baked + `?`-slot) — read for VARIETY so
   *  the director doesn't stage a kind the floor already has. */
  bakedProps: readonly PropSpec[];
}

export interface FloorPlan {
  /** The combat budget the composer injects (count + intensity). */
  budget: FloorContentBudget;
  /** Where the bonfire goes, or null if this floor has none. */
  fire: FireSite | null;
  /** If the fire took an open ENEMY cell (not an anchor), that cell — the
   *  composer removes it from the spawn pool. Null when the fire used an anchor. */
  fireCell: { x: number; z: number } | null;
  /** The room the fire turns into a sanctum, if any. */
  sanctumRoomId: string | null;
  /** The floor's staged reward, or null. */
  find: DefiningFind | null;
  /** The floor's staged question (deal), or null. */
  deal: StagedDeal | null;
}

// Soft per-floor caps for the variety ledger. Duplicates are allowed up to the
// cap; past it the director stops CHOOSING that kind (it won't spam heal
// fountains). Kinds absent here are unconstrained.
const DEAL_SOFT_CAP: Partial<Record<DealKind, number>> = {
  fountain: 1,        // one heal per floor — a second free top-up kills tension
  'blood-altar': 1,   // one gamble per floor — two flattens the choice
  altar: 1,
  'tithe-basin': 1,
};

const ALL_DEALS: readonly DealKind[] = ['fountain', 'tithe-basin', 'altar', 'blood-altar'];

/** Decide the whole floor's content plan. Pure — no scene, no props mutated. */
export function directFloor(input: DirectorInput): FloorPlan {
  const { depth, rand, roles, fireAnchors, fireFallbackCells, contentSpots, bakedProps } = input;

  // Budget FIRST (fixed rand order): combat, loot, events all roll here.
  const budget = floorContentBudget(depth, rand);

  // ── FIRE — the best-scored home: an authored anchor beats an open cell, and a
  //    quiet dead-end pocket beats a through-room (roles.bonfireScore). ──
  let fire: FireSite | null = null;
  let fireCell: { x: number; z: number } | null = null;
  let sanctumRoomId: string | null = null;
  if (budget.events.minorFire) {
    const best = (list: readonly FireSite[]): FireSite | null => {
      if (list.length === 0) return null;
      let top = -Infinity;
      for (const c of list) top = Math.max(top, roles.bonfireScore(c.roomId));
      const tied = list.filter((c) => roles.bonfireScore(c.roomId) === top);
      return tied[Math.floor(rand() * tied.length)];
    };
    fire = best(fireAnchors);
    if (!fire) {
      const eligible = fireFallbackCells.filter((c) => roles.caps(c.roomId).allowBonfire);
      const pick = best(eligible.length > 0 ? eligible : fireFallbackCells);
      if (pick) { fire = pick; fireCell = { x: pick.x, z: pick.z }; }
    }
    if (fire) sanctumRoomId = fire.roomId;
  }

  // ── DEFINING FIND — a staged reward on a focal loot-marker. ──
  const find = fillDefiningFind(contentSpots, roles, budget.loot, depth, rand);

  // ── STAGED DEAL — the floor's QUESTION, variety-filtered so it never spams a
  //    kind the floor already carries, and never on the find's own marker. ──
  let deal: StagedDeal | null = null;
  if (budget.events.question) {
    const ledger = countDeals(bakedProps);
    const allowed = ALL_DEALS.filter((k) => (ledger[k] ?? 0) < (DEAL_SOFT_CAP[k] ?? Infinity));
    deal = fillQuestion(
      contentSpots, roles, allowed, depth,
      CONFIG.CONTENT_BUDGET.QUESTION_DEEP_DEPTH, rand, find?.spot ?? null,
    );
  }

  return { budget, fire, fireCell, sanctumRoomId, find, deal };
}

/** Count already-placed deal props by kind, for the variety ledger. */
export function countDeals(props: readonly PropSpec[]): Partial<Record<DealKind, number>> {
  const c: Partial<Record<DealKind, number>> = {};
  for (const p of props) {
    if (p.kind === 'fountain' || p.kind === 'tithe-basin' || p.kind === 'altar' || p.kind === 'blood-altar') {
      c[p.kind] = (c[p.kind] ?? 0) + 1;
    }
  }
  return c;
}
