// Kit styles shared by every Lamplight screen: carved keycaps for prompts.
// Injected once; plain CSS so a screen only adds classes.

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
  `;
  document.head.appendChild(st);
}
