// Art-style selector. Persisted in localStorage so it survives page reloads
// (the death sequence reloads, the style cycler also reloads — keeping the
// chosen style across both).
//
// Cycle order: ps1 → flat → stone → ps1. Reload-based swap keeps the
// implementation trivially correct (no live material mutation, no in-flight
// state to preserve) at the cost of a 1-2s reload per switch — fine for an
// A/B comparison flow.

export type Style = 'ps1' | 'flat' | 'stone';

const STORAGE_KEY = 'delve-art-style';
const ORDER: Style[] = ['ps1', 'flat', 'stone'];

export function getStyle(): Style {
  const stored = localStorage.getItem(STORAGE_KEY);
  return ORDER.includes(stored as Style) ? (stored as Style) : 'ps1';
}

export function cycleStyle() {
  const cur = getStyle();
  const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
  localStorage.setItem(STORAGE_KEY, next);
  window.location.reload();
}

export function styleLabel(s: Style): string {
  switch (s) {
    case 'ps1':
      return 'PS1';
    case 'flat':
      return 'FLAT';
    case 'stone':
      return 'STONE';
  }
}
