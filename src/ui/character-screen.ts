import { isScreenOpen } from './screen-manager';
import { createSheet, type Sheet } from './menu-shell';
import { getCharacter, onCharacterChanged, proficiencyTier, loreAfflictionDurationMul, loreAfflictionPotencyMul } from '../state/character';
import { getRunState } from '../state/run-state';
import { getMeta } from '../state/meta-state';
import { getPlayerSnapshot } from '../state/player-stats';
import { getPlayerHp } from '../player/health';
import { getEmber, onEmberChanged } from '../player/ember';
import { getEquipped } from '../player/equipment';
import { getCurrentWeapon } from '../player/current-weapon';
import { proficiencyGains } from '../content/weapon-classes';
import { buildReadingView, type ReadingRow } from './kit/reading';

// CHARACTER — what you are, this descent (Lamplight, 2026-11-23).
//
// The draft's pattern: a few rows, the chosen one explained in the scorched
// slab. Only what the game USES is here. The old sheet listed four attributes
// and eleven proficiencies; nothing grants attribute points any more (Might,
// Finesse and Grit sat at 0 for ever), and only weapon-class proficiency
// changes a number. Lore stays (reading notes raises it and it strengthens
// what you inflict); the weapon you hold shows its mastery. Review only: the
// book reflects the build, it never changes it.

const SCREEN_ID = 'character';
let sheet: Sheet | null = null;

const pct = (f: number): string => `${Math.round(f * 100)}%`;

const GAIN_WORDS: Record<string, string> = {
  speed: 'faster', damage: 'harder', stagger: 'more stagger', crit: 'crit chance',
  comboWindow: 'looser combos', reach: 'more reach',
};

function characterRows(): ReadingRow[] {
  const snap = getPlayerSnapshot();
  const c = getCharacter();
  const run = getRunState();
  const meta = getMeta();
  const rows: ReadingRow[] = [];

  rows.push({
    key: 'health', label: 'Health', value: `${getPlayerHp()} / ${snap.maxHp}`,
    text: 'What the dark must take before you fall. The flask and the fountains give it back; the deals ask for it.',
  });
  const ember = getEmber();
  if (ember > 0) {
    rows.push({
      key: 'ember', label: 'Ember', value: `${ember}`,
      text: 'Borrowed life over your own. Blows spend it first, and some bargains take it as their price.',
      note: 'It stays until something takes it, and dies with the run.',
    });
  }

  const weapon = getEquipped('weapon');
  const dmgNote = snap.damageMultiplier !== 1 || snap.weaponDamageBonus > 0
    ? `${snap.weaponBaseDamage.toFixed(1)} from the weapon${snap.weaponDamageBonus > 0 ? `, +${snap.weaponDamageBonus} from what you carry` : ''}${snap.damageMultiplier !== 1 ? `, ×${snap.damageMultiplier.toFixed(2)}` : ''}.`
    : undefined;
  rows.push({
    key: 'damage', label: 'Damage', value: snap.weaponDamage.toFixed(1),
    kind: weapon ? weapon.name : 'Bare hands',
    text: 'What one ordinary blow does, before a critical strike or a finisher.',
    note: dmgNote,
  });
  rows.push({
    key: 'reach', label: 'Reach', value: `${snap.weaponReach.toFixed(1)} m`,
    text: 'How far the weapon in your hand can find a body.',
  });
  if (snap.physicalArmor > 0 || snap.magicArmor > 0) {
    rows.push({
      key: 'armour', label: 'Armour', value: `${snap.physicalArmor} · ${snap.magicArmor}`,
      text: 'Steel against steel, and something against the rest. Each point turns part of a blow aside.',
      note: `${snap.physicalArmor} against blows, ${snap.magicArmor} against sorcery.`,
    });
  }

  // Mastery of the weapon in hand: use sharpens it.
  const cls = getCurrentWeapon().class ?? 'fist';
  const pts = c.proficiencies[cls] ?? 0;
  const tier = proficiencyTier(pts);
  const gains = Object.entries(proficiencyGains(cls, pts))
    .filter(([, v]) => (v ?? 0) > 0.0005)
    .map(([k, v]) => `+${pct(v ?? 0)} ${GAIN_WORDS[k] ?? k}`);
  const clsName = cls === 'fist' ? 'bare hands' : cls.replace('-', ' ');
  rows.push({
    key: 'mastery', label: 'Mastery', value: tier.name,
    kind: clsName,
    text: `Every blow landed with the ${clsName} teaches the hand. It grows quicker, surer or heavier as it learns.`,
    note: (gains.length ? `So far: ${gains.join(', ')}. ` : 'Nothing learned yet. ')
      + (tier.nextAt === null ? 'It has nothing left to teach.' : `${pts} of ${tier.nextAt} toward the next.`),
  });

  // Lore: reading the notes of the dead.
  const lore = c.attributes.lore;
  if (lore > 0) {
    rows.push({
      key: 'lore', label: 'Lore', value: `${lore}`,
      text: 'Every note of the dead you read stays with you. What you inflict lasts longer and bites harder for it.',
      note: `Afflictions last ${pct(loreAfflictionDurationMul() - 1)} longer and strike ${pct(loreAfflictionPotencyMul() - 1)} harder.`,
    });
  }

  rows.push({
    key: 'descent', label: 'This descent', value: `Depth ${run?.depth ?? 0}`,
    text: `${run?.kills ?? 0} slain, ${run?.gold ?? 0} gold, ${run?.itemsFound.length ?? 0} things found.`,
    note: `The deepest anyone with your name has gone: Depth ${meta.deepestDepth}.`,
  });
  return rows;
}

/** The character body as a reading view, rebuilt when what it shows changes.
 *  Reusable as the satchel's CHARACTER tab and the standalone sheet. */
export function buildCharacterContent(): { el: HTMLDivElement; dispose: () => void } {
  const el = document.createElement('div');
  el.className = 'lk-fill';
  const render = (): void => { el.replaceChildren(buildReadingView([{ rows: characterRows() }])); };
  render();
  const offChar = onCharacterChanged(render);
  const offEmber = onEmberChanged(render);
  return { el, dispose() { offChar(); offEmber(); } };
}

export function openCharacterScreen(): void {
  if (isScreenOpen(SCREEN_ID)) return;
  const content = buildCharacterContent();
  const s = createSheet({
    id: SCREEN_ID,
    title: 'CHARACTER',
    width: 720,
    height: 560,   // fixed: choosing an entry never resizes the frame
    layer: 'modal',
    policy: { hidesHud: true },
    onClose() {
      content.dispose();
      sheet = null;
    },
  });
  sheet = s;
  s.body.appendChild(content.el);
  s.open();
}

export function closeCharacterScreen(): void {
  sheet?.close();
}

export function isCharacterScreenOpen(): boolean {
  return isScreenOpen(SCREEN_ID);
}
