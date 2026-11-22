// BAKED TORCH VISIBILITY — what the walls let each static light reach.
//
// A static light (torch, sconce, brazier, room fill) never moves, and neither
// do the walls. So WHERE its light can land is known when the floor is built;
// only HOW MUCH (flicker, room-mood tint, the arena boost, the gate fade) is
// decided per frame. This module bakes the first half and nothing else:
//
//   vis  — per texel of a top-down grid over the floor, per CHANNEL: how much
//          of the texel the channel's light can see (0..255, 2×2 supersampled
//          so shadow edges come out soft under bilinear filtering).
//   ids  — per texel, per channel: which light the channel carries there
//          (1-based slot; 0 = none).
//
// The shader (scene/baked-light.ts) samples both at a fragment's position and,
// for each channel, runs three's own point-light math with the live colour ×
// intensity × the baked visibility. Falloff, colour, flicker and specular are
// exactly a live light's; the walls finally stop light (a live point light
// passes through them — the light pool only dimmed it).
//
// CHANNELS: each light gets ONE channel for the whole floor. Two lights may
// share a channel only if no texel sees both (graph colouring, greedy, biggest
// lights first), so each texel's channel slot is unambiguous. A light that
// cannot get a channel is not dropped: it stays a normal live light.
//
// Occlusion is 2D (wall segments in plan view), the same model the game's line
// of sight uses everywhere. Openable segments (doors, gates, boss mist) are
// ignored: they open in play, and a baked shadow would outlive them.
//
// Pure: no three.js, no DOM. tests/light-bake.test.ts pins it.

export interface BakeLight {
  id: string;
  x: number;
  z: number;
  /** Cutoff distance (three's point-light `distance`). */
  range: number;
  /** Base intensity × the brightest the light gets — sizes what counts as "lit". */
  intensity: number;
  decay: number;
}

export interface BakeWall {
  ax: number; az: number; bx: number; bz: number;
  openable?: boolean;
}

export interface LightBake {
  originX: number;
  originZ: number;
  cell: number;
  w: number;
  h: number;
  channels: number;
  /** w*h*4 bytes: visibility per channel (RGBA = channels 0..3). */
  vis: Uint8Array;
  /** w*h*4 bytes: 1-based slot of the light on each channel (0 = none). */
  ids: Uint8Array;
  /** Baked light id → its 1-based slot (index into the live arrays + 1). */
  slotOf: Map<string, number>;
  /** Baked light id → channel. */
  channelOf: Map<string, number>;
  /** Lights that could not be given a channel: they stay live. */
  live: string[];
  /** Diagnostics. */
  stats: { lights: number; baked: number; texels: number; conflicts: number; ms: number };
}

export interface BakeOptions {
  /** Texel size in metres. */
  cell?: number;
  /** Channels available (4 = one RGBA pair). */
  channels?: number;
  /** Most lights the live arrays hold. */
  maxSlots?: number;
  /** Rays per light in its depth map. */
  rays?: number;
  /** A texel counts as lit by a light when intensity × attenuation ≥ this.
   *  Below it the light is too dim to see under the banding, and counting it
   *  would make far-apart lights conflict for no visible reason. */
  minIrradiance?: number;
  /** Optional range multiplier (the torch-range setting). */
  rangeMul?: number;
}

/** three's getDistanceAttenuation (PointLightNode / lights_pars_begin). */
export function distanceAttenuation(d: number, cutoff: number, decay: number): number {
  const base = 1 / Math.max(Math.pow(d, decay), 0.01);
  if (cutoff <= 0) return base;
  const r = d / cutoff;
  const w = Math.max(0, Math.min(1, 1 - r * r * r * r));
  return base * w * w;
}

