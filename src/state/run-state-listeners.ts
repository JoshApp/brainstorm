// Glue: wires run-state mutation to the existing event bus + inventory
// listeners. Kept in its own file so run-state.ts stays pure data.
//
// Subscribes to:
//   - enemy:killed       → bump run kills counter + record meta + first-seen
//   - item:picked-up     → add to items-found set + record meta + first-seen
//   - level:loaded       → snapshot HP + inventory + equipment + persist;
//                          also record deepest-depth meta
//
// Call initRunStateListeners() ONCE at boot, after the event bus exists.

import { on as onEvent } from '../broadcast/event-bus';
import {
  recordKill,
  recordItemFound,
  commitFloorEntry,
  getRunState,
  snapshotActEntry,
} from './run-state';
import { actForDepth } from '../level/acts';
import {
  recordKill as metaRecordKill,
  recordItemFound as metaRecordItemFound,
  recordNoteRead as metaRecordNoteRead,
  recordDepthReached as metaRecordDepth,
  noteRunDiscovery,
} from './meta-state';
import { getAllItems } from '../player/inventory';
import { getEquipment } from '../player/equipment';
import { getPlayerHp } from '../player/health';
import { getCurrentDepth } from '../level/loader';

export function initRunStateListeners() {
  onEvent((event) => {
    if (event.type === 'enemy:killed') {
      recordKill();
      const first = metaRecordKill(event.enemyId);
      if (first) noteRunDiscovery('enemy', event.enemyId);
    } else if (event.type === 'item:picked-up') {
      recordItemFound(event.itemId);
      const first = metaRecordItemFound(event.itemId);
      if (first) noteRunDiscovery('item', event.itemId);
    } else if (event.type === 'note:read') {
      const first = metaRecordNoteRead(event.noteBody);
      if (first) noteRunDiscovery('note', event.noteBody);
    } else if (event.type === 'level:loaded') {
      if (!getRunState()) return;
      // Skip saving on the starter chamber — the player hasn't picked
      // a weapon yet, and a half-formed save (no weapon, depth 0)
      // would resume into a broken state. If the player closes the
      // tab here, next launch shows DESCEND for a clean fresh start.
      if (event.levelId === 'starter') return;
      // Same skip for test chambers — they're dev affordances and
      // shouldn't poison the real save with `test-arena` floor ids.
      if (event.levelId.startsWith('test-')) return;
      const inv: Record<string, number> = {};
      for (const { id, count } of getAllItems()) inv[id] = count;
      const eq = getEquipment();
      const eqSnapshot: Record<string, string> = {};
      for (const [slot, item] of Object.entries(eq)) {
        if (item) eqSnapshot[slot] = item.id;
      }
      const depth = getCurrentDepth();
      // Crossing into the FIRST depth of an act — snapshot kills/xp/gold
      // so the safe-room transition card at the end of the act can show
      // "during this act" stats. Safe rooms don't snapshot (they're the
      // breath between acts, not an act start) — the loader skips depth
      // bookkeeping for safe-N entries via the same path.
      if (!event.levelId.startsWith('safe-')) {
        const act = actForDepth(depth);
        if (depth === act.depths[0]) snapshotActEntry();
      }
      commitFloorEntry({
        floorId: event.levelId,
        depth,
        hp: getPlayerHp(),
        inventory: inv,
        equipment: eqSnapshot,
      });
      // Meta: bump deepest-depth lifetime record.
      const isNew = metaRecordDepth(depth);
      if (isNew) noteRunDiscovery('depth', String(depth));
    }
  });
}


