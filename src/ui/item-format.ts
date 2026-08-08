import type { ItemSpec, WeaponStats, CombatVerb } from '../content/items';
import type { StatModifier } from '../combat/modifiers';
import type { PassiveSpec } from '../ecs/types';
import { BUFFS } from '../content/buffs';

// Pure item → human-readable text formatting. Lifted out of inventory-panel
// so the strings have one home, can be reused (tooltips, codex, pickup blurbs),
// and are unit-testable without a DOM. No DOM, no module state — just data in,
// string out. The panel builds the actual <div>s from these.

/** "+3" / "-2" — always shows a sign. */
export function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

export function formatWeapon(w: WeaponStats): string {
  if (w.ranged) {
    // Ranged weapons hit-test the bolt, not a cone — reach/arc are the
    // auto-aim window, not a melee swing, so present them as range.
    return `Base Damage ${w.damage}  ·  Ranged  ·  Range ${(w.reach ?? 0).toFixed(0)}m`;
  }
  // Melee reach is derived from the weapon model at load, so it's always set here.
  return `Base Damage ${w.damage}  ·  Reach ${(w.reach ?? 0).toFixed(1)}m  ·  Arc ${(w.coneHalfAngle * 180 / Math.PI).toFixed(0)}°`;
}

/** "On hit: Bleed (50%)" — the weapon/affix/set status applicator line. */
export function formatOnHit(oh: { buffId: string; chance: number; duration: number }): string {
  const spec = BUFFS[oh.buffId];
  const name = spec?.displayName ?? oh.buffId;
  return `On hit: ${name} (${Math.round(oh.chance * 100)}%)`;
}

/** A reactive COMBAT VERB line — "On riposte: Bleed", "On perfect dodge:
 *  Haste (self)". `label` is the trigger ("On riposte" / "On perfect dodge"
 *  / "On empowered hit"); the verb names its buff, optional chance + target. */
export function formatCombatVerb(label: string, v: CombatVerb): string {
  const spec = BUFFS[v.buffId];
  const name = spec?.displayName ?? v.buffId;
  const chance = v.chance != null && v.chance < 1 ? ` (${Math.round(v.chance * 100)}%)` : '';
  const tgt = v.target === 'self' ? ' on self' : '';
  return `${label}: ${name}${chance}${tgt}`;
}

/** "Charged release: …" — the signature charged-attack effect, so a weapon
 *  that does something special on a full charge actually says so. */
export function formatChargedEffect(c: NonNullable<WeaponStats['chargedEffect']>): string {
  switch (c.kind) {
    case 'projectile': return 'Charged release: looses a bolt of force';
  }
}

export function formatModifier(m: StatModifier): string {
  switch (m.kind) {
    case 'max-hp':                return signed(m.amount) + ' Max HP';
    case 'weapon-damage':         return signed(m.amount) + ' Damage';
    case 'damage-multiplier':     return `×${m.amount.toFixed(2)} Damage`;
    case 'finisher-damage-mult':  return `×${m.amount.toFixed(2)} Finisher Damage`;
    case 'physical-armor':        return signed(m.amount) + ' Physical Armor';
    case 'magic-armor':           return signed(m.amount) + ' Magic Armor';
    case 'incoming-damage-mult':  return `×${m.amount.toFixed(2)} Damage Taken`;
    case 'move-speed-mult':       return `×${m.amount.toFixed(2)} Move Speed`;
    case 'action-speed-mult':     return `×${m.amount.toFixed(2)} Attack Speed`;
    case 'crit-chance':           return signedPct(m.amount) + ' Crit Chance';
    case 'crit-mult':             return (m.amount >= 0 ? '+' : '') + m.amount.toFixed(2) + ' Crit Multiplier';
    case 'lifesteal-pct':         return signedPct(m.amount) + ' Lifesteal';
    case 'bleed-chain':           return 'A dying bleeder bleeds those near it';
    case 'bleed-feed':            return `Heal ${m.amount} on a bleeding kill`;
  }
}

