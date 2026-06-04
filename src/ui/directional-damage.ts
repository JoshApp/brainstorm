import type { EntityId } from '../ecs/types';
import { getActiveLevel } from '../level/loader';
import { getCameraYaw, getCameraGroundPos } from '../controls/camera';

// Directional damage indicator — a red bloom that flares at the SCREEN EDGE
// in the direction the hit came from, relative to where the player is looking.
// Hit from the front → glow at the top; from behind → bottom; from the right
// → right edge. Turns "I took damage" into "the threat is THERE", which reads
// as scarier and tells you which way to turn. Pairs with the full-screen
// vignette flash (this is the *directional* layer on top). Pure DOM + CSS
// radial gradient, self-fading — no per-frame tick.

let el: HTMLDivElement | null = null;
function ensure() {
  if (el) return;
  el = document.createElement('div');
  el.id = 'directional-damage';
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '9',
    opacity: '0',
    transition: 'opacity 0.5s ease-out',
    willChange: 'opacity',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
}

/** Flare the indicator toward `source`'s position. No-op for environmental
 *  damage (null source) or an attacker we can't locate. `amount` scales the
 *  bloom intensity so a heavy hit screams louder than a graze. */
export function flashDirectionalDamage(source: EntityId | null, amount = 1) {
  if (source == null) return;
  const lvl = getActiveLevel();
  if (!lvl) return;
  const enemy = lvl.enemies.find((e) => e.entityId === source);
  if (!enemy) return;

  const p = getCameraGroundPos();
  const ax = enemy.position.x - p.x;
  const az = enemy.position.z - p.z;
  if (ax === 0 && az === 0) return;

  // Project the attacker offset onto the camera's forward / right axes to get
  // a screen-relative bearing: 0 = dead ahead, +π/2 = right, ±π = behind.
  const yaw = getCameraYaw();
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const fwd = ax * fx + az * fz;
  const right = ax * rx + az * rz;
  const a = Math.atan2(right, fwd);

  // Map the bearing to a point on the screen edge for the gradient centre.
  const cx = 50 + 45 * Math.sin(a);
  const cy = 50 - 40 * Math.cos(a);
  const intensity = Math.min(0.85, 0.42 + Math.max(0, amount - 1) * 0.18);

  ensure();
  if (!el) return;
  el.style.background =
    `radial-gradient(ellipse 65% 65% at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, ` +
    `rgba(210,25,25,${intensity.toFixed(2)}) 0%, ` +
    `rgba(150,0,0,${(intensity * 0.45).toFixed(2)}) 38%, transparent 72%)`;
  el.style.transition = 'none';
  el.style.opacity = '1';
  void el.offsetWidth;   // reflow so the fade restarts from full
  el.style.transition = 'opacity 0.5s ease-out';
  el.style.opacity = '0';
}
