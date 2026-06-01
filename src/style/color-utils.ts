// Shared hex-colour helpers. Three.js + our content store colours as packed
// 0xRRGGBB ints; the UI needs CSS strings and the decorators need to lighten /
// darken those ints. This was copy-pasted in five places (item-format,
// stash-screen, consumable-bar, decorate); it lives here now.

export interface Rgb { r: number; g: number; b: number; }

/** 0xff7722 → { r: 255, g: 119, b: 34 }. */
export function hexRgb(hex: number): Rgb {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

/** 0xff7722 → "rgb(255, 119, 34)" — for inline CSS color strings. */
export function hexCss(hex: number): string {
  const { r, g, b } = hexRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

/** 0xff7722 + 0.5 → "rgba(255, 119, 34, 0.50)". */
export function hexRgba(hex: number, alpha: number): string {
  const { r, g, b } = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

/** Lerp each channel toward white by t (0 = unchanged, 1 = white). */
export function brighten(hex: number, t: number): number {
  const { r, g, b } = hexRgb(hex);
  const lift = (c: number) => Math.round(Math.min(255, c + (255 - c) * t));
  return (lift(r) << 16) | (lift(g) << 8) | lift(b);
}

/** Scale each channel toward black by t (0 = unchanged, 1 = black). */
export function darken(hex: number, t: number): number {
  const { r, g, b } = hexRgb(hex);
  const cut = (c: number) => Math.round(c * (1 - t));
  return (cut(r) << 16) | (cut(g) << 8) | cut(b);
}
