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
export interface FireSite { x: number; z: number; roomId: string; openness?: number }

export interface DirectorInput {
  depth: number;
  rand: () => number;
  roles: FloorRoles;
  /** Authored fire anchors (already reserved off the enemy pool). */
  fireAnchors: readonly FireSite[];
  /** The FLOOR PLAN already staged this floor's fire as a room centrepiece —
   *  don't roll a second one. A fire is now a planned `mercy` entry rather than
   *  a per-floor sprinkle, and two of them undoes the scarcity that makes
   *  reaching one matter. */
  suppressFire?: boolean;
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
  // The plan owns the fire when it rolled a sanctum — see DirectorInput.suppressFire.
  if (budget.events.minorFire && !input.suppressFire) {
    const best = (list: readonly FireSite[]): FireSite | null => {
      if (list.length === 0) return null;
      let top = -Infinity;
      for (const c of list) top = Math.max(top, roles.bonfireScore(c.roomId));
      const tied = list.filter((c) => roles.bonfireScore(c.roomId) === top);
      // Among rooms tied on score, prefer the most OPEN spot — a bonfire in a
      // corner reads as obstructed; centred / mid-wall breathes.
      let bestOpen = -Infinity;
      for (const c of tied) bestOpen = Math.max(bestOpen, c.openness ?? 0);
      const open = tied.filter((c) => (c.openness ?? 0) === bestOpen);
      return open[Math.floor(rand() * open.length)];
    };
    fire = best(fireAnchors);
    if (!fire) {
      const eligible = fireFallbackCells.filter((c) => roles.caps(c.roomId).allowBonfire);
      const pick = best(eligible.length > 0 ? eligible : fireFallbackCells);
      if (pick) { fire = pick; fireCell = { x: pick.x, z: pick.z }; }
    }
    if (fire) sanctumRoomId = fire.roomId;
  }

  // SPREAD the major beats across ROOMS: the fire, the find, and the deal each
  // want the "best" room, so left alone they pile into one room's middle (a
  // bonfire + a fountain + an altar all centred together — reported). Steer the
  // find away from the fire's room, and the deal away from BOTH — but only when
  // the floor has the rooms to spare (fall back to all spots rather than fail to
  // place on a small floor).
  const away = (spots: readonly ContentSpot[], rooms: ReadonlySet<string>): readonly ContentSpot[] => {
    if (rooms.size === 0) return spots;
    const other = spots.filter((s) => !rooms.has(s.roomId));
    return other.length > 0 ? other : spots;
  };
  const usedRooms = new Set<string>();
  if (fire) usedRooms.add(fire.roomId);
  // Points staged content must not crowd — the fire first; the find joins it once
  // placed. Keeps a reward chest off the bonfire even when a small floor forces
  // them into the same room (the room's offset marker gives it somewhere to go).
  const avoid: Array<{ x: number; z: number }> = fire ? [{ x: fire.x, z: fire.z }] : [];

  // ── DEFINING FIND — a staged reward on a focal loot-marker, away from the fire. ──
  const find = fillDefiningFind(away(contentSpots, usedRooms), roles, budget.loot, depth, rand, avoid);
  if (find) { usedRooms.add(find.spot.roomId); avoid.push({ x: find.x, z: find.z }); }

  // ── STAGED DEAL — the floor's QUESTION, variety-filtered so it never spams a
  //    kind the floor already carries, kept off the find's own marker, and out of
  //    the fire's + find's rooms so the floor's beats don't cluster. ──
  let deal: StagedDeal | null = null;
  if (budget.events.question) {
    const ledger = countDeals(bakedProps);
    const allowed = ALL_DEALS.filter((k) => (ledger[k] ?? 0) < (DEAL_SOFT_CAP[k] ?? Infinity));
    // HARD RULE: a deal (fountain / basin / altar) is a MAJOR event, and the fire
    // is one too — they must NEVER share a room (a small room with a bonfire AND a
    // choice basin reads cramped + robotic). So the deal's pool EXCLUDES the fire's
    // room entirely; it prefers a room with neither fire nor find, but may fall
    // back into the find's room (loot, not a second major). If the only spots left
    // are in the fire's room, the floor simply gets no second event — better than a
    // crammed one.
    const fireRoom = fire?.roomId;
    const offFire = contentSpots.filter((s) => s.roomId !== fireRoom);
    const preferred = offFire.filter((s) => !usedRooms.has(s.roomId));
    const dealPool = preferred.length > 0 ? preferred : offFire;
    if (dealPool.length > 0) {
      deal = fillQuestion(
        dealPool, roles, allowed, depth,
        CONFIG.CONTENT_BUDGET.QUESTION_DEEP_DEPTH, rand, find?.spot ?? null, avoid,
      );
    }
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