/** Format a 0..1 value as a signed percentage (e.g. 0.10 → "+10%"). */
function signedPct(amount: number): string {
  const pct = Math.round(amount * 100);
  return (pct >= 0 ? '+' : '') + pct + '%';
}

export function formatPassive(p: PassiveSpec): string {
  const base = ({
    hit: 'On hit',
    crit: 'On crit',
    killed: 'On kill',
    damaged: 'When damaged',
    died: 'On death',
    interval: 'Periodically',
    deflect: 'On a clean deflect',
    'just-dodge': 'On a perfect dodge',
    gold: 'When gold is taken',
    chest: 'On opening a chest',
    deal: 'On striking a deal',
  } as const)[p.trigger.on];
  // A victim-state gate folds into the trigger phrase: "On kill" +
  // {victimHasBuff: 'bleed'} → "On killing a foe marked BLEED".
  const cond = p.trigger.condition;
  const triggerLabel = cond?.victimHasBuff
    ? `On killing a foe marked ${BUFFS[cond.victimHasBuff]?.displayName ?? cond.victimHasBuff.toUpperCase()}`
    : base;

  const effects = p.trigger.effects.map((e) => {
    // WHO the effect lands on — the reactive triggers (When damaged) inflict on
    // the ATTACKER, not the player, but the description used to drop the target,
    // so "When damaged: Bleed for 4s" read as if YOU bleed. State the subject.
    const tgt = (e as { target?: string }).target;
    const on = tgt === 'attacker' ? ' on the attacker'
      : tgt === 'self' ? ' on yourself'
      : tgt === 'enemy' ? ' on the foe'
      : '';
    if (e.type === 'damage')   return `${e.amount} damage${on}`;
    if (e.type === 'heal')     return `heal ${e.amount} HP`;   // heal is always self
    if (e.type === 'apply-buff' && e.buffId) {
      return `${formatBuffEffect(e.buffId, e.duration ?? 0)}${on}`;
    }
    return e.type;
  });
  return `${triggerLabel}: ${effects.join(', ')}`;
}

export function formatBuffEffect(buffId: string, duration: number): string {
  const spec = BUFFS[buffId];
  if (!spec) return `${buffId} for ${duration}s`;
  const name = spec.displayName ?? buffId;

  const parts: string[] = [];
  if (spec.modifiers) {
    for (const m of spec.modifiers) parts.push(formatModifier(m));
  }
  if (spec.tickInterval && spec.tickEffect) {
    const e = spec.tickEffect;
    // One decimal. The DoT intervals are DERIVED from the health pool now
    // (config.ts DOT_BUDGET), so they are no longer round numbers — printing
    // `spec.tickInterval` raw put "-1 HP every 1.28s" on an item card.
    const every = `${(Math.round(spec.tickInterval * 10) / 10).toFixed(1)}s`;
    if (e.type === 'heal') parts.push(`+${e.amount} HP every ${every}`);
    if (e.type === 'damage') parts.push(`-${e.amount} HP every ${every}`);
  }
  const effectStr = parts.length ? ` (${parts.join(', ')})` : '';
  return `${name}${effectStr} for ${duration}s`;
}

/** One set-bonus tier as "(2) +1 Physical Armor, On hit: Poison (35%)". */
export function formatSetBonus(b: {
  pieces: number;
  modifiers?: StatModifier[];
  onHit?: { buffId: string; chance: number; duration: number };
}): string {
  const parts: string[] = [];
  if (b.modifiers) for (const m of b.modifiers) parts.push(formatModifier(m));
  if (b.onHit) parts.push(formatOnHit(b.onHit));
  return `(${b.pieces}) ${parts.join(', ')}`;
}

/** Strip a leading article and clamp to a tidy width for grid labels. */
export function abbrev(item: ItemSpec): string {
  const name = item.name.replace(/^(A |An |The )/, '');
  return name.length > 22 ? name.slice(0, 20) + '…' : name;
}

