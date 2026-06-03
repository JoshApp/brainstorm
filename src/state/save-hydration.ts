import { clearInventory, addItemSilently } from '../player/inventory';
import { setSlot, type EquipSlot } from '../player/equipment';
import { ITEMS } from '../content/items';
import { get as getEntity } from '../ecs/world';
import type { loadSave } from './run-state';

// Hydrate run state (inventory, equipment, HP) from a save — or apply the
// fresh-run defaults when given null. Extracted from main.ts; pure in the
// sense that it only drives the existing player/inventory/equipment modules
// and captures none of main's orchestration state.

export function applyState(saveData: ReturnType<typeof loadSave>) {
  // Reset inventory.
  clearInventory();
  // Hydrate inventory from save (or empty for new run).
  if (saveData) {
    for (const [id, count] of Object.entries(saveData.inventory)) {
      for (let i = 0; i < count; i++) addItemSilently(id);
    }
  }
  // Equipment — set saved slots, OR defaults for new runs.
  // Fresh runs deliberately START WITHOUT a weapon — the player picks
  // one at an altar in the starter chamber (the first room of every
  // run). Offhand defaults to the lamp regardless.
  if (saveData) {
    for (const [slot, itemId] of Object.entries(saveData.equipment)) {
      if (itemId && ITEMS[itemId]) setSlot(slot as EquipSlot, ITEMS[itemId]);
    }
    // Safety: legacy saves predating the starter chamber may have no
    // weapon recorded; give them a rusted sword so they're not stuck
    // unarmed mid-dungeon on resume.
    if (!saveData.equipment.weapon) setSlot('weapon', ITEMS['rusted-sword']);
    // Same safety for offhand — pre-offhand-slot saves won't have one.
    if (!saveData.equipment.offhand) setSlot('offhand', ITEMS['oil-lamp']);
  } else {
    setSlot('offhand', ITEMS['oil-lamp']);
  }
  // HP — restore to saved value, or full for new run.
  const player = getEntity('player');
  if (player?.hp) {
    player.hp.current = saveData ? saveData.hp : player.hp.base;
  }
}
