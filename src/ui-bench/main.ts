// ── UI Bench — the menu/HUD-chrome iteration loop ────────────────────────
//
// The asset bench (src/bench) renders MODELS with no game underneath; this is
// the same idea for MENUS. It mounts the title screen, the settings + satchel
// sheets, the codex, and a GALLERY of the raw design-language primitives
// (theme.ts tokens, menu-shell buttons, carved frame) on a bare page — no
// engine, no scene, no combat. So the carved UI language can be tuned DOM-fast
// and reviewed instantly instead of booting a run and fighting fade-ins.
//
//   Dev:  /brainstorm/ui-bench.html?ui=<specimen>     (default: gallery)
//   Snap: npm run snap -- ui-<specimen>               (e.g. ui-gallery)
//
// Add a specimen by pushing to SPECIMENS. Keep the gallery the source of truth
// for "what every primitive looks like" — it's the page you tune theme.ts on.

import { THEME, FONT_DISPLAY, FONT_UI, displayHeading, carvedRule, sectionLabel, applyCarvedFrame } from '../ui/theme';
import { createSheet, menuButton } from '../ui/menu-shell';
import { showStartScreen } from '../ui/start-screen';
import { createSettingsMenu, openSettings, configureSettingsMenu } from '../ui/settings-menu';
import { createInventoryPanel, openInventoryPanel } from '../ui/inventory-panel';
import { showCodex } from '../ui/codex-screen';
import { openCardReading } from '../ui/card-reading';
import { getSettings, updateSettings } from '../settings/settings';

interface Specimen {
  name: string;
  label: string;
  /** Mount the specimen. `host` is the centred content area (used by DOM
   *  galleries); screen-manager surfaces ignore it and append to body. */
  mount: (host: HTMLElement) => void;
}

