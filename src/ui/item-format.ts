import type { ItemSpec, WeaponStats } from '../content/items';
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
  return `Base Damage ${w.damage}  ·  Reach ${w.reach.toFixed(1)}m  ·  Arc ${(w.coneHalfAngle * 180 / Math.PI).toFixed(0)}°`;
}

export function formatModifier(m: StatModifier): string {
  switch (m.kind) {
    case 'max-hp':                return signed(m.amount) + ' Max HP';
    case 'weapon-damage':         return signed(m.amount) + ' Damage';
    case 'damage-multiplier':     return `×${m.amount.toFixed(2)} Damage`;
    case 'finisher-damage-mult':  return `×${m.amount.toFixed(2)} Finisher Damage`;
    case 'physical-armor':        return signed(m.amount) + ' Physical Armor';
    case 'magic-armor':           return signed(m.amount) + ' Magic Armor';
  }
}

export function formatPassive(p: PassiveSpec): string {
  const triggerLabel = ({
    hit: 'On hit',
    killed: 'On kill',
    damaged: 'When damaged',
    died: 'On death',
    interval: 'Periodically',
  } as const)[p.trigger.on];

  const effects = p.trigger.effects.map((e) => {
    if (e.type === 'damage')   return `${e.amount} damage`;
    if (e.type === 'heal')     return `heal ${e.amount} HP`;
    if (e.type === 'apply-buff' && e.buffId) {
      return formatBuffEffect(e.buffId, e.duration ?? 0);
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
    if (e.type === 'heal') parts.push(`+${e.amount} HP every ${spec.tickInterval}s`);
    if (e.type === 'damage') parts.push(`-${e.amount} HP every ${spec.tickInterval}s`);
  }
  const effectStr = parts.length ? ` (${parts.join(', ')})` : '';
  return `${name}${effectStr} for ${duration}s`;
}

/** Strip a leading article and clamp to a tidy width for grid labels. */
export function abbrev(item: ItemSpec): string {
  const name = item.name.replace(/^(A |An |The )/, '');
  return name.length > 22 ? name.slice(0, 20) + '…' : name;
}

/** 0xff7722 → "rgb(255, 119, 34)" — for inline CSS color strings. */
export function hexCss(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}
