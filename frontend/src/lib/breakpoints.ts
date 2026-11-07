export const BREAKPOINT_DESKTOP = 1060;
export const BREAKPOINT_TABLET = 768;
export const BREAKPOINT_MOBILE = 460;

export function isDesktop() {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= BREAKPOINT_DESKTOP;
}
