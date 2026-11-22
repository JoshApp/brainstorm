// Weapon swap as one verb any device can ask for.
//
// The swap needs the live viewmodel (no swap mid-swing), which main.ts owns,
// so main.ts registers the handler and every control — the HUD chip, the
// swap key, the gamepad's Y — calls triggerWeaponSwap(). Before this the swap
// existed only as the chip's inline callback, so the keyboard and gamepad had
// no way to reach it.

let handler: (() => void) | null = null;

export function setWeaponSwapHandler(fn: () => void): void { handler = fn; }

export function triggerWeaponSwap(): void { handler?.(); }
