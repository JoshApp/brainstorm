// DEV-only instrumentation to pin the live interact UNDER-capture: a real run
// recorded 1 interact for ~3 descents, but the recorder + replay are proven
// sound, so the gap is live taps not reaching triggerInteract. This counts,
// per run: every triggerInteract (by which input path + whether a screen gated
// it), every actual DESCENT (the depth bump in loader.ts), and every interact
// the recorder captured. A mismatch (descents > triggers) means a descent used
// an UNWIRED input path; (triggers > recorded) means a recorder timing drop.
//
// Fully inert in production: every entry point early-returns on !DEV, and all
// call sites are behind `if (DEV)` so the whole thing dead-code-eliminates.
// Readout: console on each event + a summary on death, AND an on-screen box on
// death (so it's legible on a phone, where the console isn't).

import { DEV } from './dev';

interface Counts {
  triggers: { tap: number; ekey: number; label: number; other: number };
  gated: number;      // triggerInteract calls a screen swallowed
  descents: number;   // real floor-down events (loader depth bump)
  recorded: number;   // interacts the recorder actually captured
}

function blank(): Counts {
  return { triggers: { tap: 0, ekey: 0, label: 0, other: 0 }, gated: 0, descents: 0, recorded: 0 };
}

let c: Counts = blank();

export function resetInteractTrace(): void {
  if (!DEV) return;
  c = blank();
}

export function traceTrigger(source: string | undefined, fired: boolean): void {
  if (!DEV) return;
  const key = (source === 'tap' || source === 'ekey' || source === 'label') ? source : 'other';
  if (fired) c.triggers[key] += 1;
  else c.gated += 1;
  console.log(`[interact-trace] trigger via ${source ?? '?'} (fired=${fired})`);
}

export function traceDescent(toDepth: number): void {
  if (!DEV) return;
  c.descents += 1;
  console.log(`[interact-trace] DESCENT → depth ${toDepth}  (descents=${c.descents})`);
}

export function traceRecorded(): void {
  if (!DEV) return;
  c.recorded += 1;
}

function summaryLines(): string[] {
  const t = c.triggers;
  const totalTrig = t.tap + t.ekey + t.label + t.other;
  const lines = [
    `descents (floor-down): ${c.descents}`,
    `triggerInteract fired: ${totalTrig}  (tap:${t.tap} ekey:${t.ekey} label:${t.label} other:${t.other})`,
    `triggerInteract gated: ${c.gated}  (swallowed by an open screen)`,
    `interacts recorded:    ${c.recorded}`,
  ];
  if (c.descents > totalTrig) {
    lines.push(`>>> ${c.descents - totalTrig} descent(s) fired NO triggerInteract → an UNWIRED descent path`);
  } else if (totalTrig > c.recorded) {
    lines.push(`>>> ${totalTrig - c.recorded} trigger(s) NOT recorded → a recorder timing drop`);
  } else {
    lines.push(`>>> descents == triggers == recorded — interact capture is intact this run`);
  }
  return lines;
}

/** Log the run summary + show an on-screen box (phone-legible). Call on death. */
export function dumpInteractTrace(): void {
  if (!DEV) return;
  const lines = summaryLines();
  console.log('[interact-trace] RUN SUMMARY\n  ' + lines.join('\n  '));
  showOverlay(lines);
  resetInteractTrace();
}

function showOverlay(lines: string[]): void {
  try {
    const id = 'interact-trace-overlay';
    document.getElementById(id)?.remove();
    const box = document.createElement('div');
    box.id = id;
    Object.assign(box.style, {
      position: 'fixed', left: '8px', bottom: '8px', zIndex: '99999',
      maxWidth: '90vw', padding: '8px 10px', background: 'rgba(10,8,6,0.92)',
      border: '1px solid rgba(220,150,80,0.6)', borderRadius: '4px',
      color: 'rgba(230,200,160,0.95)', font: '11px/1.45 monospace',
      whiteSpace: 'pre', pointerEvents: 'auto',
    } as Partial<CSSStyleDeclaration>);
    box.textContent = 'INTERACT TRACE (dev)\n' + lines.join('\n');
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  } catch { /* no DOM */ }
}

if (DEV) {
  (window as unknown as { __interactTrace?: () => void }).__interactTrace = () => {
    console.log('[interact-trace]\n  ' + summaryLines().join('\n  '));
  };
}