/** Distance from (ox,oz) along unit (dx,dz) to segment ab, or Infinity. */
function rayHit(ox: number, oz: number, dx: number, dz: number, w: BakeWall): number {
  const ex = w.bx - w.ax, ez = w.bz - w.az;
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const fx = w.ax - ox, fz = w.az - oz;
  const t = (fx * ez - fz * ex) / den;   // along the ray
  const u = (fx * dz - fz * dx) / den;   // along the segment
  if (t <= 1e-6 || u < 0 || u > 1) return Infinity;
  return t;
}

export function bakeLightVisibility(
  lights: readonly BakeLight[],
  walls: readonly BakeWall[],
  opts: BakeOptions = {},
): LightBake {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const cell = opts.cell ?? 0.25;
  const K = opts.channels ?? 4;
  const maxSlots = opts.maxSlots ?? 96;
  const RAYS = opts.rays ?? 1440;
  const minIrr = opts.minIrradiance ?? 0.05;
  const rangeMul = opts.rangeMul ?? 1;
  const solid = walls.filter((w) => !w.openable);

  // Grid over the walls' bounds (every light sits inside them).
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const w of solid) {
    minX = Math.min(minX, w.ax, w.bx); maxX = Math.max(maxX, w.ax, w.bx);
    minZ = Math.min(minZ, w.az, w.bz); maxZ = Math.max(maxZ, w.az, w.bz);
  }
  for (const l of lights) {
    minX = Math.min(minX, l.x); maxX = Math.max(maxX, l.x);
    minZ = Math.min(minZ, l.z); maxZ = Math.max(maxZ, l.z);
  }
  if (!Number.isFinite(minX)) { minX = minZ = 0; maxX = maxZ = 1; }
  const originX = Math.floor((minX - 1) / cell) * cell;
  const originZ = Math.floor((minZ - 1) / cell) * cell;
  const w = Math.ceil((maxX + 1 - originX) / cell);
  const h = Math.ceil((maxZ + 1 - originZ) / cell);

  // ── Per light: a 1D depth map (angle → distance to the first wall), then
  // its footprint: every texel it can see, with a 2×2 supersampled coverage.
  interface Foot { idx: Int32Array; cov: Uint8Array; weight: number }
  const feet: Foot[] = [];
  const depth = new Float32Array(RAYS);
  const near: BakeWall[] = [];
  const SUB = [0.25, 0.75];
  for (const L of lights) {
    const R = L.range * rangeMul;
    // The light is too dim to matter past where intensity × attenuation drops
    // under the threshold; never past the cutoff.
    let reach = R;
    for (let d = 0.25; d < R; d += 0.25) {
      if (L.intensity * distanceAttenuation(d, R, L.decay) < minIrr) { reach = d; break; }
    }
    near.length = 0;
    for (const s of solid) {
      // Segment-to-point distance ≤ reach → may cast a shadow.
      const ex = s.bx - s.ax, ez = s.bz - s.az;
      const len2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((L.x - s.ax) * ex + (L.z - s.az) * ez) / len2));
      const px = s.ax + ex * t - L.x, pz = s.az + ez * t - L.z;
      if (px * px + pz * pz <= reach * reach) near.push(s);
    }
    for (let r = 0; r < RAYS; r++) {
      const a = (r / RAYS) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      let best = reach;
      for (const s of near) { const d = rayHit(L.x, L.z, dx, dz, s); if (d < best) best = d; }
      depth[r] = best;
    }
    const x0 = Math.max(0, Math.floor((L.x - reach - originX) / cell));
    const x1 = Math.min(w - 1, Math.ceil((L.x + reach - originX) / cell));
    const z0 = Math.max(0, Math.floor((L.z - reach - originZ) / cell));
    const z1 = Math.min(h - 1, Math.ceil((L.z + reach - originZ) / cell));
    const idx: number[] = [];
    const cov: number[] = [];
    for (let tz = z0; tz <= z1; tz++) {
      for (let tx = x0; tx <= x1; tx++) {
        let seen = 0;
        for (const sz of SUB) for (const sx of SUB) {
          const px = originX + (tx + sx) * cell - L.x;
          const pz = originZ + (tz + sz) * cell - L.z;
          const d = Math.hypot(px, pz);
          if (d > reach) continue;
          let a = Math.atan2(pz, px);
          if (a < 0) a += Math.PI * 2;
          const ri = Math.floor((a / (Math.PI * 2)) * RAYS) % RAYS;
          // The nearer of the two bins either side: conservative at a wall's end.
          const lim = Math.min(depth[ri], depth[(ri + 1) % RAYS]);
          if (d <= lim) seen++;
        }
        if (seen > 0) { idx.push(tz * w + tx); cov.push(Math.round((seen / 4) * 255)); }
      }
    }
    feet.push({ idx: Int32Array.from(idx), cov: Uint8Array.from(cov), weight: L.intensity * idx.length });
  }

  // ── Conflicts: two lights that both see some texel.
  const n = lights.length;
  const touch = new Map<number, number[]>();
  for (let i = 0; i < n; i++) for (const t of feet[i].idx) {
    const list = touch.get(t);
    if (list) list.push(i); else touch.set(t, [i]);
  }
  const adj: Array<Set<number>> = Array.from({ length: n }, () => new Set());
  for (const list of touch.values()) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      adj[list[a]].add(list[b]); adj[list[b]].add(list[a]);
    }
  }
  let conflicts = 0;
  for (const s of adj) conflicts += s.size;
  conflicts /= 2;

  // ── Greedy colouring, biggest lights first; no channel → stays live.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => feet[b].weight - feet[a].weight);
  const channel = new Int32Array(n).fill(-1);
  const slotOf = new Map<string, number>();
  const channelOf = new Map<string, number>();
  const live: string[] = [];
  let nextSlot = 1;
  for (const i of order) {
    if (feet[i].idx.length === 0) { live.push(lights[i].id); continue; }   // sees nothing (inside a wall?)
    const used = new Set<number>();
    for (const j of adj[i]) if (channel[j] >= 0) used.add(channel[j]);
    let c = 0;
    while (c < K && used.has(c)) c++;
    if (c >= K || nextSlot > maxSlots) { live.push(lights[i].id); continue; }
    channel[i] = c;
    slotOf.set(lights[i].id, nextSlot++);
    channelOf.set(lights[i].id, c);
  }

  // ── Write the textures.
  const vis = new Uint8Array(w * h * 4);
  const ids = new Uint8Array(w * h * 4);
  for (let i = 0; i < n; i++) {
    const c = channel[i];
    if (c < 0) continue;
    const slot = slotOf.get(lights[i].id)!;
    const { idx, cov } = feet[i];
    for (let k = 0; k < idx.length; k++) {
      vis[idx[k] * 4 + c] = cov[k];
      ids[idx[k] * 4 + c] = slot;
    }
  }
  // Dilate ids one texel into empty neighbours: bilinear filtering pulls a
  // little visibility past a footprint's edge, and a nearest-sampled id of 0
  // there would cut the light off half a texel early.
  const src = ids.slice();
  for (let tz = 0; tz < h; tz++) for (let tx = 0; tx < w; tx++) {
    const t = tz * w + tx;
    for (let c = 0; c < 4; c++) {
      if (src[t * 4 + c] !== 0) continue;
      let got = 0;
      if (tx > 0 && src[(t - 1) * 4 + c]) got = src[(t - 1) * 4 + c];
      else if (tx < w - 1 && src[(t + 1) * 4 + c]) got = src[(t + 1) * 4 + c];
      else if (tz > 0 && src[(t - w) * 4 + c]) got = src[(t - w) * 4 + c];
      else if (tz < h - 1 && src[(t + w) * 4 + c]) got = src[(t + w) * 4 + c];
      if (got) ids[t * 4 + c] = got;
    }
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    originX, originZ, cell, w, h, channels: K, vis, ids, slotOf, channelOf, live,
    stats: { lights: n, baked: slotOf.size, texels: w * h, conflicts, ms: Math.round(t1 - t0) },
  };
}
