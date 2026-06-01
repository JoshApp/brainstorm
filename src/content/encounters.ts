// Encounter archetypes — coherent enemy packs for a room, instead of rolling
// each X slot independently (which produces incoherent grab-bags: a tank +
// four ranged with no melee). A combat vault opts in with an `encounter` tag;
// the composer then fills ALL its X slots from one rolled pack keyed to the
// archetype, depth-scaled. The author still places the spawn POINTS (the
// spatial design); only the roster rolls.
//
// "Coherence is a room-level property" — so this is decided per room, not per
// tile. See populateTemplate (procgen.ts) for where it's applied.

export type EncounterArchetype = 'swarm' | 'bruisers' | 'caster-pack' | 'mixed';
export type EncounterIntensity = 'light' | 'medium' | 'heavy';

export interface EncounterSpec {
  archetype: EncounterArchetype;
  /** Default 'medium'. 'heavy' upgrades one slot to an elite. */
  intensity?: EncounterIntensity;
}

/** Enemy role buckets (ids must exist in the registry — validated at module
 *  load in procgen.ts alongside the roll tables). A pack draws from these,
 *  filtered to what's available at the current depth. */
export const ROLE = {
  light:  ['rat', 'skirmisher', 'carrion-hound'],
  heavy:  ['ghoul', 'stoneguard', 'skeleton', 'ooze'],
  ranged: ['acolyte', 'acid-spitter', 'sump-wisp', 'plague-spore'],
  elite:  ['wraith', 'defiler', 'spider'],
} as const;

export type Role = keyof typeof ROLE;

/** Per archetype, the role each X slot draws from, in reading order (cycled if
 *  there are more slots than entries). Index 0 is the "anchor" — author puts
 *  the lead enemy's spawn point first if it matters. */
export const ARCHETYPE_SLOTS: Record<EncounterArchetype, Role[]> = {
  // Lots of fast, weak bodies — overwhelm. One heavy at the back to anchor.
  swarm: ['light', 'light', 'light', 'light', 'heavy'],
  // Slow, armoured grind. Mostly heavy melee, a single light flanker.
  bruisers: ['heavy', 'heavy', 'light', 'heavy'],
  // Casters behind a melee guard — forces you to close under fire.
  'caster-pack': ['heavy', 'ranged', 'ranged', 'ranged'],
  // A balanced squad: an anchor, a flanker, a ranged threat.
  mixed: ['heavy', 'light', 'ranged', 'light'],
};
