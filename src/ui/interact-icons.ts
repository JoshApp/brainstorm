// Interact icon library. Inline SVG strings keyed by action kind. Maps
// the action label exposed by an Interactable ("TAKE" / "OPEN" / "READ" /
// "DRINK" / "DESCEND" / "SEALED") to an icon kind, then to its SVG.
//
// Single-stroke, currentColor-keyed so the SVGs inherit parent text color
// (one place to tune palette per state — armed / sealed / pressed).

export type InteractIconKind =
  | 'take'
  | 'open'
  | 'read'
  | 'drink'
  | 'descend'
  | 'sealed'
  | 'use';

/** Map a prompt label to an icon kind. Default 'use' for any unknown label. */
export function iconKindFromLabel(label: string): InteractIconKind {
  switch (label.toUpperCase()) {
    case 'TAKE':    return 'take';
    case 'OPEN':    return 'open';
    case 'READ':    return 'read';
    case 'DRINK':   return 'drink';
    case 'DESCEND': return 'descend';
    case 'SEALED':  return 'sealed';
    default:        return 'use';
  }
}

const COMMON = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const TAKE_SVG = `<svg ${COMMON}>
  <path d="M12 4v11"/>
  <path d="M7 10l5 5 5-5"/>
  <rect x="5" y="17" width="14" height="3" rx="0.5"/>
</svg>`;

const OPEN_SVG = `<svg ${COMMON}>
  <circle cx="8" cy="14" r="3"/>
  <path d="M11 14h10"/>
  <path d="M18 14v3"/>
  <path d="M21 14v4"/>
</svg>`;

const READ_SVG = `<svg ${COMMON}>
  <path d="M5 4v16h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/>
  <path d="M9 8h6"/>
  <path d="M9 12h6"/>
  <path d="M9 16h4"/>
</svg>`;

const DRINK_SVG = `<svg ${COMMON}>
  <path d="M6 4h12l-1 8a5 5 0 0 1-10 0L6 4z"/>
  <path d="M12 17v3"/>
  <path d="M8 20h8"/>
</svg>`;

const DESCEND_SVG = `<svg ${COMMON}>
  <path d="M3 5h5v5h5v5h5v5"/>
  <path d="M21 20l-3 0"/>
  <path d="M15 17v3"/>
</svg>`;

const SEALED_SVG = `<svg ${COMMON}>
  <rect x="5" y="11" width="14" height="10" rx="1.5"/>
  <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
  <circle cx="12" cy="16" r="1.2" fill="currentColor"/>
</svg>`;

const USE_SVG = `<svg ${COMMON}>
  <circle cx="12" cy="12" r="6"/>
  <circle cx="12" cy="12" r="2" fill="currentColor"/>
</svg>`;

const ICONS: Record<InteractIconKind, string> = {
  take: TAKE_SVG,
  open: OPEN_SVG,
  read: READ_SVG,
  drink: DRINK_SVG,
  descend: DESCEND_SVG,
  sealed: SEALED_SVG,
  use: USE_SVG,
};

export function iconSvg(kind: InteractIconKind): string {
  return ICONS[kind];
}
