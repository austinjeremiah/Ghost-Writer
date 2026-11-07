/**
 * Mirrors the template's `winSizes` helper: it writes the real viewport metrics
 * onto <body> as the custom properties the stylesheet reads (`--vh`, `--vw`,
 * `--oprientation`), because `100vh` is unreliable on mobile browsers.
 */
export function applyViewportVars() {
  if (typeof window === 'undefined') return;

  const vh = window.innerHeight;
  const vw = document.documentElement.clientWidth;
  const orientation = vw > vh ? 'landscape' : 'portrait';

  document.body.style.setProperty('--vh', `${vh}px`);
  document.body.style.setProperty('--vw', `${vw}px`);
  document.body.style.setProperty('--oprientation', orientation);
}

export function watchViewportVars() {
  if (typeof window === 'undefined') return () => {};

  applyViewportVars();
  window.addEventListener('resize', applyViewportVars);
  window.addEventListener('orientationchange', applyViewportVars);

  return () => {
    window.removeEventListener('resize', applyViewportVars);
    window.removeEventListener('orientationchange', applyViewportVars);
  };
}
