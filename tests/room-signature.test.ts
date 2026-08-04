// Atmosphere signature (src/level/room-signature.ts) — a staged room's colour,
// read from the doorway before you commit to the walk.
//
// What's worth pinning here is that the signal stays a SIGNAL: one hue per type,
// distinct enough from the dungeon's warm default and from each other to survive
// a corridor, applied to fixtures the room already had rather than new light,
// and never promised by a type whose content varies.

import assert from 'node:assert/strict';
import { CONFIG } from '../src/config';
import { ROOM_SIGNATURES, signatureFor, tintRoomTorches } from '../src/level/room-signature';
import { assignableTypes, ROOM_TYPES } from '../src/level/room-types';
import type { TorchSpec } from '../src/level/types';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

function torch(x: number, z: number, extra: Partial<TorchSpec> = {}): TorchSpec {
  return { x, z, height: 2, wall: 'N', ...extra };
}

/** Perceptual-ish distance between two packed hex colours, 0..441. */
function colorDist(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff);
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const db = (a & 0xff) - (b & 0xff);
  return Math.hypot(dr, dg, db);
}

// ── The table itself ──────────────────────────────────────────────────

test('every signature names a real assignable room type', () => {
  const roles = new Set<string>(assignableTypes());
  for (const id of Object.keys(ROOM_SIGNATURES)) {
    assert.ok(roles.has(id), `${id} has a signature but is not an assignable role`);
  }
});

test('a signature is only given to types that always mean the same thing', () => {
  // `feature` stages anything from a blood bargain to a free relic. A fixed
  // colour there would be a promise the room cannot keep.
  assert.equal(signatureFor('feature'), undefined);
  // Plain and structural rooms make no promise either.
  assert.equal(signatureFor('combat'), undefined);
  assert.equal(signatureFor('quiet'), undefined);
  assert.equal(signatureFor('entrance'), undefined);
});

test('strength stays in the band where the signal survives the corridor', () => {
  for (const [id, sig] of Object.entries(ROOM_SIGNATURES)) {
    assert.ok(sig!.strength >= 0.5, `${id}: too weak, the dungeon's orange wins`);
    assert.ok(sig!.strength <= 0.9, `${id}: too strong, stops reading as torchlight`);
  }
});

test('every signature reads as a hue, not as the default warm', () => {
  for (const [id, sig] of Object.entries(ROOM_SIGNATURES)) {
    const applied = mixed(sig!.tint, sig!.strength);
    assert.ok(colorDist(applied, CONFIG.TORCH_COLOR) > 40,
      `${id}: indistinguishable from a plain torch`);
  }
});

test('no two room types claim the same colour', () => {
  const entries = Object.entries(ROOM_SIGNATURES);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = mixed(entries[i][1]!.tint, entries[i][1]!.strength);
      const b = mixed(entries[j][1]!.tint, entries[j][1]!.strength);
      assert.ok(colorDist(a, b) > 50,
        `${entries[i][0]} and ${entries[j][0]} read as the same room`);
    }
  }
});

test('intensity never blacks a room out and never blows it out', () => {
  for (const [id, sig] of Object.entries(ROOM_SIGNATURES)) {
    assert.ok(sig!.intensityMul >= 0.4, `${id}: too dark to navigate`);
    assert.ok(sig!.intensityMul <= 1.3, `${id}: brighter than the player's lamp`);
  }
});

test('the rest room goes quiet so its fire is the brightest thing in it', () => {
  const sanctum = signatureFor('sanctum')!;
  for (const [id, sig] of Object.entries(ROOM_SIGNATURES)) {
    if (id === 'sanctum') continue;
    assert.ok(sanctum.intensityMul < sig!.intensityMul,
      `sanctum is not dimmer than ${id}`);
  }
});

