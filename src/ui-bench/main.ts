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

// ── GRIMOIRE prototype — the fresh menu-chrome direction (docs/UI-CHARTER.md) ──
// The menu as a page of the dungeon's book: black ink on aged cream paper, a
// thin passive header, a drop-cap chapter title, rite rows, and WAX-SEAL actions
// in the bottom thumb corners. The watching eye is the book's presence. (Display
// font loaded from Google here for the demo; self-host for the PWA.)
function mountGrimoire(host: HTMLElement): void {
  if (!document.getElementById('grimoire-css')) {
    const base = import.meta.env.BASE_URL; // self-hosted → renders offline / in the PWA
    const st = document.createElement('style'); st.id = 'grimoire-css';
    st.textContent =
      `@font-face{font-family:'Grenze Gotisch';font-weight:600;font-display:swap;src:url('${base}fonts/grenze-gotisch-600.woff2') format('woff2')}` +
      `@font-face{font-family:'Grenze Gotisch';font-weight:700;font-display:swap;src:url('${base}fonts/grenze-gotisch-700.woff2') format('woff2')}` +
      '.grim-rite{transition:background .12s,padding-left .12s}.grim-rite:hover{background:rgba(26,20,13,0.07);padding-left:13px}';
    document.head.appendChild(st);
  }
  const PAPER = '#E7DEC8', INK = '#1a140d', BLOOD = '#a4231c', GOLD = '#9a7b3a', FADE = '#8a7b5e';
  // single-quoted family names — these get interpolated into double-quoted HTML
  // style="" attributes, so double quotes here would close the attribute early.
  const BLACK = "'Grenze Gotisch', 'Iowan Old Style', serif"; // grimdark blackletter, legible
  const SERIF = "'Iowan Old Style', 'Palatino Linotype', Georgia, serif";
  const SANS = 'system-ui, -apple-system, sans-serif';

  // Sized by viewport HEIGHT (landscape) + aspect-ratio, so it grows on desktop
  // instead of staying a phone-width panel; capped so it never gets absurd.
  const page = document.createElement('div');
  Object.assign(page.style, {
    position: 'relative', height: 'clamp(280px, 88vh, 600px)', aspectRatio: '16 / 8.4', maxWidth: '96vw', color: INK, fontFamily: SERIF,
    background: `radial-gradient(130% 130% at 50% -10%, #f1e9d3, ${PAPER} 55%, #d6ccb0 100%)`,
    borderRadius: '3px', overflow: 'hidden', border: `1px solid #0d0a06`,
    boxShadow: '0 22px 70px rgba(0,0,0,0.85), inset 0 0 80px rgba(110,80,44,0.26), inset 0 0 0 7px rgba(28,20,12,0.07)',
  } as Partial<CSSStyleDeclaration>);

  // ── damaged-parchment material — multi-scale, low-frequency-weighted (NOT
  // uniform grain). Mottling + stains + aged edges carry the texture; fine grain
  // is only a whisper. (Diablo II / Darkest Dungeon / Pentiment all worked the
  // edges + tonal blotches, never a flat noise overlay.)
  const layer = (s: Partial<CSSStyleDeclaration>) => {
    const d = document.createElement('div');
    Object.assign(d.style, { position: 'absolute', inset: '0', pointerEvents: 'none', mixBlendMode: 'multiply' } as Partial<CSSStyleDeclaration>, s);
    page.appendChild(d);
  };
  // big soft tonal blotches — the dominant "aged" variation (low baseFrequency)
  layer({ opacity: '0.5', backgroundSize: '380px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='380' height='380'%3E%3Cfilter id='m'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.013' numOctaves='3' seed='7'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23m)'/%3E%3C/svg%3E")` });
  // stains / foxing — a few warm-brown pools, off-centre and uneven
  layer({ opacity: '0.7', backgroundImage: `radial-gradient(42% 55% at 16% 24%, rgba(120,84,38,0.22), transparent 70%), radial-gradient(48% 42% at 84% 80%, rgba(92,58,26,0.20), transparent 72%), radial-gradient(30% 30% at 72% 14%, rgba(116,42,20,0.10), transparent 70%), radial-gradient(26% 36% at 40% 92%, rgba(80,52,22,0.16), transparent 74%)` });
  // worn/darkened edges — handling ages the border; centre stays clean + readable
  layer({ backgroundImage: `radial-gradient(125% 135% at 50% 46%, transparent 50%, rgba(74,48,20,0.28) 86%, rgba(44,27,11,0.55) 100%)` });
  // a whisper of fibre grain on top — texture, not the main event
  layer({ opacity: '0.04', backgroundSize: '150px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` });

  // watching-eye watermark — the book's presence
  const eye = document.createElement('div');
  Object.assign(eye.style, { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: '0.075', pointerEvents: 'none' } as Partial<CSSStyleDeclaration>);
  eye.innerHTML = `<svg viewBox="0 0 24 24" width="54%" fill="none" stroke="${INK}" stroke-width="0.55"><path d="M2 12 C 6 6, 18 6, 22 12 C 18 18, 6 18, 2 12 Z"/><circle cx="12" cy="12" r="3.4" fill="${INK}" stroke="none"/></svg>`;
  page.appendChild(eye);

  const pad = document.createElement('div');
  Object.assign(pad.style, { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', padding: 'clamp(14px,3vw,26px)' } as Partial<CSSStyleDeclaration>);
  page.appendChild(pad);

  // ── thin passive header — depth + gold, no actions up here ──
  const top = document.createElement('div');
  Object.assign(top.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontFamily: SANS, fontSize: '10px', letterSpacing: '0.22em', textTransform: 'uppercase', color: FADE, flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
  top.innerHTML = `<span>Depth IV · the Ossuary</span><span style="color:${GOLD}">✦ 128 gold</span>`;
  pad.appendChild(top);

  // ── chapter title with a blood drop-cap ──
  const title = document.createElement('div');
  Object.assign(title.style, { display: 'flex', alignItems: 'flex-end', gap: '6px', margin: '6px 0 2px', flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
  title.innerHTML =
    `<span style="font-family:${BLACK};font-weight:700;font-size:clamp(42px,9vw,70px);line-height:0.78;color:${BLOOD};text-shadow:0 1px 0 rgba(0,0,0,0.15)">T</span>` +
    `<span style="font-family:${BLACK};font-weight:700;font-size:clamp(24px,5vw,40px);line-height:1;color:${INK}">he Fire</span>`;
  pad.appendChild(title);
  const rule = document.createElement('div');
  Object.assign(rule.style, { height: '2px', background: `linear-gradient(90deg, ${BLOOD}, transparent 70%)`, opacity: '0.7', margin: '0 0 8px', flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
  pad.appendChild(rule);

  // ── the rites — a single list, tappable rows (progressive disclosure) ──
  const list = document.createElement('div');
  Object.assign(list.style, { flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: 'clamp(2px,1vh,8px)', overflow: 'hidden' } as Partial<CSSStyleDeclaration>);
  const rites: Array<[string, string]> = [
    ['Spend your fate', 'two cards wait to be claimed'],
    ['Tend your wounds', 'rest, and the fire mends a little'],
    ['Read the book', 'what the dungeon has written of you'],
  ];
  for (const [name, sub] of rites) {
    const r = document.createElement('button');
    r.className = 'grim-rite';
    Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '13px', width: '100%', minHeight: '46px', padding: '7px 9px', background: 'transparent', border: 'none', borderBottom: `1px solid rgba(26,20,13,0.16)`, color: INK, cursor: 'pointer', textAlign: 'left' } as Partial<CSSStyleDeclaration>);
    r.innerHTML =
      `<span style="font-family:${BLACK};font-size:21px;color:${BLOOD};width:20px;text-align:center;text-shadow:0 1px 0 rgba(0,0,0,0.12)">✠</span>` +
      `<span style="flex:1"><span style="font-family:${SERIF};font-size:clamp(15px,2.4vw,19px)">${name}</span>` +
      `<span style="display:block;font-family:${SANS};font-size:10px;letter-spacing:0.04em;color:${FADE}">${sub}</span></span>` +
      `<span style="color:${FADE};font-size:16px">›</span>`;
    list.appendChild(r);
  }
  pad.appendChild(list);

  // ── thumb rail — seals in the bottom corners ──
  const rail = document.createElement('div');
  Object.assign(rail.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: '0 0 auto', paddingTop: '8px' } as Partial<CSSStyleDeclaration>);
  rail.appendChild(seal('Close', false));
  rail.appendChild(seal('Rise', true));
  pad.appendChild(rail);

  function seal(label: string, primary: boolean): HTMLElement {
    const b = document.createElement('button');
    Object.assign(b.style, { position: 'relative', minWidth: '92px', minHeight: '44px', padding: '8px 22px', cursor: 'pointer', fontFamily: SANS, fontSize: '11px', fontWeight: '700', letterSpacing: '0.2em', textTransform: 'uppercase', borderRadius: '40px', color: primary ? '#f3e6cf' : INK, background: primary ? `radial-gradient(circle at 50% 35%, #b8281f, ${BLOOD})` : 'transparent', border: primary ? `1px solid #5e120d` : `1.5px solid ${INK}`, boxShadow: primary ? '0 3px 10px rgba(120,20,16,0.5), inset 0 1px 2px rgba(255,255,255,0.25)' : 'none' } as Partial<CSSStyleDeclaration>);
    b.textContent = label;
    return b;
  }

  // centre the page in the viewport (the real menu is centred; the bench host
  // isn't by default) so the desktop reads as a page held to the dark.
  Object.assign(host.style, { display: 'flex', alignItems: 'center', justifyContent: 'center' } as Partial<CSSStyleDeclaration>);
  host.appendChild(page);
}

const SPECIMENS: Specimen[] = [
  { name: 'gallery', label: 'GALLERY', mount: mountGallery },
  { name: 'grimoire', label: 'GRIMOIRE', mount: mountGrimoire },
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
