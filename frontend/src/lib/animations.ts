'use client';

import { gsap, ScrollTrigger } from './gsap';
import { splitText } from './split-text';

/**
 * Reveal engine for the `data-a-*` attributes the stylesheet pre-styles:
 *
 *   data-a-h         heading  — split to chars, each rises + un-squashes
 *   data-a-p         body     — split to lines, each line rises behind a mask
 *   data-a-t         text     — rises behind its `data-a-twrapper` mask
 *   data-a-l         rule     — scales in from the left
 *   data-a-o         anything — plain fade
 *
 * `data-in-view="0.4"` on an ancestor section means "start when the section is
 * 40% into the viewport"; that is the number this module turns into a
 * ScrollTrigger start position.
 */

export const EASE = 'power3.out';

export interface RevealOptions {
  /** Fraction of the viewport the trigger must cross first (`data-in-view`). */
  threshold?: number;
  /** Delay before the first tween, in seconds. */
  delay?: number;
  /** Run immediately instead of waiting for a scroll trigger. */
  immediate?: boolean;
  /** Replay every time the element re-enters the viewport. */
  repeat?: boolean;
}

function startFor(threshold: number) {
  const pct = Math.round((1 - threshold) * 100);
  return `top ${pct}%`;
}

/** Builds (but does not start) the reveal timeline for one subtree. */
export function buildRevealTimeline(root: HTMLElement, delay = 0): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true, delay });

  const headings = root.querySelectorAll<HTMLElement>('[data-a-h]');
  const paragraphs = root.querySelectorAll<HTMLElement>('[data-a-p]');
  const texts = root.querySelectorAll<HTMLElement>('[data-a-t]');
  const lines = root.querySelectorAll<HTMLElement>('[data-a-l]');
  const fades = root.querySelectorAll<HTMLElement>('[data-a-o]');

  headings.forEach((heading) => {
    const { chars } = splitText(heading, 'chars');

    // `[data-a-h]` keeps the host at opacity 0 until its characters are staged.
    tl.set(heading, { opacity: 1 }, 0);

    if (chars.length) {
      tl.to(
        chars,
        {
          y: 0,
          scaleY: 1,
          opacity: 1,
          duration: 1,
          ease: EASE,
          stagger: 0.012,
        },
        0,
      );
    } else {
      tl.to(heading, { opacity: 1, duration: 0.8, ease: EASE }, 0);
    }
  });

  paragraphs.forEach((paragraph) => {
    const { lines: splitLines } = splitText(paragraph, 'lines');
    const inners = splitLines
      .map((line) => line.querySelector<HTMLElement>('.line-inner'))
      .filter((el): el is HTMLElement => Boolean(el));

    tl.set(paragraph, { opacity: 1 }, 0);

    if (inners.length) {
      tl.to(
        inners,
        {
          y: 0,
          opacity: 1,
          duration: 1,
          ease: EASE,
          stagger: 0.08,
        },
        0.1,
      );
    } else {
      tl.to(paragraph, { opacity: 1, duration: 0.8, ease: EASE }, 0.1);
    }
  });

  if (texts.length) {
    tl.to(
      texts,
      { y: 0, opacity: 1, duration: 1, ease: EASE, stagger: 0.06 },
      0.15,
    );
  }

  if (lines.length) {
    tl.to(
      lines,
      { scaleX: 1, duration: 1.1, ease: 'power2.inOut', stagger: 0.08 },
      0,
    );
  }

  if (fades.length) {
    tl.to(fades, { opacity: 1, duration: 1, ease: 'none', stagger: 0.08 }, 0.2);
  }

  return tl;
}

/**
 * Attaches a reveal to `root`. Returns a cleanup function.
 */
export function reveal(root: HTMLElement | null, options: RevealOptions = {}) {
  if (!root) return () => {};

  const attr = root.getAttribute('data-in-view');
  const threshold = options.threshold ?? (attr ? Number(attr) || 0.3 : 0.3);

  const tl = buildRevealTimeline(root, options.delay ?? 0);

  if (options.immediate) {
    tl.play();
    return () => tl.kill();
  }

  const trigger = ScrollTrigger.create({
    trigger: root,
    start: startFor(threshold),
    once: !options.repeat,
    onEnter: () => tl.play(),
    onLeaveBack: options.repeat ? () => tl.pause(0) : undefined,
  });

  return () => {
    trigger.kill();
    tl.kill();
  };
}

