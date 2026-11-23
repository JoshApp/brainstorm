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
    .lk-reading { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 18px; align-items: start; }
    .lk-reading-rows { display: flex; flex-direction: column; min-width: 0; }
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
    .lk-reading-slab { position: sticky; top: 0; padding: 18px 20px 20px; min-height: 180px; }
    .lk-rd-kind { font: 600 10px/1.2 system-ui, sans-serif; letter-spacing: .18em; text-transform: uppercase; color: rgba(200, 160, 110, .8); margin-bottom: 6px; }
    .lk-rd-title { font: 600 18px/1.2 'Cinzel', 'Iowan Old Style', serif; letter-spacing: .06em; text-transform: uppercase; color: #f3dcb6; }
    .lk-rd-rule { height: 1px; margin: 12px 0 14px; background: linear-gradient(90deg, rgba(140, 80, 40, .9), rgba(255, 150, 60, .6) 50%, rgba(140, 80, 40, 0)); }
    .lk-rd-text { font: italic 17px/1.45 'EB Garamond', 'Iowan Old Style', serif; color: #ead2b4; }
    .lk-rd-note { margin-top: 12px; font: 14px/1.4 'EB Garamond', 'Iowan Old Style', serif; color: rgba(190, 158, 122, .72); }
    @media (max-width: 560px) { .lk-reading { grid-template-columns: 1fr; } .lk-reading-slab { position: static; order: -1; min-height: 0; } }

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
