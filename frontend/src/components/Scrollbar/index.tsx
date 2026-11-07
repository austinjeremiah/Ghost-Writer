'use client';

import { useEffect, useRef, useState } from 'react';

import type { SmoothScroll } from '@/lib/smooth-scroll';

/**
 * The custom scrollbar the template drew on the right edge (the native one is
 * hidden by `#scroll-container::-webkit-scrollbar`). Dragging the thumb scrolls
 * the container.
 */
export default function Scrollbar({
  getScroll,
}: {
  getScroll: () => SmoothScroll | null;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let frame = 0;
    let unsubscribe: (() => void) | undefined;
    let dragging = false;

    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    const layout = (scroll: SmoothScroll) => {
      const viewport = scroll.el.clientHeight;
      const total = scroll.el.scrollHeight;
      if (total <= viewport) {
        setHidden(true);
        return;
      }
      setHidden(false);

      const height = Math.max((viewport / total) * track.clientHeight, 40);
      const max = track.clientHeight - height;
      const progress = scroll.limit > 0 ? scroll.scrollTop / scroll.limit : 0;

      thumb.style.height = `${height}px`;
      thumb.style.transform = `translateY(${progress * max}px)`;
    };

    // The scroller is created in a sibling effect, so poll briefly for it.
    const attach = () => {
      const scroll = getScroll();
      if (!scroll) {
        frame = requestAnimationFrame(attach);
        return;
      }

      layout(scroll);
      unsubscribe = scroll.on(() => {
        layout(scroll);
        thumb.classList.add('scrolling');
        window.clearTimeout(Number(thumb.dataset.timer));
        thumb.dataset.timer = String(
          window.setTimeout(() => thumb.classList.remove('scrolling'), 600),
        );
      });
    };

    frame = requestAnimationFrame(attach);

    const onPointerDown = (event: PointerEvent) => {
      const scroll = getScroll();
      if (!scroll) return;
      dragging = true;
      thumb.classList.add('active');
      track.setPointerCapture(event.pointerId);
      onPointerMove(event);
    };

    const onPointerMove = (event: PointerEvent) => {
      const scroll = getScroll();
      if (!dragging || !scroll) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
      scroll.scrollTo(ratio * scroll.limit, true);
    };

    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      thumb.classList.remove('active');
      if (track.hasPointerCapture(event.pointerId)) {
        track.releasePointerCapture(event.pointerId);
      }
    };

    const onResize = () => {
      const scroll = getScroll();
      if (scroll) layout(scroll);
    };

    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', onPointerUp);
    track.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe?.();
      track.removeEventListener('pointerdown', onPointerDown);
      track.removeEventListener('pointermove', onPointerMove);
      track.removeEventListener('pointerup', onPointerUp);
      track.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', onResize);
    };
  }, [getScroll]);

  return (
    <div ref={trackRef} className={['scrollbar', hidden ? 'hidden' : ''].filter(Boolean).join(' ')}>
      <span ref={thumbRef} className="scrollbar__thumb" />
    </div>
  );
}
