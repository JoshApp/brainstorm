// Terse text rendering of an Observation. Designed to be scannable in a
// console / transcript. The structured JSON is the source of truth for
// programmatic consumers; this is for human-readable logs.

import type { Observation, ObservedEnemy, ObservedInteractable, Direction8 } from './types';

export function renderObservationText(obs: Observation): string {
  const lines: string[] = [];

  // Header line: turn, depth, room, HP, light, paused
  const room = obs.roomId ? `room "${obs.roomId}"` : 'room ?';
  const hp = `HP ${obs.player.hp.current}/${obs.player.hp.max}`;
  const light = `light ${obs.light.atPlayer.toFixed(2)}`;
  const paused = obs.pausedReason ? ` · paused:${obs.pausedReason}` : '';
  lines.push(
    `Turn ${obs.turn} · Depth ${obs.depth} · ${obs.floorId} · ${room} · ${hp} · ${light}${paused}`,
  );

  // Player line
  const p = obs.player.pos;
  const yawDeg = ((obs.player.facingYaw * 180) / Math.PI).toFixed(0);
  lines.push(`Player (${p.x}, ${p.z}) yaw ${yawDeg}°`);

  // Buffs / equipment
  if (obs.player.buffs.length > 0) {
    lines.push(`Buffs: ${obs.player.buffs.join(', ')}`);
  }
  const eqShort = Object.entries(obs.player.equipped)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  if (eqShort) lines.push(`Equipped: ${eqShort}`);

  // Enemies
  if (obs.visible.enemies.length > 0) {
    lines.push('');
    lines.push('Enemies:');
    for (const e of obs.visible.enemies) lines.push(`  ${formatEnemy(e)}`);
  }

  // Interactables (exclude pickups — listed separately)
  const ints = obs.visible.interactables.filter((i) => i.kind !== 'pickup');
  if (ints.length > 0) {
    lines.push('');
    lines.push('Interactables:');
    for (const it of ints) lines.push(`  ${formatInteractable(it)}`);
  }

  // Pickups
  if (obs.visible.pickups.length > 0) {
    lines.push('');
    lines.push('Pickups:');
    for (const p of obs.visible.pickups) {
      const flag = p.inSight ? '' : '  (occluded)';
      lines.push(`  ${p.kind.padEnd(18)} ${formatDist(p.distance)} ${p.compass}${flag}`);
    }
  }

  // Walls
  lines.push('');
  const w = obs.geometry.walls8;
  const dirs: Direction8[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const wallsStr = dirs.map((d) => `${d} ${formatDist(w[d])}`).join('  ');
  lines.push(`Walls: ${wallsStr}`);

  return lines.join('\n');
}

function formatEnemy(e: ObservedEnemy): string {
  const kind = e.kind.padEnd(12);
  const dist = formatDist(e.distance).padEnd(6);
  const compass = e.compass.padEnd(3);
  const state = String(e.state).padEnd(11);
  const hp = `hp ${e.hp.current}/${e.hp.max}`.padEnd(10);
  const los = e.inSight ? 'LOS yes' : 'LOS no ';
  const lit = e.inLight ? 'lit' : 'dark';
  return `${kind} ${dist} ${compass} ${state} ${hp} ${los}  ${lit}`;
}

function formatInteractable(it: ObservedInteractable): string {
  const kind = it.kind.padEnd(14);
  const dist = formatDist(it.distance).padEnd(6);
  const compass = it.compass.padEnd(3);
  const state = String(it.state).padEnd(11);
  const inRange = it.inRange ? 'in-range' : '        ';
  const los = it.inSight ? '' : '  (occluded)';
  return `${kind} ${dist} ${compass} ${state} ${inRange}${los}`;
}

function formatDist(d: number): string {
  if (!Number.isFinite(d)) return ' ∞ ';
  return `${d.toFixed(1)}m`;
}
