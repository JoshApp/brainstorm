import { getStyle, cycleStyle, styleLabel } from '../style';

// Top-left "STYLE: PS1 ▸" cycle button. Lives in the broadcast register
// (sci-fi system label) rather than the dungeon's warm palette — because
// the style switcher itself is a meta-tool, not part of the world.

export function createStyleSwitcher() {
  const btn = document.createElement('button');
  btn.id = 'style-switcher';
  const refresh = () => {
    btn.textContent = `STYLE · ${styleLabel(getStyle())} ▸`;
  };
  refresh();

  Object.assign(btn.style, {
    position: 'fixed',
    top: 'calc(12px + env(safe-area-inset-top, 0px))',
    left: 'calc(12px + env(safe-area-inset-left, 0px))',
    background: 'rgba(20, 26, 48, 0.75)',
    border: '1px solid rgba(150, 200, 255, 0.4)',
    color: 'rgba(220, 235, 255, 0.9)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.18em',
    padding: '6px 10px',
    borderRadius: '3px',
    cursor: 'pointer',
    zIndex: '40',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    cycleStyle(); // triggers reload — no need to refresh label
  });

  document.body.appendChild(btn);
}
