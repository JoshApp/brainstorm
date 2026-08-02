// FACTIONS — who fights whom.
//
// The mechanism that lets the dungeon count "what is what" instead of leaning on
// placement hacks (e.g. spawning ambient life with a null room so it doesn't gate
// a door). A creature declares a faction; the systems that care about THREAT — AI
// aggro and room-clear — ask the faction, not the geometry.
//
// Kept as a small hostility MATRIX rather than a bool so the next steps don't
// rewrite callers: a predator that hunts vermin, vermin that swarm the dead, a
// charmed mob that turns on the horde — all are edits to HOSTILITY, and every
// consumer already routes through isHostile().
//
//   - delver  : the player (implicit — never an enemy spec's faction).
//   - hollow  : the dungeon's hostile dead — the default horde that hunts you.
//   - vermin  : neutral ambient life (maggots). Hunts nothing yet; can't gate a
//               door, doesn't aggro. The player can still cut it down (the swing
//               resolves on any body — factions gate INTENT, not vulnerability).

export type FactionId = 'delver' | 'hollow' | 'vermin';

/** Who each faction is hostile toward (will aggro / attack). The player's own
 *  entry is informational — the swing hits any Damageable regardless — but keeps
 *  the matrix total so future inter-faction rules have one place to live. */
const HOSTILITY: Record<FactionId, readonly FactionId[]> = {
  delver: ['hollow', 'vermin'],
  hollow: ['delver'],
  vermin: [],
};

/** Faction a spec gets when it declares none — the hostile horde. So every
 *  existing enemy stays hostile with zero edits; only neutrals opt out. */
export const DEFAULT_FACTION: FactionId = 'hollow';

/** Does `from` hunt `to`? The single predicate every faction question routes
 *  through, so inter-faction behaviour is one table edit away. */
export function isHostile(from: FactionId, to: FactionId): boolean {
  return HOSTILITY[from]?.includes(to) ?? false;
}

/** Does a mob of this faction hunt the PLAYER? Drives AI aggro (a neutral never
 *  targets you) AND room-clear (only player-threats hold a sealed door). Omitted
 *  faction = the default horde, so untagged enemies read as threats. */
export function threatensPlayer(faction: FactionId | undefined): boolean {
  return isHostile(faction ?? DEFAULT_FACTION, 'delver');
}