// ── The theme gallery — every primitive on one page ──────────────────────
function mountGallery(host: HTMLElement): void {
  const page = document.createElement('div');
  Object.assign(page.style, {
    width: 'min(720px, 94vw)',
    margin: '0 auto',
    padding: '28px 22px 60px',
    display: 'flex',
    flexDirection: 'column',
    gap: '22px',
    color: THEME.text,
    fontFamily: FONT_UI,
  } as Partial<CSSStyleDeclaration>);

  const head = displayHeading('DELVE · UI BENCH', { size: 24, glow: true });
  head.style.textAlign = 'center';
  page.appendChild(head);

  const tagline = document.createElement('div');
  tagline.textContent = 'carved from the deep — the menu design language';
  Object.assign(tagline.style, {
    textAlign: 'center', fontStyle: 'italic', fontFamily: FONT_DISPLAY,
    fontSize: '13px', color: THEME.dim, marginTop: '-12px',
  } as Partial<CSSStyleDeclaration>);
  page.appendChild(tagline);
  page.appendChild(carvedRule({ glyph: true }));

  // ── Buttons ──
  const btnSec = group('BUTTONS');
  const btnRow = flexRow();
  btnRow.append(
    menuButton('DEFAULT', () => {}),
    menuButton('PRIMARY', () => {}, { primary: true }),
    menuButton('DANGER', () => {}, { danger: true }),
    menuButton('SMALL', () => {}, { small: true }),
    menuButton('SMALL PRIMARY', () => {}, { small: true, primary: true }),
  );
  btnSec.appendChild(btnRow);
  page.appendChild(btnSec);

  // ── Dividers ──
  const ruleSec = group('DIVIDERS');
  ruleSec.appendChild(carvedRule({}));
  ruleSec.appendChild(carvedRule({ glyph: true }));
  page.appendChild(ruleSec);

  // ── Type ──
  const typeSec = group('TYPE');
  typeSec.appendChild(displayHeading('DISPLAY HEADING', { size: 16 }));
  typeSec.appendChild(displayHeading('WITH GLOW', { size: 16, glow: true }));
  typeSec.appendChild(sectionLabel('SECTION LABEL (DENSE DATA)'));
  const body = document.createElement('div');
  body.textContent = 'Body text — dim parchment on near-black. Terse, archaic, cruel.';
  Object.assign(body.style, { fontSize: '13px', color: THEME.text } as Partial<CSSStyleDeclaration>);
  const flavor = document.createElement('div');
  flavor.textContent = 'flavour — the place does not joke.';
  Object.assign(flavor.style, { fontFamily: FONT_DISPLAY, fontStyle: 'italic', fontSize: '13px', color: THEME.dim } as Partial<CSSStyleDeclaration>);
  typeSec.append(body, flavor);
  page.appendChild(typeSec);

  // ── Swatches ──
  const swSec = group('PALETTE');
  const swGrid = document.createElement('div');
  Object.assign(swGrid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '8px',
  } as Partial<CSSStyleDeclaration>);
  const tokens: Array<[string, string]> = [
    ['void', THEME.void], ['panel', THEME.panel], ['raised', THEME.raised], ['sunken', THEME.sunken],
    ['text', THEME.text], ['dim', THEME.dim], ['faint', THEME.faint],
    ['amber', THEME.amber], ['ember', THEME.ember], ['blood', THEME.blood], ['arcane', THEME.arcane],
    ['rule', THEME.rule], ['ruleStrong', THEME.ruleStrong], ['tick', THEME.tick],
  ];
  for (const [label, color] of tokens) {
    const chip = document.createElement('div');
    Object.assign(chip.style, {
      height: '46px', borderRadius: '2px', border: `1px solid ${THEME.rule}`,
      background: color, display: 'flex', alignItems: 'flex-end', padding: '4px 6px',
    } as Partial<CSSStyleDeclaration>);
    const cap = document.createElement('span');
    cap.textContent = label;
    Object.assign(cap.style, {
      fontSize: '9px', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.9)',
      textShadow: '0 1px 2px rgba(0,0,0,0.9)', fontFamily: FONT_UI,
    } as Partial<CSSStyleDeclaration>);
    chip.appendChild(cap);
    swGrid.appendChild(chip);
  }
  swSec.appendChild(swGrid);
  page.appendChild(swSec);

  // ── A carved panel sample (the slab treatment without the Sheet shell) ──
  const panelSec = group('CARVED SLAB');
  const slab = document.createElement('div');
  Object.assign(slab.style, {
    position: 'relative',
    width: '100%', minHeight: '120px', padding: '18px 20px',
    background: `linear-gradient(180deg, ${THEME.raised} 0%, ${THEME.panel} 14%, ${THEME.panel} 100%)`,
    border: `1px solid ${THEME.ruleStrong}`, borderRadius: '3px',
    boxShadow: `${THEME.shadow}, inset 0 0 60px rgba(0,0,0,0.4)`,
    display: 'flex', flexDirection: 'column', gap: '8px',
  } as Partial<CSSStyleDeclaration>);
  slab.appendChild(displayHeading('A SLAB', { size: 14 }));
  const slabBody = document.createElement('div');
  slabBody.textContent = 'Corner ticks + a hot top edge mark it as carved, not boxed.';
  Object.assign(slabBody.style, { fontSize: '12px', color: THEME.dim } as Partial<CSSStyleDeclaration>);
  slab.appendChild(slabBody);
  applyCarvedFrame(slab);
  panelSec.appendChild(slab);
  page.appendChild(panelSec);

  host.appendChild(page);

  function group(label: string): HTMLElement {
    const sec = document.createElement('div');
    Object.assign(sec.style, { display: 'flex', flexDirection: 'column', gap: '10px' } as Partial<CSSStyleDeclaration>);
    sec.appendChild(sectionLabel(label));
    return sec;
  }
  function flexRow(): HTMLElement {
    const r = document.createElement('div');
    Object.assign(r.style, { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' } as Partial<CSSStyleDeclaration>);
    return r;
  }
}

// ── A generic Sheet demo, so the shell itself can be judged ──────────────
function mountSheetDemo(): void {
  const sheet = createSheet({ id: 'ui-bench-sheet', title: 'A Carved Sheet', width: 480 });
  for (const [h, b] of [
    ['THE OFFERING', 'A blade that remembers heat. It will cost you.'],
    ['THE PRICE', 'Four of your own. The basin does not negotiate.'],
  ] as Array<[string, string]>) {
    sheet.body.appendChild(sectionLabel(h));
    const p = document.createElement('div');
    p.textContent = b;
    Object.assign(p.style, { fontFamily: FONT_DISPLAY, fontStyle: 'italic', fontSize: '14px', color: THEME.dim, marginBottom: '6px' } as Partial<CSSStyleDeclaration>);
    sheet.body.appendChild(p);
  }
  sheet.footer.append(
    menuButton('REFUSE', () => sheet.close(), { danger: true }),
    menuButton('TAKE IT', () => {}, { primary: true }),
  );
  sheet.open();
}

const SPECIMENS: Specimen[] = [
  { name: 'gallery', label: 'GALLERY', mount: mountGallery },
  { name: 'sheet', label: 'SHEET', mount: () => mountSheetDemo() },
  {
    name: 'title', label: 'TITLE',
    mount: () => showStartScreen({
      hasSave: false,
      onDescend: () => {}, onContinue: () => {},
      onTutorial: () => {}, onTestChambers: () => {}, onProvingGrounds: () => {},
    }),
  },
  {
    name: 'title-save', label: 'TITLE · SAVE',
    mount: () => showStartScreen({
      hasSave: true, saveDepth: 4,
      onDescend: () => {}, onContinue: () => {},
      onTutorial: () => {}, onTestChambers: () => {}, onProvingGrounds: () => {},
    }),
  },
  {
    name: 'settings', label: 'SETTINGS',
    mount: () => {
      configureSettingsMenu({ abandonRun: () => {}, quitToMenu: () => {}, exitGame: () => {} });
      createSettingsMenu();
      openSettings();
    },
  },
  {
    name: 'inventory', label: 'SATCHEL',
    mount: () => { createInventoryPanel(); openInventoryPanel(); },
  },
  { name: 'codex', label: 'CODEX', mount: () => showCodex() },
  { name: 'reading', label: 'READING', mount: () => openCardReading() },
];

// ── Boot ──────────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const wanted = params.get('ui') ?? 'gallery';
// Optional: ?dev=1 flips Developer Mode so the DEBUG tab + title TEST/PROVING
// links can be previewed (persists to settings, same as the in-game toggle).
if (params.has('dev')) updateSettings({ developerMode: params.get('dev') === '1' });

const active = SPECIMENS.find((s) => s.name === wanted) ?? SPECIMENS[0];

// ── Toolbar — specimen picker. Fixed top; clicking navigates ?ui=name. ──
const bar = document.createElement('div');
Object.assign(bar.style, {
  position: 'fixed', top: '0', left: '0', right: '0', zIndex: '99999',
  display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center',
  padding: '7px 10px',
  background: 'rgba(6, 4, 2, 0.92)',
  borderBottom: `1px solid ${THEME.rule}`,
  fontFamily: FONT_UI,
} as Partial<CSSStyleDeclaration>);
const brand = document.createElement('span');
brand.textContent = 'UI BENCH';
Object.assign(brand.style, {
  fontSize: '10px', letterSpacing: '0.22em', color: THEME.amber, marginRight: '8px',
} as Partial<CSSStyleDeclaration>);
bar.appendChild(brand);
for (const s of SPECIMENS) {
  const b = document.createElement('button');
  b.textContent = s.label;
  const on = s.name === active.name;
  Object.assign(b.style, {
    padding: '5px 10px', minHeight: '30px',
    background: on ? 'rgba(80, 50, 30, 0.85)' : 'transparent',
    border: `1px solid ${on ? THEME.ember : THEME.rule}`,
    color: on ? THEME.amber : THEME.dim,
    fontSize: '10px', fontWeight: '600', letterSpacing: '0.12em',
    borderRadius: '2px', cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  b.addEventListener('click', () => {
    const p = new URLSearchParams(location.search);
    p.set('ui', s.name);
    location.search = p.toString();
  });
  bar.appendChild(b);
}
document.body.appendChild(bar);

// ── Content host — centred scroll region below the toolbar ──
const host = document.createElement('div');
Object.assign(host.style, {
  position: 'fixed', inset: '46px 0 0 0', overflowY: 'auto',
  display: 'flex', flexDirection: 'column', justifyContent: 'flex-start',
} as Partial<CSSStyleDeclaration>);
document.body.appendChild(host);

active.mount(host);
