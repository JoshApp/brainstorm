// Fatal-error overlay. When the game loop throws, the player would otherwise see
// a frozen or black screen and just leave. Instead this shows an in-character
// "something broke" screen with a one-tap REPORT (bundles the auto-captured
// diagnostic — build, error, breadcrumbs, and the deterministic repro tape — and
// either sends it or copies it to paste to the others) and a way to start over.
//
// Plain DOM, no game deps beyond the telemetry sender + the community link, so it
// can render even when much of the game has fallen over.

import { sendReport } from '../telemetry/telemetry';
import { hasCommunityLink, openCommunityLink } from '../links';

let shown = false;

/** Show the fatal overlay once. `report` is the full diagnostic from
 *  telemetry.buildReport (with the repro tape attached); `errorMessage` is the
 *  short line surfaced for the player's own note. */
export function showCrashOverlay(report: Record<string, unknown>, errorMessage?: string): void {
  if (shown) return;
  shown = true;

  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99999', // above everything — the game is down
    background: 'linear-gradient(180deg, rgba(0,0,0,0.96) 0%, rgba(12, 3, 2, 0.98) 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    padding: '24px',
    textAlign: 'center',
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    color: 'rgba(220, 180, 140, 0.9)',
  } as Partial<CSSStyleDeclaration>);

  const head = document.createElement('div');
  head.textContent = 'the dark swallowed something';
  Object.assign(head.style, {
    fontSize: 'clamp(18px, 4.5vw, 26px)',
    fontStyle: 'italic',
    letterSpacing: '0.08em',
    textShadow: '0 0 18px rgba(140, 30, 20, 0.45)',
    color: 'rgba(230, 190, 150, 0.92)',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(head);

  const sub = document.createElement('div');
  sub.textContent = 'a fault, not your death. tell the deep what you saw and it will be mended.';
  Object.assign(sub.style, {
    fontSize: '13px',
    color: 'rgba(180, 150, 120, 0.7)',
    maxWidth: '440px',
    lineHeight: '1.5',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(sub);

  // Optional note from the player — the human half of the report.
  const note = document.createElement('textarea');
  note.placeholder = errorMessage ? `what were you doing? (${errorMessage})` : 'what were you doing when it broke?';
  Object.assign(note.style, {
    width: 'min(440px, 90vw)',
    height: '64px',
    marginTop: '4px',
    padding: '10px 12px',
    background: 'rgba(20, 12, 8, 0.7)',
    border: '1px solid rgba(150, 110, 70, 0.4)',
    borderRadius: '8px',
    color: 'rgba(230, 200, 170, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    resize: 'none',
    outline: 'none',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(note);

  const status = document.createElement('div');
  Object.assign(status.style, {
    fontSize: '12px',
    minHeight: '16px',
    letterSpacing: '0.1em',
    color: 'rgba(200, 160, 110, 0.75)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(status);

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '4px' } as Partial<CSSStyleDeclaration>);

  const reportBtn = makeButton('SEND REPORT', true);
  reportBtn.addEventListener('pointerdown', async (e) => {
    e.preventDefault();
    reportBtn.disabled = true;
    status.textContent = 'reaching the deep…';
    const n = note.value.trim();
    if (n) (report as Record<string, unknown>).note = n;
    const result = await sendReport(report);
    status.textContent =
      result === 'sent' ? 'the report reached us. thank you.'
      : result === 'copied' ? (hasCommunityLink() ? 'copied — paste it in the deep below.' : 'copied to your clipboard. thank you.')
      : 'could not capture it — describe it to the others instead.';
    if (result === 'copied' && hasCommunityLink()) joinBtn.style.display = '';
  });
  row.appendChild(reportBtn);

  const riseBtn = makeButton('DESCEND AGAIN', false);
  riseBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); window.location.reload(); });
  row.appendChild(riseBtn);
  root.appendChild(row);

  // Community link — hidden until a report is copied (so the player has something
  // to paste), or always available if they'd rather just go tell someone.
  const joinBtn = makeButton('JOIN THE DEEP', false);
  joinBtn.style.display = hasCommunityLink() ? '' : 'none';
  joinBtn.style.marginTop = '6px';
  joinBtn.style.opacity = '0.7';
  joinBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); openCommunityLink(); });
  if (hasCommunityLink()) root.appendChild(joinBtn);

  document.body.appendChild(root);
}

function makeButton(label: string, primary: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    padding: '11px 26px',
    minHeight: '44px',
    borderRadius: '30px',
    border: primary ? '1px solid rgba(255, 190, 120, 0.55)' : '1px solid rgba(150, 110, 70, 0.4)',
    background: primary
      ? 'linear-gradient(180deg, rgba(80, 42, 22, 0.85), rgba(50, 24, 10, 0.85))'
      : 'transparent',
    color: primary ? 'rgba(255, 230, 200, 0.98)' : 'rgba(200, 165, 130, 0.8)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    fontWeight: '600',
    letterSpacing: '0.22em',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  } as Partial<CSSStyleDeclaration>);
  return b;
}
