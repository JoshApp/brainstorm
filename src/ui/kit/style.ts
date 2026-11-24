// Kit styles shared by every Lamplight screen: carved keycaps for prompts.
// Injected once; plain CSS so a screen only adds classes.

import { activeDevice, onActiveDeviceChange } from '../../controls/active-device';

let injected = false;

export function injectKitStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const st = document.createElement('style');
  st.id = 'lamplight-kit';
  st.textContent = `
    /* Carved keycaps: dark stone, a bone letter. Controller faces keep only a hint of their colour. */
    .lk-key, .lk-pad {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box;
      font: 600 11px/1 system-ui, -apple-system, sans-serif; letter-spacing: 0;
      color: #ecd3aa; text-shadow: 0 1px 0 #000;
      background: linear-gradient(#3b291b, #1d140d);
      border: 1px solid rgba(180, 130, 80, .55); border-radius: 4px;
      box-shadow: inset 0 1px 0 rgba(255, 220, 170, .14), 0 1px 0 #000;
      white-space: nowrap;
    }
    .lk-pad { border-radius: 999px; background: radial-gradient(circle at 50% 35%, #3b291b, #150e09); }
    .lk-a { border-color: rgba(127, 191, 106, .75); color: #cfe6b8; }
    .lk-b { border-color: rgba(208, 98, 79, .75); color: #f0c0b0; }
    .lk-x { border-color: rgba(98, 140, 208, .75); color: #c0d0f0; }
    .lk-y { border-color: rgba(210, 180, 80, .75); color: #f0e0a8; }
    /* A HUD control's button, tucked onto its rim (kit/prompts.ts attachHudPrompt). */
    .lk-hudkey { position: absolute; z-index: 3; pointer-events: none; min-width: 19px; height: 19px; padding: 0 5px; font-size: 10px;
      box-shadow: inset 0 1px 0 rgba(255, 220, 170, .14), 0 1px 0 #000, 0 0 0 2px rgba(8, 5, 3, .85); }
    .lk-hudkey[data-corner="br"] { right: -5px; bottom: -5px; }
    .lk-hudkey[data-corner="bl"] { left: -5px; bottom: -5px; }
    .lk-hudkey[data-corner="tr"] { right: -5px; top: -5px; }
    .lk-hudkey[data-corner="tl"] { left: -5px; top: -5px; }

    /* The torch on whatever keys or a controller have chosen in a sheet. On touch
       nothing is drawn: the finger is the selection. */
    html:not([data-input="touch"]) .lk-sheet .is-focused {
      outline: 1px solid rgba(255, 176, 96, .8); outline-offset: 2px;
      box-shadow: 0 0 18px rgba(255, 150, 60, .30);
    }

    /* The item preview as a scorched slab: a charred, uneven edge, an ember line
       that breathes, and a warm reading light from the top left. */
    .lk-detail {
      position: relative; border: 0; border-radius: 2px;
      background:
        radial-gradient(110% 70% at 18% 0%, rgba(255, 168, 88, .12), rgba(255, 168, 88, 0) 70%),
        radial-gradient(120% 55% at 50% 118%, rgba(255, 110, 30, .12), rgba(255, 90, 20, 0) 72%),
        linear-gradient(rgba(20, 13, 9, .94), rgba(9, 6, 4, .96));
    }
    .lk-detail::before, .lk-detail::after {
      content: ''; position: absolute; inset: 2px; pointer-events: none; filter: url(#lk-char);
    }
    .lk-detail::after { border: 3px solid #0b0604; }
    .lk-detail::before {
      border: 1px solid rgba(255, 120, 40, .32);
      box-shadow: 0 0 10px rgba(255, 110, 30, .28), inset 0 0 16px rgba(255, 110, 30, .14);
      animation: lk-breathe 3.1s ease-in-out infinite;
    }
    @keyframes lk-breathe { 50% { opacity: .72; } }
    .lk-burn {
      -webkit-mask-image: linear-gradient(90deg, #000 45%, rgba(0,0,0,.35) 50%, transparent 55%);
      mask-image: linear-gradient(90deg, #000 45%, rgba(0,0,0,.35) 50%, transparent 55%);
      -webkit-mask-size: 260% 100%; mask-size: 260% 100%;
      animation: lk-burnin .9s ease-out both;
    }
    @keyframes lk-burnin {
      0% { -webkit-mask-position: 100% 0; mask-position: 100% 0; filter: brightness(1.8) drop-shadow(0 0 6px rgba(255,150,50,.9)); }
      100% { -webkit-mask-position: 0 0; mask-position: 0 0; filter: none; }
    }
    .lk-ash { animation: lk-ashin .8s .25s ease-out both; }
    @keyframes lk-ashin { from { opacity: 0; transform: translateY(4px); } }
    @media (prefers-reduced-motion: reduce) { .lk-detail::before, .lk-burn, .lk-ash { animation: none; } }

    /* An offering on a deal screen: lit from its glyph's side in its stake's colour. */
    .lk-offer {
      --stake: 188, 198, 205;
      display: grid; grid-template-columns: 34px minmax(0, 1fr); column-gap: 14px; align-items: center;
      width: 100%; min-height: 56px; padding: 8px 14px; margin: 0 0 8px; box-sizing: border-box; text-align: left;
      background: rgba(12, 8, 5, .55); border: 1px solid rgba(var(--stake), .28); border-radius: 2px;
      cursor: pointer; color: #e6c8aa; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
      transition: background .25s, border-color .2s, box-shadow .2s;
    }
    .lk-offer-glyph { grid-row: span 2; width: 32px; height: 32px; object-fit: contain; filter: drop-shadow(0 0 5px rgba(var(--stake), .45)); }
    .lk-offer-label { font: 600 13px/1.25 'Cinzel', 'Iowan Old Style', serif; letter-spacing: .16em; min-width: 0; }
    .lk-offer-note { grid-column: 2; font: italic 14px/1.35 'EB Garamond', 'Iowan Old Style', serif; color: #a08264; min-width: 0; }
    .lk-offer:hover, .lk-sheet .lk-offer.is-focused {
      outline: none; box-shadow: 0 0 24px rgba(var(--stake), .14);
      border-color: rgba(var(--stake), .7);
      background: radial-gradient(130% 160% at 0% 50%, rgba(var(--stake), .24) 0%, rgba(var(--stake), .07) 45%, rgba(var(--stake), 0) 75%), rgba(12, 8, 5, .55);
    }
    .lk-offer.armed { border-color: rgba(var(--stake), .95); background: radial-gradient(130% 160% at 0% 50%, rgba(var(--stake), .34) 0%, rgba(var(--stake), .1) 50%, rgba(var(--stake), 0) 80%), rgba(12, 8, 5, .6); }
    .lk-offer.armed .lk-offer-note { color: rgb(var(--stake)); font-style: normal; font-family: system-ui, -apple-system, sans-serif; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
    .lk-offer:disabled { cursor: default; filter: grayscale(.85) brightness(.7); opacity: .6; box-shadow: none; }
    /* Dark, thin scrollbars inside menus: the bright browser default broke the dark. */
    .lk-sheet, .lk-sheet * { scrollbar-width: thin; scrollbar-color: rgba(150, 105, 65, .55) rgba(12, 8, 5, .6); }
    .lk-sheet ::-webkit-scrollbar { width: 8px; height: 8px; }
    .lk-sheet ::-webkit-scrollbar-track { background: rgba(12, 8, 5, .6); }
    .lk-sheet ::-webkit-scrollbar-thumb { background: rgba(150, 105, 65, .55); border-radius: 4px; }
    /* Settings levels: notches that burn, the last one flickering. */
    .lk-notches { display: flex; gap: 4px; padding: 6px 2px; cursor: pointer; touch-action: none; }
    .lk-notches i { flex: 1; height: 14px; transform: skewX(-12deg); background: rgba(14, 8, 8, .8); border: 1px solid rgba(180, 140, 80, .35); }
    .lk-notches i.on { background: linear-gradient(#ffd27a, #e07020); border-color: rgba(255, 170, 80, .6); box-shadow: 0 0 6px rgba(255, 140, 50, .4); }
    .lk-notches i.tip { animation: lk-breathe 1.7s ease-in-out infinite; box-shadow: 0 0 10px rgba(255, 150, 50, .9); }
    /* Tabs, the satchel's grammar: carved caps, the chosen one lit, an ember underline. */
    .lk-tab { flex: 0 0 auto; min-height: 42px; padding: 8px 12px; border: 0; border-bottom: 2px solid transparent; background: none;
      font: 600 11px/1 'Cinzel', 'Iowan Old Style', serif; letter-spacing: .16em; color: rgba(200, 165, 125, .6); cursor: pointer;
      white-space: nowrap; touch-action: manipulation; transition: color .15s, border-color .15s; }
    .lk-tab:hover { color: rgba(236, 200, 150, .85); }
    .lk-tab.on { color: #ffd9a6; border-bottom-color: rgba(255, 176, 96, .85); text-shadow: 0 0 10px rgba(255, 176, 96, .45); }
    /* A setting's explanation: with keys or a pad, one line until the row is chosen;
       on touch (nothing is ever chosen) it stays whole. */
    html:not([data-input="touch"]) .lk-sheet .lk-desc { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden; }
    html:not([data-input="touch"]) .lk-sheet :is(.is-focused, :has(> .is-focused)) > .lk-desc { -webkit-line-clamp: unset; }
    /* A choice of a few words (settings): the chosen one lit, an ember mark under it. */
    .lk-choice { display: flex; gap: 2px; flex-shrink: 0; }
    .lk-choice span { position: relative; padding: 6px 9px 8px; cursor: pointer; font: 600 11px/1 'Cinzel', 'Iowan Old Style', serif;
      letter-spacing: .16em; color: rgba(170, 135, 100, .5); transition: color .18s, text-shadow .2s; -webkit-tap-highlight-color: transparent; }
    .lk-choice span:hover { color: rgba(220, 180, 140, .8); }
    .lk-choice span.on { color: #ffd9a6; text-shadow: 0 0 10px rgba(255, 176, 96, .6); }
    .lk-choice span.on::after { content: ''; position: absolute; left: 50%; bottom: 1px; width: 5px; height: 5px; margin-left: -3px;
      transform: rotate(45deg); background: #ffb060; box-shadow: 0 0 6px rgba(255, 150, 50, .9); }
    .lk-offer:disabled .lk-offer-label { text-decoration: line-through rgba(160, 130, 100, .5); }

    /* A ROW in a reading list (character, codex): chosen, it lights from its
       left edge like a page held to the lamp, and its value glows. */
    .lk-row { position: relative; padding: 9px 10px 9px 14px; border-bottom: 1px solid rgba(120, 90, 60, .16);
      transition: background .25s, color .18s; font-variant-numeric: tabular-nums; }
    .lk-row::before { content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px; background: rgb(255, 176, 96);
      box-shadow: 0 0 8px rgba(255, 176, 96, .8); opacity: 0; transition: opacity .18s; }
    html .lk-sheet .lk-row.is-focused { outline: none; box-shadow: none;
      background: linear-gradient(90deg, rgba(255, 176, 96, .17) 0%, rgba(255, 176, 96, .06) 55%, rgba(255, 176, 96, 0) 100%); }
    .lk-row.is-focused::before { opacity: 1; }
    .lk-row .lk-v { color: rgba(236, 200, 150, .62); transition: color .18s, text-shadow .25s; }
    .lk-row.is-focused .lk-v { color: #ffd9a6; text-shadow: 0 0 10px rgba(255, 176, 96, .65); }
    .lk-row.is-focused .lk-k { color: #f3dcb6; }
    .lk-head { font: 600 11px/1 'Cinzel', 'Iowan Old Style', serif; letter-spacing: .3em; color: #c9a57c;
      padding-bottom: 8px; margin-bottom: 6px; background: linear-gradient(90deg, rgba(140, 80, 40, .85), rgba(140, 80, 40, .2) 80%, rgba(140, 80, 40, 0))
      bottom / 100% 1px no-repeat; }
    .lk-subhead { font: 600 9px/1 system-ui, -apple-system, sans-serif; letter-spacing: .26em; color: rgba(180, 130, 90, .6); margin: 14px 0 4px 14px; }
    /* An ember bar: a level that burns, the tip brightest. */
    .lk-ember { height: 6px; background: rgba(14, 8, 6, .85); border: 1px solid rgba(180, 140, 80, .25); transform: skewX(-12deg); overflow: hidden; }
    .lk-ember > i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #7a3510, #e07020 70%, #ffd27a);
      box-shadow: 0 0 6px rgba(255, 140, 50, .5); transition: width .3s ease; }
    .lk-row.is-focused .lk-ember { border-color: rgba(255, 170, 80, .55); }

    /* READING VIEW (kit/reading.ts): rows | the scorched slab that explains the chosen one. */
    /* Fills its frame: the rows scroll in their pane, the slab keeps the full
       height whatever it says, so choosing a row never resizes anything. */
    .lk-reading { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
      gap: 18px; align-items: stretch; flex: 1 1 auto; min-height: 0; padding: 2px 10px 8px 0; }
    .lk-fill { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
    .lk-reading-rows { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow-y: auto; padding-right: 4px; }
    .lk-reading-head { display: flex; justify-content: space-between; align-items: baseline; margin-top: 14px; text-transform: uppercase; }
    .lk-reading-head:first-child { margin-top: 0; }
    .lk-reading-count { font: 600 10px/1 system-ui, sans-serif; letter-spacing: .12em; color: rgba(170, 135, 100, .7); }
    .lk-reading-row { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; min-height: 44px; box-sizing: border-box;
      padding: 10px 12px 10px 16px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .lk-reading-row .lk-k { font: 19px/1.25 'EB Garamond', 'Iowan Old Style', serif; color: rgba(214, 186, 150, .78); min-width: 0; }
    .lk-reading-row .lk-v { font: 600 15px/1.2 'EB Garamond', 'Iowan Old Style', serif; letter-spacing: .02em; white-space: nowrap; }
    .lk-reading-row.faint .lk-k { font-style: italic; color: rgba(140, 115, 90, .5); }
    .lk-reading-row.chosen::before { opacity: 1; }
    .lk-reading-row.chosen { background: linear-gradient(90deg, rgba(255, 176, 96, .17) 0%, rgba(255, 176, 96, .06) 55%, rgba(255, 176, 96, 0) 100%); }
    .lk-reading-row.chosen .lk-v { color: #ffd9a6; text-shadow: 0 0 10px rgba(255, 176, 96, .65); }
    .lk-reading-row.chosen .lk-k { color: #f3dcb6; }
    .lk-reading-slab { padding: 18px 20px 20px; min-height: 0; overflow-y: auto; }
    .lk-rd-kind { font: 600 10px/1.2 system-ui, sans-serif; letter-spacing: .18em; text-transform: uppercase; color: rgba(200, 160, 110, .8); margin-bottom: 6px; }
    .lk-rd-title { font: 600 18px/1.2 'Cinzel', 'Iowan Old Style', serif; letter-spacing: .06em; text-transform: uppercase; color: #f3dcb6; }
    .lk-rd-rule { height: 1px; margin: 12px 0 14px; background: linear-gradient(90deg, rgba(140, 80, 40, .9), rgba(255, 150, 60, .6) 50%, rgba(140, 80, 40, 0)); }
    .lk-rd-text { font: italic 17px/1.45 'EB Garamond', 'Iowan Old Style', serif; color: #ead2b4; }
    .lk-rd-note { margin-top: 12px; font: 14px/1.4 'EB Garamond', 'Iowan Old Style', serif; color: rgba(190, 158, 122, .72); }
    @media (max-width: 560px) { .lk-reading { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); } .lk-reading-slab { order: -1; height: 150px; } }

    /* THE TORCH in a sheet (menu-shell.ts): a warm pool behind the content that
       travels to the chosen thing and breathes. Its centre is placed by
       transform; the margins centre the pool on that point. */
    .lk-torch { position: absolute; left: 0; top: 0; width: 420px; height: 240px; margin: -120px 0 0 -210px; z-index: 0;
      pointer-events: none; opacity: 0; border-radius: 50%;
      background: radial-gradient(closest-side, rgba(255, 168, 88, .17), rgba(255, 140, 60, .07) 55%, rgba(255, 140, 60, 0));
      transition: transform .38s cubic-bezier(.3, .7, .2, 1), opacity .3s; }
    .lk-torch::after { content: ''; position: absolute; inset: 22%; border-radius: 50%;
      background: radial-gradient(closest-side, rgba(255, 190, 110, .10), rgba(255, 190, 110, 0)); animation: lk-flicker 2.3s ease-in-out infinite; }
    @keyframes lk-flicker { 0%, 100% { opacity: .7; transform: scale(1); } 37% { opacity: 1; transform: scale(1.06); } 61% { opacity: .82; transform: scale(.97); } }
    @media (prefers-reduced-motion: reduce) { .lk-torch { transition: opacity .3s; } .lk-torch::after { animation: none; } }

    /* ── SATCHEL TILES (GEAR + RELIQUARY, the Lamplight draft blended with the
       game's art): square, dark, the art large; the rarity or domain colour is a
       quiet edge (--rc); what you wear carries a wax seal; the chosen one is lit. */
    .lk-tilegrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; align-content: start; }
    .lk-tile { --rc: 160, 130, 100; position: relative; aspect-ratio: 1; min-width: 0; display: grid; place-items: center; cursor: pointer;
      background: radial-gradient(80% 80% at 50% 40%, rgba(var(--rc), .10), rgba(12, 8, 5, .6) 70%), rgba(12, 8, 5, .55);
      border: 1px solid rgba(var(--rc), .38); border-radius: 2px; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
      transition: border-color .2s, box-shadow .2s, background .2s; }
    .lk-tile img { width: 78%; height: 78%; object-fit: contain; pointer-events: none; filter: drop-shadow(0 2px 3px rgba(0,0,0,.7)); }
    .lk-tile.empty { cursor: default; border-style: dashed; border-color: rgba(120, 90, 60, .25); background: rgba(12, 8, 5, .3); }
    .lk-tile.empty img, .lk-tile.empty svg { opacity: .35; }
    .lk-tile .lk-tile-tag { position: absolute; left: 0; right: 0; bottom: 3px; text-align: center; pointer-events: none;
      font: 600 8px/1 'Cinzel', 'Iowan Old Style', serif; letter-spacing: .16em; color: rgba(200, 165, 125, .7); text-shadow: 0 1px 2px #000; }
    .lk-tile .lk-tile-n { position: absolute; right: 4px; bottom: 3px; font: 700 10px/1 system-ui, sans-serif; color: #f0d8c0; text-shadow: 0 1px 2px #000; pointer-events: none; }
    .lk-tile .lk-tile-new { position: absolute; left: 3px; top: 3px; font: 700 8px/1 system-ui, sans-serif; letter-spacing: .08em; padding: 2px 4px;
      border-radius: 2px; background: rgba(255, 150, 70, .95); color: #1a0a04; pointer-events: none; }
    .lk-tile.worn::after { content: ''; position: absolute; right: -5px; top: -5px; width: 14px; height: 14px; border-radius: 50%; pointer-events: none;
      background: radial-gradient(circle at 35% 35%, #e05a44, #8c1f16 70%); box-shadow: 0 1px 3px rgba(0,0,0,.8); }
    .lk-tile.chosen, html:not([data-input="touch"]) .lk-sheet .lk-tile.is-focused { outline: none;
      border-color: rgba(255, 176, 96, .75); box-shadow: 0 0 14px rgba(255, 150, 60, .28), inset 0 0 18px rgba(255, 176, 96, .14); }
    .lk-domhead { display: flex; align-items: center; gap: 8px; margin: 14px 0 8px; padding-bottom: 6px;
      background: linear-gradient(90deg, rgba(var(--rc), .55), rgba(var(--rc), .12) 70%, rgba(var(--rc), 0)) bottom / 100% 1px no-repeat; }
    .lk-domhead:first-child { margin-top: 0; }
    .lk-domhead img { width: 20px; height: 20px; object-fit: contain; filter: drop-shadow(0 0 4px rgba(var(--rc), .6)); }
    .lk-domhead .nm { font: 600 12px/1 'Cinzel', 'Iowan Old Style', serif; letter-spacing: .22em; color: rgb(var(--rc)); }
    .lk-domhead .ct { margin-left: auto; font: 600 10px/1 system-ui, sans-serif; letter-spacing: .12em; color: rgba(170, 135, 100, .7); }

    /* ── The slab's contents (the draft's grammar) ── */
    .lk-d-kind { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font: 600 11px/1.3 system-ui, sans-serif; letter-spacing: .14em;
      text-transform: uppercase; color: #c9a882; }
    .lk-d-kind img { width: 15px; height: 15px; object-fit: contain; vertical-align: -3px; }
    .lk-d-kind .eq { margin-left: auto; color: #e0a860; letter-spacing: .16em; }
    .lk-d-head { display: flex; align-items: center; gap: 12px; }
    .lk-d-head img { width: 54px; height: 54px; object-fit: contain; flex-shrink: 0; filter: drop-shadow(0 0 6px rgba(0,0,0,.8)); }
    .lk-d-name { font: 600 20px/1.2 'Cinzel', 'Iowan Old Style', serif; letter-spacing: .03em; color: #ffd6a3; text-wrap: balance;
      text-shadow: 0 0 14px rgba(255, 168, 88, .3); }
    .lk-d-rule { position: relative; height: 9px; margin: 2px 0; flex-shrink: 0; }
    .lk-d-rule::before { content: ''; position: absolute; left: 0; right: 0; top: 4px; height: 1px;
      background: linear-gradient(90deg, rgba(120, 70, 35, 0), rgba(140, 80, 40, .85) 18%, rgba(140, 80, 40, .85) 82%, rgba(120, 70, 35, 0)); }
    .lk-d-rule::after { content: ''; position: absolute; left: 50%; top: 1px; width: 7px; height: 7px; margin-left: -3.5px; transform: rotate(45deg);
      background: radial-gradient(circle, #ffe2a0, #ff7a1a 55%, #5a1a05); box-shadow: 0 0 9px rgba(255, 120, 30, .9); }
    .lk-d-stats { display: flex; flex-wrap: wrap; gap: 4px 16px; font: 14px/1.4 system-ui, sans-serif; color: #f0dcc0; font-variant-numeric: tabular-nums; }
    .lk-d-stats b { font-weight: 600; color: #ffe2b8; margin-right: 4px; }
    .lk-d-stats b em { font-style: normal; color: #ffc882; font-weight: 600; margin-left: 2px; font-size: 12px; }
    .lk-d-stats i { font-style: normal; color: #a88c6c; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    .lk-d-fx { display: flex; flex-direction: column; gap: 4px; }
    .lk-d-fx > div { font: 14px/1.4 system-ui, sans-serif !important; color: #f0dcc0 !important; padding: 6px 10px; letter-spacing: .01em !important;
      background: rgba(255, 168, 88, .07); border-left: 2px solid rgba(255, 168, 88, .45); }
    .lk-d-fx > div.dim { background: none; border-left-color: transparent; padding: 1px 10px; color: #a88c6c !important; font-size: 12px !important; }
    .lk-d-act { align-self: flex-end; margin-top: auto; min-height: 44px; padding: 0 20px; display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
      font: 600 13px/1 'Cinzel', 'Iowan Old Style', serif; letter-spacing: .16em; color: #ffc88c; background: rgba(255, 150, 60, .08);
      border: 1px solid rgba(255, 150, 60, .6); border-radius: 2px; touch-action: manipulation; }
    .lk-d-act:hover, html:not([data-input="touch"]) .lk-sheet .lk-d-act.is-focused { background: rgb(52, 28, 13); box-shadow: 0 0 18px rgba(255, 140, 60, .25); outline: none; }
    .lk-d-act.inert { color: rgba(180, 150, 120, .55); border-color: rgba(140, 110, 80, .3); background: none; cursor: default; }
    .lk-d-note { font: italic 14px/1.4 'EB Garamond', 'Iowan Old Style', serif; color: rgba(190, 158, 122, .7); }
    /* The action never scrolls out of reach: it rides the slab's bottom edge. */
    .lk-d-act { position: sticky; bottom: 0; z-index: 2; box-shadow: 0 -10px 18px 6px rgba(12, 8, 5, .85); background-color: rgba(28, 16, 9, .96); }
    @media (max-height: 480px) {
      .lk-d-head img { width: 40px; height: 40px; }
      .lk-d-name { font-size: 16px; }
      .lk-d-stats { font-size: 13px; gap: 2px 12px; }
      .lk-d-act { min-height: 40px; }
    }

    /* WORLD TAGS: what hangs over a thing in the dungeon. No box: a name over a
       rule bearing the domain's mark (the depth title's grammar), on a feathered
       pool of dark so it reads over any floor, hung on a thread of light down to
       the thing itself. --tc is the thing's colour: its domain, or the stakes. */
    .lk-wtag {
      --tc: 200, 180, 150;
      display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px;
      padding: 8px 14px; border-radius: 18px;
      background: rgba(7, 5, 3, .84); box-shadow: 0 0 22px 16px rgba(7, 5, 3, .84);
      color: #ecd8bc; font: 13px/1.4 'EB Garamond', 'Iowan Old Style', serif;
    }
    .lk-wt-body { overflow: hidden; }
    .lk-wt-cut { -webkit-mask-image: linear-gradient(#000 calc(100% - 34px), transparent); mask-image: linear-gradient(#000 calc(100% - 34px), transparent); }
    .lk-wt-name { font: 600 13px/1.25 'Cinzel', 'Iowan Old Style', serif; letter-spacing: .14em; text-transform: uppercase;
      color: #f3dcb6; text-shadow: 0 0 8px rgba(0,0,0,.9), 0 0 14px rgba(var(--tc), .4); }
    .lk-wt-rule { width: 120px; max-width: 70%; height: 16px; display: flex; align-items: center; gap: 7px; }
    .lk-wt-rule::before, .lk-wt-rule::after { content: ''; flex: 1; height: 1px; background: rgba(var(--tc), .6); }
    .lk-wt-rule img { width: 16px; height: 16px; object-fit: contain; filter: drop-shadow(0 0 4px rgba(var(--tc), .8)); }
    .lk-wt-rule.plain { width: 70px; gap: 0; }
    .lk-wt-kind { font: 600 10px/1.2 system-ui, -apple-system, sans-serif; letter-spacing: .16em; text-transform: uppercase; color: rgba(var(--tc), .95); }
    .lk-wt-body { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: 4px; max-width: 300px; }
    .lk-wt-body > * { max-width: 100%; }

    /* The prompt: [button] icon VERB, the cost under it, and the thread. On
       touch the verb is the button, so it wears an edge. */
    .lk-wprompt { --tc: 255, 200, 140; display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .lk-wverb { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 12px;
      font: 600 11px/1 'Cinzel', 'Iowan Old Style', serif; letter-spacing: .22em; color: rgba(var(--tc), 1);
      background: rgba(7, 5, 3, .72); box-shadow: 0 0 14px 8px rgba(7, 5, 3, .6); border: 1px solid transparent;
      text-shadow: 0 1px 0 #000; }
    .lk-wverb svg { width: 18px; height: 18px; }
    html[data-input="touch"] .lk-wprompt:not(.sealed) .lk-wverb { border-color: rgba(var(--tc), .55); background: linear-gradient(rgba(var(--tc), .10), rgba(var(--tc), .10)), rgba(7, 5, 3, .72); }
    .lk-wprompt.sealed .lk-wverb { color: rgba(180, 160, 140, .75); }
    .lk-wcost { font: 700 11px/1 system-ui, -apple-system, sans-serif; letter-spacing: .04em; text-shadow: 0 1px 2px #000; }
    .lk-wthread { position: absolute; left: 50%; top: 100%; width: 1px; height: 0; pointer-events: none;
      background: linear-gradient(rgba(var(--tc), .75), rgba(var(--tc), .15)); }
    .lk-wthread::after { content: ''; position: absolute; left: -3px; bottom: -4px; width: 7px; height: 7px; transform: rotate(45deg);
      border: 1px solid rgba(var(--tc), .85); box-shadow: 0 0 6px rgba(var(--tc), .8); }
  `;
  document.head.appendChild(st);
  // The charred-edge filter the slab's border is drawn through.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = '<filter id="lk-char" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035 0.07" numOctaves="3" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G"/></filter>';
  document.body.appendChild(svg);
  // Tell CSS which hands are on the game: the focus torch hides for touch.
  const mark = (): void => { document.documentElement.dataset.input = activeDevice() ?? ''; };
  mark();
  onActiveDeviceChange(mark);
}
