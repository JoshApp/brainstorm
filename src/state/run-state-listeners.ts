// Glue: wires run-state mutation to the existing event bus + inventory
// listeners. Kept in its own file so run-state.ts stays pure data.
//
// Subscribes to:
//   - enemy:killed       → bump kills counter
//   - item:picked-up     → add to items-found set
//   - level:loaded       → snapshot HP + inventory + equipment + persist
//
// Call initRunStateListeners() ONCE at boot, after the event bus exists.

import { on as onEvent } from '../broadcast/event-bus';
import {
  recordKill,
  recordItemFound,
  commitFloorEntry,
  getRunState,
} from './run-state';
import { getAllItems } from '../player/inventory';
import { getEquipment } from '../player/equipment';
import { getPlayerHp } from '../player/health';
import { getCurrentDepth } from '../level/loader';

export function initRunStateListeners() {
  onEvent((event) => {
    if (event.type === 'enemy:killed') {
      recordKill();
    } else if (event.type === 'item:picked-up') {
      recordItemFound(event.itemId);
    } else if (event.type === 'level:loaded') {
      // Only autosave during an active run. If the player is on the
      // title screen or after death, getRunState() returns null and we
      // skip — don't pollute storage during debug scenarios either.
      if (!getRunState()) return;
      const inv: Record<string, number> = {};
      for (const { id, count } of getAllItems()) inv[id] = count;
      const eq = getEquipment();
      const eqSnapshot: Record<string, string> = {};
      for (const [slot, item] of Object.entries(eq)) {
        if (item) eqSnapshot[slot] = item.id;
      }
      commitFloorEntry({
        floorId: event.levelId,
        depth: getCurrentDepth(),
        hp: getPlayerHp(),
        inventory: inv,
        equipment: eqSnapshot,
      });
    }
  });
}
