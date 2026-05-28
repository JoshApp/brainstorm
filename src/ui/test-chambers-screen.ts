import { openScreen, closeScreen } from './screen-manager';
import { TEST_CHAMBERS } from '../level/test-chambers';

// Test chambers picker — opened from the title screen via the TEST
// link. Lists every chamber as a card; tapping a card invokes the
// supplied onPick callback with the chamber id, which main.ts uses
// to load the chamber into a fresh test run.

const SCREEN_ID = 'test-chambers';

let root: HTMLDivElement | null = null;

export function showTestChambersScreen(
  onPick: (chamberId: string) => void,
  onBack?: () => void,
) {
  if (root) return;

  root = document.createElement('div');
  root.id = 'test-chambers-screen';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    background: 'radial-gradient(ellipse at center, rgba(28, 18, 10, 1) 0%, rgba(6, 4, 2, 1) 70%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '20px',
    padding: '40px',
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    color: 'rgba(220, 180, 140, 0.9)',
    pointerEvents: 'auto',
    overflowY: 'auto',
  } as Partial<CSSStyleDeclaration>);

  const title = document.createElement('div');
  title.textContent = 'TEST CHAMBERS';
  Object.assign(title.style, {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    letterSpacing: '0.35em',
    color: 'rgba(220, 180, 140, 0.7)',
    marginBottom: '8px',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'isolated rooms — for testing one thing at a time';
  Object.assign(subtitle.style, {
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    fontStyle: 'italic',
    fontSize: '14px',
    color: 'rgba(180, 140, 110, 0.55)',
    marginBottom: '16px',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(subtitle);

  const list = document.createElement('div');
  Object.assign(list.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxWidth: '420px',
    width: '100%',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(list);

  for (const chamber of TEST_CHAMBERS) {
    const card = document.createElement('div');
    Object.assign(card.style, {
      border: '1px solid rgba(180, 140, 110, 0.3)',
      borderRadius: '6px',
      padding: '14px 18px',
      cursor: 'pointer',
      background: 'rgba(20, 14, 10, 0.7)',
      transition: 'background 0.15s, border-color 0.15s',
    } as Partial<CSSStyleDeclaration>);
    const name = document.createElement('div');
    name.textContent = chamber.name;
    Object.assign(name.style, {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      letterSpacing: '0.25em',
      color: 'rgba(220, 180, 140, 0.95)',
      marginBottom: '4px',
    } as Partial<CSSStyleDeclaration>);
    const desc = document.createElement('div');
    desc.textContent = chamber.description;
    Object.assign(desc.style, {
      fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
      fontStyle: 'italic',
      fontSize: '14px',
      color: 'rgba(180, 140, 110, 0.7)',
      lineHeight: '1.35',
    } as Partial<CSSStyleDeclaration>);
    card.appendChild(name);
    card.appendChild(desc);
    card.addEventListener('pointerenter', () => {
      card.style.background = 'rgba(40, 24, 14, 0.85)';
      card.style.borderColor = 'rgba(220, 180, 140, 0.6)';
    });
    card.addEventListener('pointerleave', () => {
      card.style.background = 'rgba(20, 14, 10, 0.7)';
      card.style.borderColor = 'rgba(180, 140, 110, 0.3)';
    });
    card.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hide();
      onPick(chamber.id);
    });
    list.appendChild(card);
  }

  // BACK link.
  const back = document.createElement('div');
  back.textContent = '← BACK';
  Object.assign(back.style, {
    marginTop: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    letterSpacing: '0.28em',
    color: 'rgba(180, 140, 110, 0.6)',
    cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  back.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hide();
    onBack?.();
  });
  root.appendChild(back);

  document.body.appendChild(root);
  openScreen({
    id: SCREEN_ID,
    root,
    policy: { pausesWorld: true, hidesHud: true, dimsScene: false, layer: 'title' },
  });
}

function hide() {
  if (!root) return;
  root.remove();
  root = null;
  closeScreen(SCREEN_ID);
}
