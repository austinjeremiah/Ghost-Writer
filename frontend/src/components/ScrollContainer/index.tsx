'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { setScroller } from '@/lib/gsap';
import { refreshTriggers } from '@/lib/animations';
import { SmoothScroll } from '@/lib/smooth-scroll';
import { watchViewportVars } from '@/lib/viewport';

import Scrollbar from '@/components/Scrollbar';

/**
 * `#scroll-container` — the real scroll host for the whole page. It installs
 * the lerped scroller on `window.ss` (the name the rest of the code expects),
 * points ScrollTrigger at this element and keeps the viewport vars current.
 */
export default function ScrollContainer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<SmoothScroll | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const stopViewport = watchViewportVars();

    const scroll = new SmoothScroll(el, {
      breakpoint: 1060,
      friction: 0.07,
      stepSize: 0.8,
      isFixed: false,
    });

    scroll.init();
    scrollRef.current = scroll;
    window.ss = scroll;

    setScroller(el);

    // Images, videos and web fonts all change the document height.
    const observer = new ResizeObserver(() => {
      scroll.measure();
      refreshTriggers();
    });
    observer.observe(el.firstElementChild ?? el);

    const onLoad = () => {
      scroll.measure();
      refreshTriggers();
    };
    window.addEventListener('load', onLoad);

    const raf = requestAnimationFrame(onLoad);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('load', onLoad);
      observer.disconnect();
      scroll.destroy();
      stopViewport();
      setScroller(null);
      if (window.ss === scroll) delete window.ss;
      scrollRef.current = null;
    };
  }, []);

  return (
    <>
      <div id="scroll-container" ref={ref}>
        {children}
      </div>
      <Scrollbar getScroll={() => scrollRef.current} />
    </>
  );
}
