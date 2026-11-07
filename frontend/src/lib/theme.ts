'use client';

/**
 * Reads the theme tokens declared on `:root` in `src/styles/globals.css`.
 *
 * Canvas has no access to CSS custom properties, so anything painted into a
 * `<canvas>` has to look them up. Going through the tokens — rather than
 * repeating the hex — keeps the drawing code in step with the stylesheet.
 */

export interface ThemeColors {
  /** `--bg`: the ground everything sits on. */
  bg: string;
  /** `--fg`: type, rules and icons. */
  fg: string;
}

const FALLBACK: ThemeColors = { bg: '#fef1d0', fg: '#0042af' };

export function readThemeColors(): ThemeColors {
  if (typeof window === 'undefined') return FALLBACK;

  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;

  return {
    bg: read('--bg', FALLBACK.bg),
    fg: read('--fg', FALLBACK.fg),
  };
}

/** `#rrggbb` → `r, g, b`, for building `rgb(... / alpha)` strings on a canvas. */
export function toRgbChannels(color: string): string {
  const hex = color.replace('#', '').trim();

  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r, g, b] = Array.from(hex, (c) => parseInt(c + c, 16));
    return `${r}, ${g}, ${b}`;
  }

  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const n = parseInt(hex, 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }

  // Already a functional notation (rgb()/oklch()/…) — hand it back untouched.
  return color;
}
