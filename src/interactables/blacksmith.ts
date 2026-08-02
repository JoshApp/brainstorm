import * as THREE from 'three';
import type { ModelSpec } from '../ecs/model-types';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { registerLight } from '../scene/light-pool';
import { createSheet, menuButton } from '../ui/menu-shell';
import { getEquipped } from '../player/equipment';
import { getGold, spendGold } from '../state/run-state';
import {
  getTemperLevel, canTemper, temperWeapon, MAX_TEMPER_LEVEL,
  TEMPER_DAMAGE_PER_LEVEL,
} from '../state/weapon-temper';
import { playEquipClick, playImpact } from '../audio/sfx';
import { showInscription } from '../ui/inscription';
import { FONT_UI } from '../ui/theme';

// THE BLACKSMITH — a hooded smith at a lit forge + anvil. Unlike the merchant
// (which SELLS), the smith TEMPERS the weapon in your hand: spend gold to raise
// that blade's forge level, adding flat damage. The upgrade sticks to the WEAPON
// (state/weapon-temper.ts) and survives descents, so you invest in your main and
// carry a keener edge deeper. Gold's second real sink beside the two merchants.

export const BLACKSMITH_MODEL: ModelSpec = {
  id: 'blacksmith',
  materials: {
    robe:  { color: 0x241d18, roughness: 0.98, metalness: 0.0, flatShading: 'auto' },
    iron:  { color: 0x22201d, roughness: 0.5, metalness: 0.85, flatShading: 'auto' },
    stone: { color: 0x3a342c, roughness: 0.96, metalness: 0.0, flatShading: 'auto' },
    coal:  { color: 0x140804, emissive: 0xff6a1a, emissiveIntensity: 2.0, roughness: 1.0 },
    eyes:  { color: 0x000000, emissive: 0xffb060, emissiveIntensity: 1.2, roughness: 1.0 },
  },
  parts: [
    // Broad hooded smith — a touch stockier than the merchant.
    { name: 'body', kind: 'capsule', pos: [-0.05, 0.66, 0], radius: 0.30, height: 0.66, mat: 'robe', jitter: 0.02 },
    { name: 'hood', kind: 'sphere', pos: [-0.05, 1.28, 0], radius: 0.30, scale: [1.0, 1.05, 1.0], mat: 'robe', jitter: 0.02 },
    { kind: 'sphere', pos: [-0.14, 1.30, -0.23], radius: 0.033, mat: 'eyes' },
    { kind: 'sphere', pos: [ 0.04, 1.30, -0.23], radius: 0.033, mat: 'eyes' },
    // The anvil — a horned iron block on a stone stump, to the smith's side.
    { kind: 'cylinder', pos: [0.55, 0.20, 0.02], radius: 0.16, height: 0.40, mat: 'stone' },
    { name: 'anvil', kind: 'box', pos: [0.55, 0.46, 0.02], size: [0.42, 0.14, 0.20], mat: 'iron' },
    { kind: 'box', pos: [0.78, 0.47, 0.02], size: [0.18, 0.08, 0.14], mat: 'iron', rot: [0, 0, -0.1] },   // horn
    // The forge — a low brazier of glowing coals behind, the signal light.
    { kind: 'cylinder', pos: [-0.05, 0.30, 0.42], radius: 0.26, height: 0.30, mat: 'stone' },
    { kind: 'sphere', pos: [-0.05, 0.46, 0.42], radius: 0.20, scale: [1.0, 0.5, 1.0], mat: 'coal' },
    // Hammer resting on the anvil.
    { kind: 'cylinder', pos: [0.50, 0.60, 0.02], radius: 0.014, height: 0.30, rot: [0.5, 0, 0], mat: 'stone' },
    { kind: 'box', pos: [0.50, 0.74, 0.09], size: [0.10, 0.07, 0.07], mat: 'iron' },
  ],
};

/** Base gold cost of a temper, before the level + depth multipliers. */
const TEMPER_COST_BASE = 30;

