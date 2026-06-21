// End-of-run recap. Shows after the death sequence (slow-mo + vignette +
// initial epitaph) completes. Brief stats + a single action to start over.
//
// In-world voice — terse, no celebration, no "good job!" The epitaph
// stays the headline; stats are quiet metadata.

import { openScreen, closeScreen } from './screen-manager';
import type { DamageTally } from '../player/damage-recap';
import { hasCommunityLink, openCommunityLink } from '../links';

const SCREEN_ID = 'end';

export interface EndScreenStats {
  depth: number;
  kills: number;
  itemsFound: number;
  elapsed: string;  // pre-formatted "M:SS"
  epitaph: string;  // the in-world goodbye
  /** First-time-seen highlights from this run. Powers the "DISCOVERED"
   *  section — small but the addictive hook. */
  discoveries?: {
    enemies: readonly string[];
    items: readonly string[];
    notes: number;
    newDepthRecord: boolean;
  };
  /** Per-source damage breakdown for this life (biggest first). Renders the
   *  "WHAT TOOK YOU" block — the clerk's note on how it ended. */
  damageRecap?: readonly DamageTally[];
}

let root: HTMLDivElement | null = null;

export function showEndScreen(stats: EndScreenStats, onRiseAgain: () => void) {
  if (root) return;

  root = document.createElement('div');
  root.id = 'end-screen';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    background: 'linear-gradient(180deg, rgba(0,0,0,0.94) 0%, rgba(10, 4, 2, 0.97) 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '22px',
    // z-index managed by the screen manager via policy.layer = 'title'.
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    color: 'rgba(220, 180, 140, 0.9)',
    pointerEvents: 'auto',
    opacity: '0',
    transition: 'opacity 1.0s ease',
    padding: '0 20px',
    textAlign: 'center',
  } as Partial<CSSStyleDeclaration>);

  // Epitaph — the death message in italic, the visual anchor.
  const epi = document.createElement('div');
  epi.textContent = stats.epitaph;
  Object.assign(epi.style, {
    fontSize: 'clamp(18px, 4.5vw, 26px)',
    fontStyle: 'italic',
    color: 'rgba(230, 190, 150, 0.92)',
    letterSpacing: '0.08em',
    maxWidth: '560px',
    lineHeight: '1.4',
    textShadow: '0 0 18px rgba(140, 30, 20, 0.4)',
  });
  root.appendChild(epi);

  // Faint divider.
  const rule = document.createElement('div');
  Object.assign(rule.style, {
    width: '50px',
    height: '1px',
    background: 'rgba(180, 140, 90, 0.4)',
    margin: '6px 0',
  });
  root.appendChild(rule);

  // Stats grid — 2×2 small rows. Tight, restrained, the kind of thing
  // a clerk would note down without ceremony.
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: 'auto auto',
    gap: '4px 24px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    letterSpacing: '0.18em',
    color: 'rgba(180, 150, 120, 0.75)',
  });
  addStatRow(grid, 'DEPTH',  String(stats.depth) + (stats.discoveries?.newDepthRecord ? '  ✦' : ''));
  addStatRow(grid, 'KILLS',  String(stats.kills));
  addStatRow(grid, 'FOUND',  String(stats.itemsFound));
  addStatRow(grid, 'TIME',   stats.elapsed);
  root.appendChild(grid);

  // What took you — the damage recap, biggest source first. A name and a
  // number, no ceremony; the killing blow is the last thing you felt.
  const recap = (stats.damageRecap ?? []).filter((t) => t.total > 0).slice(0, 4);
  if (recap.length) {
    const toll = document.createElement('div');
    Object.assign(toll.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '12px',
      letterSpacing: '0.12em',
      color: 'rgba(170, 130, 105, 0.7)',
      minWidth: '230px',
      maxWidth: '320px',
    } as Partial<CSSStyleDeclaration>);
    const head = document.createElement('div');
    head.textContent = 'WHAT TOOK YOU';
    Object.assign(head.style, {
      fontSize: '10px',
      letterSpacing: '0.28em',
      color: 'rgba(190, 95, 75, 0.7)',
      marginBottom: '2px',
    } as Partial<CSSStyleDeclaration>);
    toll.appendChild(head);
    for (const t of recap) {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', gap: '18px' } as Partial<CSSStyleDeclaration>);
      const name = document.createElement('span');
      name.textContent = t.dot ? `${t.label} (over time)` : t.label;
      const amt = document.createElement('span');
      amt.textContent = String(Math.round(t.total));
      Object.assign(amt.style, { color: 'rgba(206, 120, 100, 0.85)' } as Partial<CSSStyleDeclaration>);
      row.append(name, amt);
      toll.appendChild(row);
    }
    root.appendChild(toll);
  }

  // Discoveries — only shows if this run saw first-time stuff.
  // The hook for "death gave me SOMETHING" — fills the codex.
  const d = stats.discoveries;
  if (d && (d.enemies.length || d.items.length || d.notes > 0 || d.newDepthRecord)) {
    const disc = document.createElement('div');
    Object.assign(disc.style, {
      marginTop: '14px',
      fontFamily: '"Iowan Old Style", "Palatino", serif',
      fontSize: '13px',
      fontStyle: 'italic',
      color: 'rgba(220, 180, 120, 0.7)',
      maxWidth: '480px',
      lineHeight: '1.5',
      textAlign: 'center',
    });
    const lines: string[] = [];
    if (d.newDepthRecord) lines.push('a new depth, recorded.');
    if (d.enemies.length) lines.push(
      `first met: ${d.enemies.map(prettyEnemyName).join(', ')}.`,
    );
    if (d.items.length) lines.push(
      `first held: ${d.items.length} new thing${d.items.length === 1 ? '' : 's'}.`,
    );
    if (d.notes > 0) lines.push(
      `${d.notes} new voice${d.notes === 1 ? '' : 's'} from below.`,
    );
    disc.textContent = lines.join('  ·  ');
    root.appendChild(disc);
  }

  // The single action.
  const btn = document.createElement('button');
  Object.assign(btn.style, {
    marginTop: '8px',
    padding: '12px 36px',
    minWidth: '200px',
    borderRadius: '36px',
    border: '1px solid rgba(255, 190, 120, 0.55)',
    background: 'linear-gradient(180deg, rgba(80, 42, 22, 0.85), rgba(50, 24, 10, 0.85))',
    color: 'rgba(255, 230, 200, 0.98)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '17px',
    fontWeight: '600',
    letterSpacing: '0.26em',
    cursor: 'pointer',
    boxShadow: '0 0 24px rgba(255, 150, 60, 0.28), 0 2px 8px rgba(0,0,0,0.6)',
    transition: 'transform 0.08s ease',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  });
  btn.textContent = 'RISE AGAIN';
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.style.transform = 'scale(0.96)';
  });
  btn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    btn.style.transform = 'scale(1)';
    onRiseAgain();
  });
  btn.addEventListener('pointerleave', () => { btn.style.transform = 'scale(1)'; });
  root.appendChild(btn);

  // Built-in-public nudge — a faint link under the action. Death is the highest-
  // intent moment to turn a fallen delver into the Discord. Hidden until
  // COMMUNITY_URL is set (src/links.ts), so the live build never shows a dead link.
  if (hasCommunityLink()) {
    const community = document.createElement('button');
    Object.assign(community.style, {
      marginTop: '4px',
      padding: '8px 12px',
      background: 'transparent',
      border: 'none',
      color: 'rgba(180, 150, 120, 0.5)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '11px',
      letterSpacing: '0.16em',
      cursor: 'pointer',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTapHighlightColor: 'transparent',
      touchAction: 'manipulation',
    } as Partial<CSSStyleDeclaration>);
    community.textContent = 'built in public · join the deep';
    community.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      openCommunityLink();
    });
    root.appendChild(community);
  }

  document.body.appendChild(root);
  openScreen({
    id: SCREEN_ID,
    root,
    policy: {
      pausesWorld: true,
      hidesHud: true,
      dimsScene: true,
      needsBackdrop: false,
      layer: 'title',
    },
  });
  requestAnimationFrame(() => {
    if (root) root.style.opacity = '1';
  });
}

function prettyEnemyName(id: string): string {
  // Match the in-world tone — terse, lowercase, no plurals.
  const overrides: Record<string, string> = {
    rat: 'the rats', ghoul: 'a ghoul', skirmisher: 'a skirmisher',
    wraith: 'a wraith',
  };
  return overrides[id] ?? id;
}

function addStatRow(grid: HTMLElement, label: string, value: string) {
  const l = document.createElement('div');
  l.textContent = label;
  Object.assign(l.style, {
    textAlign: 'right',
    color: 'rgba(150, 120, 90, 0.75)',
  });
  grid.appendChild(l);

  const v = document.createElement('div');
  v.textContent = value;
  Object.assign(v.style, {
    textAlign: 'left',
    color: 'rgba(230, 200, 170, 0.95)',
    letterSpacing: '0.1em',
    fontWeight: '500',
  });
  grid.appendChild(v);
}

export function hideEndScreen() {
  if (!root) return;
  const r = root;
  root = null;
  r.style.opacity = '0';
  setTimeout(() => r.remove(), 500);
  closeScreen(SCREEN_ID);
}
