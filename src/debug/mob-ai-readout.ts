import { DEV } from './dev';
import { FONT_UI } from '../ui/hud';
import type { Enemy } from '../mobs/enemy';

// DEV mob-AI readout — a live panel for the NEAREST engaged mob, built to
// diagnose facing jitter: it differentiates the body yaw each frame and reports
// the yaw RATE and, crucially, the DIRECTION-FLIPS PER SECOND. A smooth turn
// keeps one sign (0–1 flips/s); jitter rapidly reverses sign (high flips/s). The
// state + intent are shown alongside so we can read WHICH phase produces it.
//
// Enable with ?aidebug=1 (DEV only — the whole module DCE's out of prod builds).

let panel: HTMLDivElement | null = null;
let prevYaw = 0, prevDyaw = 0, prevNow = 0, haveYaw = false;
const flips: number[] = [];   // ms timestamps of recent yaw-direction reversals
let peakRate = 0, peakAt = 0;

/** Is the readout requested (?aidebug=1, or the AI lab)? DEV only. */
export function mobAiReadoutEnabled(): boolean {
  if (!DEV || typeof location === 'undefined') return false;
  const q = new URLSearchParams(location.search);
  return q.get('aidebug') === '1' || q.get('scenario') === 'ai-lab';
}

function ensurePanel(): HTMLDivElement {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'mob-ai-readout';
  Object.assign(panel.style, {
    position: 'fixed', left: '8px', top: '96px', zIndex: '40',
    font: `11px/1.45 ${FONT_UI}`, color: '#cfe', background: 'rgba(6,8,12,0.82)',
    border: '1px solid rgba(120,150,190,0.35)', borderRadius: '6px',
    padding: '7px 9px', pointerEvents: 'none', whiteSpace: 'pre', minWidth: '190px',
    textShadow: '0 0 3px rgba(0,0,0,0.9)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(panel);
  return panel;
}

const bar = (frac: number, n = 10): string => {
  const f = Math.max(0, Math.min(1, frac));
  const on = Math.round(f * n);
  return '▓'.repeat(on) + '░'.repeat(n - on);
};

/** Feed the nearest engaged mob each frame. Pass null to hide. `nowMs` =
 *  performance.now(); `distance` = m to the player. */
export function tickMobAiReadout(mob: Enemy | null, distance: number, nowMs: number): void {
  if (!DEV) return;
  const p = ensurePanel();
  if (!mob) { p.style.display = 'none'; haveYaw = false; flips.length = 0; peakRate = 0; return; }
  p.style.display = 'block';
  const d = mob.aiDebug();

  // Differentiate yaw → rate (deg/s) + count sign reversals (the jitter tell).
  let rateDegS = 0;
  if (haveYaw && nowMs > prevNow) {
    let dyaw = d.yaw - prevYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const dt = (nowMs - prevNow) / 1000;
    rateDegS = (Math.abs(dyaw) / dt) * (180 / Math.PI);
    // A reversal = this frame's turn sign opposes last frame's, both non-trivial.
    if (Math.abs(dyaw) > 0.004 && Math.abs(prevDyaw) > 0.004 && Math.sign(dyaw) !== Math.sign(prevDyaw)) {
      flips.push(nowMs);
    }
    prevDyaw = dyaw;
  }
  prevYaw = d.yaw; prevNow = nowMs; haveYaw = true;
  while (flips.length && nowMs - flips[0] > 1000) flips.shift();
  const flipsPerSec = flips.length;
  // Peak-hold the rate for ~0.8s so a momentary spike stays visible.
  if (rateDegS > peakRate || nowMs - peakAt > 800) { peakRate = rateDegS; peakAt = nowMs; }

  const jitterCol = flipsPerSec >= 6 ? '#ff5a5a' : flipsPerSec >= 3 ? '#ffcc55' : '#8fe08f';
  const yawDeg = ((d.yaw * 180 / Math.PI) % 360).toFixed(0);
  const tags = [
    d.feint ? 'FEINT' : '',
    d.broke ? 'BROKE' : '',
    d.release ? 'attack-ok' : 'held',
  ].filter(Boolean).join(' ');

  p.innerHTML =
    `<b style="color:#fff">${d.kind}</b>  ·  <b style="color:#9cf">${d.state}</b> / ${d.intent}·${d.moveMode}\n` +
    `dist ${distance.toFixed(1)}m   ${tags}\n` +
    `poise ${bar(d.poise)} ${(d.poise * 100).toFixed(0)}%\n` +
    `aggro ${d.aggression.toFixed(2)}  bold ${d.boldness.toFixed(2)} pat ${d.patience.toFixed(2)}\n` +
    `decision in ${Math.max(0, d.decisionIn).toFixed(2)}s${d.cower > 0 ? `   cower ${d.cower.toFixed(1)}s` : ''}\n` +
    `yaw ${yawDeg}°   rate ${peakRate.toFixed(0)}°/s\n` +
    `<span style="color:${jitterCol}">JITTER  ${flipsPerSec} flips/s ${bar(flipsPerSec / 10)}</span>`;
}