function temperCost(level: number, depth: number): number {
  const scaled = TEMPER_COST_BASE * (level + 1) * (1 + Math.max(0, depth - 1) * 0.08);
  return Math.max(5, Math.round(scaled / 5) * 5);
}

/** Spawn a blacksmith at a floor position. `depth` drives the temper price. */
export function spawnBlacksmith(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  depth: number,
): void {
  const built = buildModel(BLACKSMITH_MODEL);
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  parent.add(built.group);

  // Forge glow — a warm ember light so the smith reads as an EVENT in torchlight.
  const flickSeed = Math.PI * 0.37;
  registerLight({
    id: `blacksmith-${generateEntityId('forge-light')}`,
    category: 'environment',
    position: new THREE.Vector3(pos.x, pos.y + 0.6, pos.z),
    color: 0xff7a2a, intensity: 2.4, distance: 5.0, decay: 1.8,
    getIntensity: () => {
      const t = performance.now() / 1000;
      return 2.4 * (1 + 0.12 * (0.6 * Math.sin(t * 6.1 + flickSeed) + 0.4 * Math.sin(t * 9.3)));
    },
  });

  registerInteractable({
    id: generateEntityId('blacksmith'),
    position: pos.clone(),
    radius: 1.5,
    promptLabel: 'FORGE',
    labelOffsetY: 1.6,
    onUse() {
      openForgeSheet(pos, depth);
    },
    built,
  });
}

function openForgeSheet(pos: THREE.Vector3, depth: number): void {
  const sheet = createSheet({ id: 'forge', title: 'THE FORGE' });

  const note = document.createElement('div');
  Object.assign(note.style, {
    color: '#8a8079', fontSize: '12px', fontStyle: 'italic',
    padding: '4px 2px 12px', lineHeight: '1.5', fontFamily: FONT_UI,
  } as Partial<CSSStyleDeclaration>);
  sheet.body.appendChild(note);

  const line = document.createElement('div');
  Object.assign(line.style, { color: '#d8c8a8', fontSize: '13px', padding: '2px 2px 8px', fontFamily: FONT_UI } as Partial<CSSStyleDeclaration>);
  sheet.body.appendChild(line);

  const btn = menuButton('TEMPER', () => temper());
  sheet.body.appendChild(btn);

  const cost = () => {
    const w = getEquipped('weapon');
    return w ? temperCost(getTemperLevel(w.id), depth) : 0;
  };

  function refresh(): void {
    const w = getEquipped('weapon');
    if (!w) {
      note.textContent = 'You hold no blade for the fire. Draw a weapon first.';
      line.textContent = '';
      btn.disabled = true; btn.style.opacity = '0.35';
      return;
    }
    const lvl = getTemperLevel(w.id);
    const dmg = lvl * TEMPER_DAMAGE_PER_LEVEL;
    note.textContent = 'The smith takes the blade from your hand and asks for coin. What returns is keener.';
    line.textContent = lvl >= MAX_TEMPER_LEVEL
      ? `${w.name} — tempered to the limit (+${dmg} damage).`
      : `${w.name} — temper ${lvl}/${MAX_TEMPER_LEVEL}  (+${dmg} damage now)`;
    const c = cost();
    const maxed = !canTemper(w.id);
    const afford = getGold() >= c;
    btn.textContent = maxed ? 'FULLY TEMPERED' : `TEMPER  ·  ${c}g  →  +${TEMPER_DAMAGE_PER_LEVEL}`;
    btn.disabled = maxed || !afford;
    btn.style.opacity = (maxed || !afford) ? '0.4' : '1';
  }

  function temper(): void {
    const w = getEquipped('weapon');
    if (!w || !canTemper(w.id)) return;
    const c = temperCost(getTemperLevel(w.id), depth);
    if (getGold() < c) return;
    spendGold(c);
    const lvl = temperWeapon(w.id);
    playEquipClick();
    playImpact(pos);   // the hammer-fall
    showInscription(lvl >= MAX_TEMPER_LEVEL
      ? 'The blade will take no more. It is as sharp as the dark allows.'
      : 'Steel sings on the anvil. The edge remembers the blow.');
    refresh();
  }

  refresh();
  sheet.open();
}
