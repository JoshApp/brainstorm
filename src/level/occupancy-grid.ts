// A shared CELL-OCCUPANCY grid for the floor build passes — one source of truth
// for what physically sits in each vault cell, so the carve / lighting / decor
// passes don't collide.
//
// THE KEY IDEA: occupancy is per PHYSICAL LAYER, not a flat "this cell is taken."
// A wall torch and a floor altar share a cell happily (in fact the lighting
// doctrine WANTS a torch by an altar); a floor glow lives under a chest; but two
// floor-standing props, or a chasm carved under an altar, genuinely conflict.
// Only things in the SAME layer exclude each other, and decorative things that
// coexist with everything (decals, glows) reserve nothing at all.
//
//   floor — stands on the walkable floor; can't stack, can't be carved under
//           (pillars, altars, chests, fountains, vases, spawns, features…).
//   wall  — mounts on a perimeter wall (torches, wall-runes). Coexists with floor.
//   void  — a carved chasm. Its own layer so lighting can avoid hanging a torch
//           over a hole WITHOUT avoiding the altars on the floor layer.
//
// Each pass declares which layers it physically conflicts with (`blocked(...)`),
// reads that set to skip cells, then reserves its own output back into the grid
// before the next pass runs. Cells are "col,row" keys in the vault's ASCII grid.
// The reason is kept for debug — `reasonAt` answers "why is this cell taken?"

export type OccLayer = 'floor' | 'wall' | 'void';
export type OccReason = 'authored' | 'feature' | 'spawn' | 'void' | 'torch' | 'decor';

// Which physical layer a prop KIND occupies — or null if it coexists with
// everything (decals, glows, opening fittings) and should reserve nothing.
// Default is 'floor': an unknown prop is assumed to stand on the floor, so the
// carve never opens a chasm under something we forgot to classify. Mark a new
// decorative kind here explicitly to opt it out.
const WALL_KINDS = new Set<string>(['torch', 'wall-rune']);
const COEXIST_KINDS = new Set<string>(['decal', 'cobweb']);

export function propLayer(kind: string): OccLayer | null {
  if (WALL_KINDS.has(kind)) return 'wall';
  if (COEXIST_KINDS.has(kind)) return null;
  return 'floor';
}

export class OccupancyGrid {
  private readonly layers: Record<OccLayer, Set<string>> = {
    floor: new Set<string>(),
    wall: new Set<string>(),
    void: new Set<string>(),
  };
  private readonly why = new Map<string, OccReason>();

  reserve(col: number, row: number, layer: OccLayer, reason: OccReason): void {
    this.reserveKey(`${col},${row}`, layer, reason);
  }

  reserveKey(key: string, layer: OccLayer, reason: OccReason): void {
    this.layers[layer].add(key);
    const wk = `${layer}:${key}`;
    if (!this.why.has(wk)) this.why.set(wk, reason);   // first reason wins
  }

  /** Reserve a cell + its 4 orthogonal neighbours — an interactable needs a
   *  walkable approach, so nothing floor-blocking should sit beside it. */
  reserveWithApproach(col: number, row: number, layer: OccLayer, reason: OccReason): void {
    this.reserve(col, row, layer, reason);
    this.reserve(col + 1, row, layer, reason);
    this.reserve(col - 1, row, layer, reason);
    this.reserve(col, row + 1, layer, reason);
    this.reserve(col, row - 1, layer, reason);
  }

  has(col: number, row: number, layer: OccLayer): boolean {
    return this.layers[layer].has(`${col},${row}`);
  }

  /** Union of occupied "col,row" keys across the given layers — the set a pass
   *  reads to skip cells it would physically conflict with. A single-layer query
   *  returns the live set (no copy); the passes only read it. */
  blocked(...layers: OccLayer[]): Set<string> {
    if (layers.length === 1) return this.layers[layers[0]];
    const out = new Set<string>();
    for (const l of layers) for (const k of this.layers[l]) out.add(k);
    return out;
  }

  reasonAt(col: number, row: number, layer: OccLayer): OccReason | undefined {
    return this.why.get(`${layer}:${col},${row}`);
  }
}
