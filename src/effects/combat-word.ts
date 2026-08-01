// COMBAT WORD — a single terse word punched near screen-centre at a decisive
// combat beat, so the moment READS as deliberate instead of an accident. In
// first person the clash is always right in front of the player, so a centred
// punch lands on it without any world→screen projection.
//
// Grimdark, terse, in-world (the Tone Bible register, not the broadcast wit):
//   parry / deflect  → "TURNED"   (you turned the blade)  — gold
//   poise-break      → "BROKEN"   (their guard broke)     — blood red
//
// One pooled DOM node, animated with the Web Animations API (self-cleaning, no
// per-frame tick). A newer word replaces an older one — the bigger beat wins.

let el: HTMLDivElement | null = null;

function ensureEl(): HTMLDivElement {
  if (el) return el;
  el = document.createElement('div');
  el.classList.add('game-hud');
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    top: '40%',
    transform: 'translate(-50%, -50%)',
    fontFamily: '"Cinzel", Georgia, "Times New Roman", serif',
    fontWeight: '700',
    fontSize: 'clamp(24px, 6vw, 46px)',
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    pointerEvents: 'none',
    zIndex: '18',
    opacity: '0',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    whiteSpace: 'nowrap',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  return el;
}

/** Punch a combat word near centre in the given CSS colour. */
export function flashCombatWord(text: string, color: string): void {
  const e = ensureEl();
  e.textContent = text;
  e.style.color = color;
  e.style.textShadow = `0 0 20px ${color}, 0 0 6px ${color}, 0 2px 5px rgba(0,0,0,0.92)`;
  // Snap in big → settle → hold → drift up + fade. Sharp attack sells the hit.
  e.animate(
    [
      { opacity: '0', transform: 'translate(-50%, -50%) scale(1.5)', offset: 0 },
      { opacity: '1', transform: 'translate(-50%, -50%) scale(1.0)', offset: 0.14 },
      { opacity: '1', transform: 'translate(-50%, -52%) scale(1.0)', offset: 0.55 },
      { opacity: '0', transform: 'translate(-50%, -66%) scale(1.05)', offset: 1 },
    ],
    { duration: 640, easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)', fill: 'forwards' },
  );
}

// Preset colours matching the combat feedback language.
export const CLASH_GOLD = 'rgba(255, 216, 150, 0.98)';   // a turned blade — struck steel
export const BREAK_RED = 'rgba(224, 78, 60, 0.98)';      // a broken guard — blood
