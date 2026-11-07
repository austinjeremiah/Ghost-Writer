'use client';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

let registered = false;

if (typeof window !== 'undefined' && !registered) {
  gsap.registerPlugin(ScrollTrigger);
  registered = true;
}

let scrollerEl: HTMLElement | null = null;

/**
 * Points every ScrollTrigger at `#scroll-container` instead of the window,
 * because the page scrolls inside that element (see `SmoothScroll`).
 */
export function setScroller(el: HTMLElement | null) {
  scrollerEl = el;
  if (el) ScrollTrigger.defaults({ scroller: el });
  ScrollTrigger.refresh();
}

export function getScroller(): HTMLElement | Window {
  return scrollerEl ?? (typeof window !== 'undefined' ? window : (undefined as never));
}

export { gsap, ScrollTrigger };
