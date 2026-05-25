// World-freeze flag — independent from hit-pause. Used by scenarios so the snap
// CLI can capture a deterministic frame instead of racing animations.

let frozen = false;

export function isWorldFrozen(): boolean {
  return frozen;
}

export function setWorldFrozen(f: boolean): void {
  frozen = f;
}