test('the trove is the only room allowed to look generous', () => {
  const trove = signatureFor('trove')!;
  for (const [id, sig] of Object.entries(ROOM_SIGNATURES)) {
    if (id === 'trove') continue;
    assert.ok(trove.intensityMul > sig!.intensityMul, `${id} is as bright as the gift`);
  }
});

test('a room that refuses all modifiers still gets to declare a colour', () => {
  // The shop takes no modifiers at all — its signature is the only thing that
  // ever changes how it looks, so it must have one.
  assert.equal(ROOM_TYPES.shop.modifiers.length, 0);
  assert.ok(signatureFor('shop'));
});

// ── Applying it ───────────────────────────────────────────────────────

const RECT = { x: 10, z: 10, w: 8, d: 8 };

test('tints only the fixtures inside the room', () => {
  const inside = torch(10, 10);
  const outside = torch(40, 40);
  const n = tintRoomTorches(signatureFor('shop')!, RECT, [inside, outside]);
  assert.equal(n, 1);
  assert.ok(inside.colorTint !== undefined);
  assert.equal(outside.colorTint, undefined);
});

test('catches wall fixtures mounted just outside the nominal rect', () => {
  // Sconces sit at WALL_OFFSET (0.32) beyond the wall plane — a strict
  // containment test would miss nearly every torch in the room.
  const sconce = torch(10, 10 + RECT.d / 2 + 0.32);
  assert.equal(tintRoomTorches(signatureFor('arena')!, RECT, [sconce]), 1);
});

test('an unlit room reports that the signature did not land', () => {
  assert.equal(tintRoomTorches(signatureFor('trove')!, RECT, []), 0);
  assert.equal(tintRoomTorches(signatureFor('trove')!, RECT, [torch(80, 80)]), 0);
});

test('a mood-tinted torch is pulled toward the signature, not replaced', () => {
  // A vault that already committed to a palette keeps some of its own colour.
  const authored = torch(10, 10, { colorTint: 0x2288ff });
  const sig = signatureFor('trove')!;
  tintRoomTorches(sig, RECT, [authored]);
  assert.notEqual(authored.colorTint, 0x2288ff, 'authored tint ignored the signature');
  assert.notEqual(authored.colorTint, sig.tint, 'authored tint was overwritten wholesale');
});

test('intensity multiplies rather than overwrites a dying torch', () => {
  const dying = torch(10, 10, { intensityMul: 0.5 });
  const sig = signatureFor('sanctum')!;
  tintRoomTorches(sig, RECT, [dying]);
  assert.equal(dying.intensityMul, 0.5 * sig.intensityMul);
});

test('the reach never crosses into the next room', () => {
  // Rooms are separated by corridors; the margin exists to catch this room's own
  // sconces, not to bleed a promise onto a neighbour's walls.
  const neighbour = torch(10, 10 + RECT.d / 2 + 3);
  assert.equal(tintRoomTorches(signatureFor('trap')!, RECT, [neighbour]), 0);
});

test('the same room composed twice looks the same', () => {
  const a = torch(10, 10, { colorTint: 0x336699, intensityMul: 0.7 });
  const b = torch(10, 10, { colorTint: 0x336699, intensityMul: 0.7 });
  tintRoomTorches(signatureFor('arena')!, RECT, [a]);
  tintRoomTorches(signatureFor('arena')!, RECT, [b]);
  assert.equal(a.colorTint, b.colorTint);
  assert.equal(a.intensityMul, b.intensityMul);
});

function mixed(tint: number, strength: number): number {
  const base = CONFIG.TORCH_COLOR;
  const r = Math.round(((base >> 16) & 0xff) + (((tint >> 16) & 0xff) - ((base >> 16) & 0xff)) * strength);
  const g = Math.round(((base >> 8) & 0xff) + (((tint >> 8) & 0xff) - ((base >> 8) & 0xff)) * strength);
  const b = Math.round((base & 0xff) + ((tint & 0xff) - (base & 0xff)) * strength);
  return (r << 16) | (g << 8) | b;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
