// Proving Grounds picker — pick a weapon + what to test, tap Descend, you're in
// a generated floor. Every list is registry-driven (weapons from ITEMS via the
// authorable registry, fights from ENEMIES, events from the proving table), so
// it never needs hand-maintaining as content grows.

import { listWeapons, listMobs } from '../debug/authorables';
import { PROVING_EVENTS } from '../level/proving-grounds';

export type ProvingMode = 'fight' | 'event' | 'descent';
export interface ProvingLaunch {
  weaponId: string;
  mode: ProvingMode;
  target: string;   // enemyId | eventId | depth-as-string
}

const DEPTHS = [1, 2, 3, 4, 5, 7, 9, 12];

export function showProvingGroundsScreen(
  onLaunch: (launch: ProvingLaunch) => void,
  onBack: () => void,
): void {
  let weaponId = 'rusted-sword';
  let mode: ProvingMode = 'fight';
  let target = '';

  const root = document.createElement('div');
  root.id = 'proving-grounds';
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '8000', overflowY: 'auto',
    background: '#0b0c0e', color: '#cdd2d8',
    font: '13px ui-monospace, monospace',
    padding: 'calc(env(safe-area-inset-top,8px) + 10px) 12px 96px',
  } as CSSStyleDeclaration);

  root.innerHTML =
    `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
       <div style="letter-spacing:.25em;color:#8a93a0;text-transform:uppercase">Proving Grounds</div>
     </div>
     <div style="color:#5f6772;margin-bottom:14px">pick a weapon, pick what to test, descend.</div>`;

  // ── Weapon row ───────────────────────────────────────────────────
  root.appendChild(sectionLabel('Weapon'));
  const weaponWrap = chipWrap();
  const weaponChips: Array<{ id: string; el: HTMLElement }> = [];
  for (const w of listWeapons()) {
    const el = chip(w.label, () => { weaponId = w.id; refreshWeapons(); });
    weaponChips.push({ id: w.id, el });
    weaponWrap.appendChild(el);
  }
  root.appendChild(weaponWrap);
  function refreshWeapons() {
    for (const c of weaponChips) setSelected(c.el, c.id === weaponId);
  }

  // ── Mode tabs ────────────────────────────────────────────────────
  root.appendChild(sectionLabel('What to test'));
  const tabs = chipWrap();
  const tabDefs: Array<{ m: ProvingMode; label: string }> = [
    { m: 'fight', label: 'Fight' }, { m: 'event', label: 'Event' }, { m: 'descent', label: 'Descent' },
  ];
  const tabEls: Array<{ m: ProvingMode; el: HTMLElement }> = [];
  for (const t of tabDefs) {
    const el = chip(t.label, () => { mode = t.m; target = ''; refreshTabs(); renderContent(); });
    tabEls.push({ m: t.m, el });
    tabs.appendChild(el);
  }
  root.appendChild(tabs);
  function refreshTabs() { for (const t of tabEls) setSelected(t.el, t.m === mode); }

  // ── Content list (per mode) ──────────────────────────────────────
  const content = document.createElement('div');
  root.appendChild(content);
  function renderContent() {
    content.replaceChildren();
    const wrap = chipWrap();
    let items: Array<{ id: string; label: string; tag?: string }>;
    if (mode === 'fight') {
      items = listMobs()
        .sort((a, b) => Number(b.tags.includes('boss')) - Number(a.tags.includes('boss')))
        .map((m) => ({ id: m.id, label: m.label, tag: m.tags.includes('boss') ? 'boss' : undefined }));
    } else if (mode === 'event') {
      items = PROVING_EVENTS.map((e) => ({ id: e.id, label: e.label }));
    } else {
      items = DEPTHS.map((d) => ({ id: String(d), label: `Depth ${d}` }));
    }
    const els: Array<{ id: string; el: HTMLElement }> = [];
    for (const it of items) {
      const label = it.tag ? `${it.label} · ${it.tag}` : it.label;
      const el = chip(label, () => { target = it.id; for (const e of els) setSelected(e.el, e.id === target); refreshGo(); });
      els.push({ id: it.id, el });
      wrap.appendChild(el);
    }
    content.appendChild(wrap);
    refreshGo();
  }

  // ── Footer: Back + Descend ───────────────────────────────────────
  const footer = document.createElement('div');
  Object.assign(footer.style, {
    // ABOVE the screen root (z 8000): the footer is a body sibling, so without
    // a higher z-index the full-screen root paints over it and eats every tap —
    // you could select chips but never reach Back / Descend.
    position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '8001',
    display: 'flex', gap: '10px', padding: '10px 12px calc(env(safe-area-inset-bottom,8px) + 10px)',
    background: '#0b0c0eee', borderTop: '1px solid #23262b',
  } as CSSStyleDeclaration);
  const back = chip('‹ Back', () => { root.remove(); onBack(); });
  // Descend is the primary call-to-action — it needs to read as
  // OBVIOUSLY-a-button, not as another row chip. Bigger, bolder, solid
  // green fill once a target's locked in; the disabled state spells
  // out the next step instead of just dimming opacity.
  const go = document.createElement('button');
  Object.assign(go.style, {
    flex: '1',
    minHeight: '52px',
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid',
    fontWeight: '700',
    letterSpacing: '.06em',
    textAlign: 'center',
    font: '14px ui-monospace, monospace',
    cursor: 'pointer',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);
  go.addEventListener('click', () => {
    if (!target) return;
    root.remove();
    onLaunch({ weaponId, mode, target });
  });
  footer.append(back, go);
  function refreshGo() {
    if (target) {
      go.textContent = 'DESCEND ⟶';
      go.style.background = '#3a6b3a';
      go.style.borderColor = '#7ab07a';
      go.style.color = '#eaf6ea';
      go.style.cursor = 'pointer';
      go.disabled = false;
    } else {
      go.textContent = 'Pick a target first';
      go.style.background = '#16181c';
      go.style.borderColor = '#2b2f36';
      go.style.color = '#6b727c';
      go.style.cursor = 'not-allowed';
      go.disabled = true;
    }
  }

  document.body.appendChild(root);
  document.body.appendChild(footer);
  // footer lives outside root so it stays pinned; remove it with root.
  const origRemove = root.remove.bind(root);
  root.remove = () => { origRemove(); footer.remove(); };

  refreshWeapons();
  refreshTabs();
  renderContent();
}

// ── tiny DOM helpers ─────────────────────────────────────────────────
function sectionLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    fontSize: '11px', letterSpacing: '.18em', color: '#7c8492',
    textTransform: 'uppercase', margin: '14px 2px 7px',
  } as CSSStyleDeclaration);
  el.textContent = text;
  return el;
}

function chipWrap(): HTMLElement {
  const el = document.createElement('div');
  Object.assign(el.style, { display: 'flex', flexWrap: 'wrap', gap: '7px' } as CSSStyleDeclaration);
  return el;
}

function chip(text: string, onClick: () => void): HTMLElement {
  const el = document.createElement('button');
  el.textContent = text;
  Object.assign(el.style, {
    padding: '9px 13px', borderRadius: '8px', border: '1px solid #2b2f36',
    background: '#16181c', color: '#cdd2d8', font: '13px ui-monospace, monospace',
    cursor: 'pointer',
  } as CSSStyleDeclaration);
  el.addEventListener('click', onClick);
  return el;
}

function setSelected(el: HTMLElement, on: boolean): void {
  el.style.background = on ? '#2a3a2a' : '#16181c';
  el.style.borderColor = on ? '#5a8a5a' : '#2b2f36';
  el.style.color = on ? '#e6f0e6' : '#cdd2d8';
}
