'use client';

import { useEffect, useRef, type RefObject } from 'react';

import {
  cardsScale,
  horizontalScroll,
  reveal,
  sectionScale,
  stickyScroller,
  type RevealOptions,
} from './animations';

/**
 * Runs an effect once the element is mounted, handing it the DOM node and
 * expecting a cleanup function back.
 */
function useElementEffect<T extends HTMLElement>(
  setup: (el: T) => () => void,
  deps: unknown[] = [],
): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return setup(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

/** Reveals every `data-a-*` descendant when the element scrolls into view. */
export function useReveal<T extends HTMLElement>(options: RevealOptions = {}) {
  const { threshold, delay, immediate, repeat } = options;
  return useElementEffect<T>(
    (el) => reveal(el, { threshold, delay, immediate, repeat }),
    [threshold, delay, immediate, repeat],
  );
}

/** `[data-section-scale]` — scales the section up as it arrives. */
export function useSectionScale<T extends HTMLElement>() {
  return useElementEffect<T>((el) => sectionScale(el));
}

/** `[data-section-sticky]` — pins the panel while its column scrolls. */
export function useStickyScroller<T extends HTMLElement>() {
  return useElementEffect<T>((el) => stickyScroller(el));
}

/** `.wrapper > .scroller > .scroller-el` — vertical scroll drives sideways motion. */
export function useHorizontalScroll<T extends HTMLElement>(direction: 1 | -1 = 1) {
  return useElementEffect<T>((el) => horizontalScroll(el, { direction }), [direction]);
}

/** `[data-cards-scale]` — the staggered benefits stack. */
export function useCardsScale<T extends HTMLElement>() {
  return useElementEffect<T>((el) => cardsScale(el));
}
