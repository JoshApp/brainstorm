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
