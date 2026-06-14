import type { AttributeKind } from '../state/character';

// The four delver attributes, as DISPLAY metadata — one source of truth
// shared by the bonfire level-up menu (where you raise them) and the
// tome-pillar character screen (where you review them). Keep the spoken
// names + effect lines here so the two surfaces never drift apart.
//
// `tagline` is a single cruel word for the big level-up cards; `effect`
// is the terse mechanical line the review screen already used.

export interface AttributeDef {
  kind: AttributeKind;
  label: string;
  tagline: string;
  effect: string;
}

export const ATTR_DEFS: AttributeDef[] = [
  { kind: 'might',   label: 'MIGHT',   tagline: 'FORCE',     effect: 'heavy weapons · stagger · +1% all damage' },
  { kind: 'finesse', label: 'FINESSE', tagline: 'PRECISION', effect: 'light & ranged · +2% crit chance' },
  { kind: 'lore',    label: 'LORE',    tagline: 'RUIN',      effect: 'arcane · stronger afflictions · +1% all damage' },
  { kind: 'grit',    label: 'GRIT',    tagline: 'ENDURANCE', effect: 'armour scaling · +3 max HP' },
];
