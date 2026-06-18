import * as THREE from 'three';
import { groundYAt } from '../level/elevation';
import { generateEntityId } from '../ecs/world';
import { registerInteractable, unregisterInteractable, getInRangeInteractable } from './system';
import { getCard } from '../content/cards';
import { grantCard } from '../state/run-state';
import { DOMAIN_VISUAL } from '../art/domains';
import { getTexture } from '../style/procedural-textures';
import { pooledPlane, pooledRing } from '../scene/geometry-pool';
import { playPickupChime } from '../audio/sfx';
import { showInWorldMessage } from '../ui/pickup-notification';

// A fate card lying in the world — the physical drop a MAJOR leaves (a boss
// falls, a delver's corpse offers one). The card hovers face-up over a
// domain-tinted glow disc, bobbing and slowly turning to show its back (the
// watching eye), so it reads as a SIGNIFICANT lit object out of the dark
// (lighting doctrine: uncommon light = something is here). TAKE it → grantCard,
// straight into the Spread.
//
// It's the same card-quad as the reading, now a WebGL mesh: two textured planes
// (the baked face webp + the shared back) back-to-back. Self-lit (MeshBasic) so
// it glows in the dark; the disc + bloom do the floor glow (no pooled light —
// it stays cheap even if several drop).

const BASE = import.meta.env.BASE_URL;
const CARD_W = 0.56, CARD_H = 0.88;
const REST_Y = 0.6;            // hover height above the floor
const BOB_AMP = 0.05, BOB_FREQ = 1.4;
const SWAY_AMP = 0.32, SWAY_FREQ = 1.1;  // gentle wobble — the face stays toward the player (a floor card you read), never edge-on
const DISC_SIZE = 1.0;

const texLoader = new THREE.TextureLoader();
function cardTex(url: string): THREE.Texture {
  const t = texLoader.load(url, undefined, undefined, (e) => console.error('[card-drop] texture FAILED', url, e));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Spawn a fate card on the floor at `pos`. Returns the interactable id. */
export function spawnCardDrop(scene: THREE.Object3D, pos: THREE.Vector3, cardId: string): string {
  const card = getCard(cardId);
  const accentHex = card?.domains[0] ? DOMAIN_VISUAL[card.domains[0]].color : '#e6c88a';
  const accent = new THREE.Color(accentHex);

  const group = new THREE.Group();
  group.position.copy(pos);
  scene.add(group);
  const floorLocalY = (lift: number) => groundYAt(pos.x, pos.z) + lift - pos.y;

  // floor glow disc — domain-tinted, self-emissive (carries the "lit" read)
  const disc = new THREE.Mesh(pooledPlane(DISC_SIZE, DISC_SIZE), new THREE.MeshStandardMaterial({
    map: getTexture('fire-wisp'), color: accent, emissive: accent, emissiveIntensity: 1.4,
    transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, fog: false, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = floorLocalY(0.01);
  group.add(disc);

  // in-range ring (shown only when the player can take it)
  const ring = new THREE.Mesh(pooledRing(0.52, 0.64, 28), new THREE.MeshBasicMaterial({
    color: accent, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    fog: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = floorLocalY(0.015);
  ring.visible = false;
  group.add(ring);

  // the card — two textured planes back-to-back, self-lit so it glows
  const cardMesh = new THREE.Group();
  const geo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const front = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: cardTex(`${BASE}cards/${cardId}.webp`), transparent: true, side: THREE.FrontSide, toneMapped: false }));
  front.position.z = 0.005;
  const back = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: cardTex(`${BASE}cards/back.webp`), transparent: true, side: THREE.FrontSide, toneMapped: false }));
  back.rotation.y = Math.PI; back.position.z = -0.005;
  cardMesh.add(front, back);
  cardMesh.position.y = REST_Y;
  group.add(cardMesh);

  const id = generateEntityId('card-drop');
  let t = 0, taken = false;

  registerInteractable({
    id, position: group.position, radius: 1.05, promptLabel: 'TAKE', promptKind: 'bargain', navWork: true,
    onUse() {
      if (taken) return;
      taken = true;
      grantCard(cardId);
      playPickupChime(4);
      showInWorldMessage(card ? card.name : 'A fate');
      // (broadcast seam — the voice in the deep can react to card:claimed later)
      unregisterInteractable(id);
      scene.remove(group);
    },
    tick(dt) {
      t += dt;
      cardMesh.position.y = REST_Y + Math.sin(t * Math.PI * 2 * BOB_FREQ) * BOB_AMP;
      cardMesh.rotation.y = Math.sin(t * SWAY_FREQ) * SWAY_AMP;
      ring.visible = getInRangeInteractable()?.id === id;
    },
  });

  return id;
}
