// Death sequence overlay — the grimdark "she was forgotten" epitaph
// over a fading-to-black world. Per CLAUDE.md Tone Bible we DON'T use
// "YOU DIED" or "GAME OVER" — the epitaph fragments do the same work
// in a tone that fits the dungeon (terse, archaic, indifferent), and
// staying in that voice is what makes the death feel like the
// dungeon noticing rather than a state-machine flipping.
//
// Visual sequence:
//   Phase A   (death start → ~1.5s)  black underlay fades in to ~0.9
//                                    opacity. The world dims out from
//                                    around the player's collapsed
//                                    camera. The sword viewmodel
//                                    (attached to the camera) stays
//                                    visible as the player's "last
//                                    sight" — their own hand on the
//                                    floor.
//   Phase B   (~1.0s → 3.0s)         epitaph fades in, large serif,
//                                    slightly above centre, almost
//                                    parchment-coloured. Holds until
//                                    the end screen takes over.

const EPITAPHS = [
  'forgotten on depth 1.',
  'she was unmade in the first dark.',
  'the dungeon does not remember your name.',
  'a brief descent.',
  'unremarkable, even to the worms.',
  'her name was almost a song once.',
  'the dark does not bargain.',
  'she came down on her own legs. they will not return.',
  'another descent. another silence.',
];

let underlay: HTMLDivElement | null = null;
let epitaphEl: HTMLDivElement | null = null;

export function showDeathOverlay(): string | undefined {
  if (underlay || epitaphEl) return undefined;

  const epitaph = EPITAPHS[Math.floor(Math.random() * EPITAPHS.length)];

  // ── Black underlay — fades in to dim the world without going
  // FULLY black. Stops at 0.88 so the player can still half-see
  // their collapsed view (sword viewmodel, a bit of floor). This is
  // the "everything else is dark" beat.
  underlay = document.createElement('div');
  underlay.id = 'death-underlay';
  Object.assign(underlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'radial-gradient(ellipse at center, rgba(8, 4, 2, 0.75) 0%, rgba(0, 0, 0, 0.95) 70%)',
    pointerEvents: 'none',
    zIndex: '18',
    opacity: '0',
    transition: 'opacity 1.6s cubic-bezier(0.4, 0, 0.6, 1)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(underlay);

  // ── Epitaph — large serif, slightly above centre. Drops down a
  // touch as it fades in (parallax with the camera collapse). Long
  // shadow with a warm red bleed so it reads as ember-edged in the
  // black, not as a clean Helvetica statement.
  epitaphEl = document.createElement('div');
  epitaphEl.id = 'death-overlay';
  Object.assign(epitaphEl.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: '12%',           // a bit above centre
    pointerEvents: 'none',
    zIndex: '20',
    color: 'rgba(220, 195, 165, 0.92)',
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    fontStyle: 'italic',
    fontSize: 'clamp(28px, 5.6vw, 56px)',
    letterSpacing: '0.10em',
    textShadow: '0 0 14px rgba(0,0,0,1), 0 0 32px rgba(140, 30, 20, 0.55), 0 0 64px rgba(80, 10, 6, 0.4)',
    opacity: '0',
    transform: 'translateY(-12px)',
    transition: 'opacity 2.4s cubic-bezier(0.3, 0, 0.4, 1) 0.8s, transform 2.4s cubic-bezier(0.3, 0, 0.4, 1) 0.8s',
    textAlign: 'center',
    padding: '0 24px',
    maxWidth: '90vw',
    lineHeight: '1.3',
  } as Partial<CSSStyleDeclaration>);
  epitaphEl.textContent = epitaph;
  document.body.appendChild(epitaphEl);

  // Trigger transitions on the next frame so the initial values
  // commit before they animate.
  requestAnimationFrame(() => {
    if (underlay) underlay.style.opacity = '0.88';
    if (epitaphEl) {
      epitaphEl.style.opacity = '1';
      epitaphEl.style.transform = 'translateY(0)';
    }
  });

  return epitaph;
}