/** `[data-section-scale]`: 0.88 → 1 as the section scrolls into place. */
export function sectionScale(el: HTMLElement | null) {
  if (!el || window.innerWidth < 1060) return () => {};

  const tween = gsap.fromTo(
    el,
    { scale: 0.88 },
    {
      scale: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: el,
        start: 'top bottom',
        end: 'top top',
        scrub: true,
      },
    },
  );

  return () => {
    tween.scrollTrigger?.kill();
    tween.kill();
  };
}

/**
 * `[data-section-sticky]` + `[data-section-sticky-scroller]`: the sticky panel
 * holds while its inner column is scrolled past it.
 */
export function stickyScroller(wrapper: HTMLElement | null) {
  if (!wrapper || window.innerWidth < 1060) return () => {};

  const sticky = wrapper.querySelector<HTMLElement>('[data-section-sticky]');
  const scroller = wrapper.querySelector<HTMLElement>('[data-section-sticky-scroller]');
  if (!sticky || !scroller) return () => {};

  const resize = () => {
    const overflow = Math.max(0, scroller.scrollHeight - sticky.clientHeight);
    wrapper.style.height = `${sticky.clientHeight + overflow}px`;
    return overflow;
  };

  let overflow = resize();

  const tween = gsap.to(scroller, {
    y: () => -overflow,
    ease: 'none',
    scrollTrigger: {
      trigger: wrapper,
      start: 'top top',
      end: () => `+=${overflow}`,
      scrub: true,
      invalidateOnRefresh: true,
      onRefresh: () => {
        overflow = resize();
      },
    },
  });

  return () => {
    tween.scrollTrigger?.kill();
    tween.kill();
    wrapper.style.height = '';
  };
}

/**
 * Horizontal scroller (`.wrapper > .scroller > .scroller-el`): the tall wrapper
 * is scrolled vertically while its sticky child slides sideways.
 */
export function horizontalScroll(
  wrapper: HTMLElement | null,
  options: { direction?: 1 | -1 } = {},
) {
  if (!wrapper) return () => {};

  const el = wrapper.querySelector<HTMLElement>('.scroller-el');
  if (!el) return () => {};

  if (window.innerWidth < 1060) {
    wrapper.style.height = '';
    return () => {};
  }

  const direction = options.direction ?? 1;

  const measure = () => {
    const distance = Math.max(0, el.scrollWidth - wrapper.clientWidth);
    wrapper.style.height = `${window.innerHeight + distance}px`;
    return distance;
  };

  let distance = measure();

  const tween = gsap.fromTo(
    el,
    { x: direction > 0 ? 0 : () => -distance },
    {
      x: () => (direction > 0 ? -distance : 0),
      ease: 'none',
      scrollTrigger: {
        trigger: wrapper,
        start: 'top top',
        end: () => `+=${distance}`,
        scrub: true,
        invalidateOnRefresh: true,
        onRefresh: () => {
          distance = measure();
        },
      },
    },
  );

  return () => {
    tween.scrollTrigger?.kill();
    tween.kill();
    wrapper.style.height = '';
  };
}

/**
 * `[data-cards-scale]`: the benefits cards fan out, each one offset and
 * stretched a little more than the last, then settle as you scroll through.
 */
export function cardsScale(
  list: HTMLElement | null,
  options: { offset?: number; scaleStep?: number } = {},
) {
  if (!list) return () => {};

  const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-cards-scale]'));
  if (!cards.length) return () => {};

  if (window.innerWidth < 1060) {
    gsap.set(cards, { y: 0, scaleY: 1 });
    return () => {};
  }

  const offset = options.offset ?? 40.8;
  const scaleStep = options.scaleStep ?? 0.07;

  const tweens = cards.map((card, i) =>
    gsap.fromTo(
      card,
      { y: offset * i, scaleY: 1 + scaleStep * i },
      {
        y: 0,
        scaleY: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: list,
          start: 'top bottom',
          end: 'bottom center',
          scrub: true,
        },
      },
    ),
  );

  return () => {
    for (const tween of tweens) {
      tween.scrollTrigger?.kill();
      tween.kill();
    }
  };
}

/** Draws the roadmap line as its section scrolls by. */
export function drawPath(path: SVGPathElement | null, trigger: HTMLElement | null) {
  if (!path || !trigger) return () => {};

  const length = path.getTotalLength();
  gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });

  const tween = gsap.to(path, {
    strokeDashoffset: 0,
    ease: 'none',
    scrollTrigger: {
      trigger,
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
    },
  });

  return () => {
    tween.scrollTrigger?.kill();
    tween.kill();
  };
}

/** Refreshes every trigger — call after fonts load or the loader finishes. */
export function refreshTriggers() {
  ScrollTrigger.refresh();
}
