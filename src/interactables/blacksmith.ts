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
    hide:   { color: 0x2c2118, roughness: 0.95, metalness: 0.0, flatShading: 'auto' },  // tunic
    apron:  { color: 0x4a2f1c, roughness: 0.9,  metalness: 0.0, flatShading: 'auto' },  // leather apron
    skin:   { color: 0x6a4c36, roughness: 0.85, metalness: 0.0, flatShading: 'auto' },  // bare forearms
    iron:   { color: 0x2a2724, roughness: 0.45, metalness: 0.9,  flatShading: 'auto' },
    stone:  { color: 0x3a342c, roughness: 0.96, metalness: 0.0, flatShading: 'auto' },
    coal:   { color: 0x140804, emissive: 0xff6a1a, emissiveIntensity: 2.4, roughness: 1.0 },
    spark:  { color: 0x160a04, emissive: 0xffb347, emissiveIntensity: 2.2, roughness: 1.0 },
    eyes:   { color: 0x000000, emissive: 0xffb060, emissiveIntensity: 1.3, roughness: 1.0 },
  },
  parts: [
    // ── The SMITH — broad, planted. Two thick legs, a barrel torso, a heavy
    //    leather apron down the front, and big bare forearms. ──
    { kind: 'box', pos: [-0.16, 0.24, 0], size: [0.16, 0.48, 0.18], bevel: 0.04, mat: 'hide' },   // leg L
    { kind: 'box', pos: [ 0.10, 0.24, 0], size: [0.16, 0.48, 0.18], bevel: 0.04, mat: 'hide' },   // leg R
    { name: 'torso', kind: 'box', pos: [-0.03, 0.74, 0], size: [0.46, 0.56, 0.32], bevel: 0.09, mat: 'hide', jitter: 0.02 },
    // Leather apron — a trapezoid slab over the front (chest to shins).
    { name: 'apron', kind: 'box', pos: [-0.03, 0.52, -0.17], size: [0.34, 0.72, 0.05], bevel: 0.03, mat: 'apron', jitter: 0.02 },
    { kind: 'box', pos: [-0.03, 0.98, -0.16], size: [0.22, 0.16, 0.05], bevel: 0.02, mat: 'apron' },   // apron bib
    // Broad sloped shoulders.
    { kind: 'box', pos: [-0.03, 1.08, 0], size: [0.56, 0.16, 0.30], bevel: 0.06, mat: 'hide', jitter: 0.02 },
    // Head — a capped head sunk between the shoulders, heavy brow over glinting
    // eyes, a blunt beard wedge. No hood: a smith works bare-headed.
    { name: 'head', kind: 'sphere', pos: [-0.03, 1.26, -0.01], radius: 0.17, scale: [1.0, 1.0, 0.95], mat: 'skin' },
    { kind: 'box', pos: [-0.03, 1.34, 0.0], size: [0.30, 0.12, 0.28], bevel: 0.04, mat: 'hide' },       // leather cap
    { kind: 'box', pos: [-0.03, 1.20, -0.14], size: [0.16, 0.12, 0.08], bevel: 0.03, mat: 'hide' },     // beard
    { name: 'eye_l', kind: 'sphere', pos: [-0.10, 1.28, -0.15], radius: 0.026, mat: 'eyes' },
    { name: 'eye_r', kind: 'sphere', pos: [ 0.04, 1.28, -0.15], radius: 0.026, mat: 'eyes' },
    // Arms — the right reaches toward the anvil (holding the hammer), the left
    // rests. Upper (tunic) + bare forearm each.
    { kind: 'capsule', pos: [-0.30, 0.86, -0.02], radius: 0.085, height: 0.26, rot: [0, 0, 0.3], mat: 'hide' },
    { name: 'forearm_l', kind: 'capsule', pos: [-0.34, 0.60, -0.04], radius: 0.075, height: 0.24, rot: [0.2, 0, 0.1], mat: 'skin' },
    { kind: 'capsule', pos: [ 0.24, 0.90, -0.02], radius: 0.085, height: 0.24, rot: [0, 0, -0.5], mat: 'hide' },
    { name: 'forearm_r', kind: 'capsule', pos: [ 0.42, 0.72, -0.08], radius: 0.075, height: 0.26, rot: [0.9, 0, -0.2], mat: 'skin' },
    // ── The ANVIL — a horned iron block on a stone stump, at the smith's right. ──
    { kind: 'cylinder', pos: [0.62, 0.22, -0.10], radiusTop: 0.15, radius: 0.19, height: 0.44, segments: 10, mat: 'stone' },
    { name: 'anvil', kind: 'box', pos: [0.62, 0.50, -0.10], size: [0.44, 0.15, 0.22], bevel: 0.03, mat: 'iron' },
    { kind: 'box', pos: [0.62, 0.60, -0.10], size: [0.30, 0.07, 0.16], bevel: 0.02, mat: 'iron' },        // face
    { name: 'horn', kind: 'cone', pos: [0.90, 0.57, -0.10], radius: 0.07, height: 0.20, rot: [0, 0, -Math.PI / 2], mat: 'iron' },   // horn
    // Hammer laid across the anvil (head + haft).
    { kind: 'cylinder', pos: [0.52, 0.64, -0.10], radius: 0.016, height: 0.34, rot: [0, 0, 1.2], mat: 'apron' },
    { kind: 'box', pos: [0.66, 0.70, -0.10], size: [0.12, 0.09, 0.09], bevel: 0.02, mat: 'iron' },
    // ── The FORGE — a stone hearth of glowing coals with a chimney HOOD, behind
    //    the smith (+Z). The signal light; the runtime adds the flicker glow. ──
    { kind: 'box', pos: [-0.05, 0.30, 0.52], size: [0.62, 0.44, 0.36], bevel: 0.05, mat: 'stone' },
    { name: 'coals', kind: 'box', pos: [-0.05, 0.50, 0.50], size: [0.44, 0.10, 0.24], bevel: 0.03, mat: 'coal' },
    { kind: 'box', pos: [-0.05, 0.86, 0.60], size: [0.5, 0.34, 0.22], bevel: 0.04, mat: 'stone', rot: [-0.5, 0, 0] },  // hood
    { kind: 'cylinder', pos: [-0.05, 1.16, 0.66], radius: 0.09, height: 0.4, segments: 8, mat: 'stone' },              // chimney
    // A couple of ember sparks rising off the coals.
    { kind: 'sphere', pos: [0.06, 0.62, 0.50], radius: 0.02, mat: 'spark' },
    { kind: 'sphere', pos: [-0.14, 0.68, 0.52], radius: 0.016, mat: 'spark' },
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
