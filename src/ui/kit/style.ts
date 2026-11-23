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
    .lk-offer:disabled .lk-offer-label { text-decoration: line-through rgba(160, 130, 100, .5); }
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
