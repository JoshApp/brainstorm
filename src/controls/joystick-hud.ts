// Visible floating joystick HUD. Appears under the thumb when the player
// touches the left half of the screen, follows the finger, hides on release.
// Pure DOM overlay — sits above the canvas via z-index. Pointer-events disabled
// so touches still reach the canvas for the input layer to process.

let base: HTMLDivElement | null = null;
let knob: HTMLDivElement | null = null;

function ensureElements() {
  if (base && knob) return;

  // Subtle look — both ring and knob carry low alpha + thin strokes.
  // Earlier iteration was thicker / brighter; visible under the thumb
  // but distracting in the corner of the eye. Phone players don't need
  // the joystick to ANNOUNCE itself; they need just enough to confirm
  // their touch landed and how far it's drifted.
  base = document.createElement('div');
  base.id = 'joystick-base';
  Object.assign(base.style, {
    position: 'fixed',
    width: '160px',
    height: '160px',
    border: '1px solid rgba(255, 200, 140, 0.18)',
    borderRadius: '50%',
    pointerEvents: 'none',
    display: 'none',
    transform: 'translate(-50%, -50%)',
    zIndex: '10',
  });

  knob = document.createElement('div');
  knob.id = 'joystick-knob';
  Object.assign(knob.style, {
    position: 'fixed',
    width: '36px',
    height: '36px',
    background: 'rgba(255, 200, 140, 0.18)',
    border: '1px solid rgba(255, 200, 140, 0.45)',
    borderRadius: '50%',
    pointerEvents: 'none',
    display: 'none',
    transform: 'translate(-50%, -50%)',
    zIndex: '11',
  });

  document.body.appendChild(base);
  document.body.appendChild(knob);
}

export function showJoystick(x: number, y: number) {
  ensureElements();
  base!.style.left = `${x}px`;
  base!.style.top = `${y}px`;
  base!.style.display = 'block';
  knob!.style.left = `${x}px`;
  knob!.style.top = `${y}px`;
  knob!.style.display = 'block';
}

export function moveJoystickKnob(
  centerX: number,
  centerY: number,
  dx: number,
  dy: number,
  radius: number,
) {
  if (!knob) return;
  const mag = Math.hypot(dx, dy);
  let kx = dx;
  let ky = dy;
  if (mag > radius) {
    kx = (dx / mag) * radius;
    ky = (dy / mag) * radius;
  }
  knob.style.left = `${centerX + kx}px`;
  knob.style.top = `${centerY + ky}px`;
}

export function hideJoystick() {
  if (base) base.style.display = 'none';
  if (knob) knob.style.display = 'none';
}
