import { clearInventory, addItemSilently } from '../player/inventory';
import { clearReliquary } from '../player/reliquary';
import { setSlot, type EquipSlot } from '../player/equipment';
import { ITEMS } from '../content/items';
import { get as getEntity } from '../ecs/world';
import { hydrateCharacter } from './character';
import { resetStamina } from '../combat/stamina';
import { resetDashInput } from '../controls/dash-input';
import type { loadSave } from './run-state';

// Hydrate run state (inventory, equipment, HP) from a save — or apply the
// fresh-run defaults when given null. Extracted from main.ts; pure in the
// sense that it only drives the existing player/inventory/equipment modules
// and captures none of main's orchestration state.

export function applyState(saveData: ReturnType<typeof loadSave>) {
  // Reset inventory + reliquary.
  clearInventory();
  clearReliquary();
  // Hydrate inventory from save (or empty for new run).
  if (saveData) {
    for (const [id, count] of Object.entries(saveData.inventory)) {
      // Pre-purge saves may carry ids of retired items (the old paperdoll
      // armor/rings). Skip anything the registry no longer knows — a ghost
      // entry would render as a nameless, unusable row.
      if (!ITEMS[id]) continue;
      for (let i = 0; i < count; i++) addItemSilently(id);
    }
  }
  // Equipment — set saved slots, OR defaults for new runs.
  // Fresh runs deliberately START WITHOUT a weapon — the player picks
  // one at an altar in the starter chamber (the first room of every
  // run). The OFFHAND starts EMPTY: the lamp is no longer an item, it's
  // baked into the player (a permanent worn hip-lantern — see
  // handheld-lamp.ts / attachLamp in main.ts), so the slot is free for
  // a shield or focus.
  if (saveData) {
    for (const [slot, itemId] of Object.entries(saveData.equipment)) {
      // Legacy saves carry an equipped oil-lamp offhand — drop it so the
      // slot frees up now that the lamp is baked in.
      if (slot === 'offhand' && itemId === 'oil-lamp') continue;
      // Only the 3 CURRENT slots hydrate — a legacy save's helmet/ring1/etc.
      // are dropped (the item system changed to weapon/offhand/vestment + relics).
      if (slot !== 'weapon' && slot !== 'offhand' && slot !== 'vestment') continue;
      // A saved id the registry no longer knows (retired item) restores as
      // EMPTY — except the weapon, which falls back to the rusted sword below.
      if (itemId && ITEMS[itemId]) setSlot(slot as EquipSlot, ITEMS[itemId]);
    }
    // Safety: legacy saves predating the starter chamber may have no
    // weapon recorded — or a weapon id that no longer exists; give them
    // a rusted sword so they're not stuck unarmed mid-dungeon on resume.
    const savedWeapon = saveData.equipment.weapon;
    if (!savedWeapon || !ITEMS[savedWeapon]) setSlot('weapon', ITEMS['rusted-sword']);
  }
  // Character — restore the saved build (attributes/proficiencies/unspent)
  // so a reload/resume keeps your progression. Null save (fresh run) →
  // no-op; the run's resetCharacter has already set baseline.
  if (saveData?.character) hydrateCharacter(saveData.character);

  // HP — restore to saved value, or full for new run.
  const player = getEntity('player');
  if (player?.hp) {
    player.hp.current = saveData ? saveData.hp : player.hp.base;
  }

  // Stamina is not persisted — it regenerates in seconds. Start every
  // floor (and every resume) at full so you arrive ready, not winded.
  resetStamina();
  // Drop any dash queued right as the floor swapped, so it can't fire a
  // phantom lunge on the first frame of the new level.
  resetDashInput();
}
