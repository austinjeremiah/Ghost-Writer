'use client';

import { useEffect, useRef } from 'react';

import { gsap } from '@/lib/gsap';
import { refreshTriggers, reveal } from '@/lib/animations';
import { splitText } from '@/lib/split-text';
import { useUi } from '@/store/ui';

import './loader.css';

const WORD = 'Ghost Writer ®';

/*
 * The template's 3.6458vw type size made five nowrap columns of an
 * 11-character word exactly span the viewport. Hold that fit for any name by
 * scaling the size inversely with the word's length.
 */
const TUNED_FONT_VW = 3.6458333333;
const TUNED_WORD_LENGTH = 11;
const ITEM_FONT_VW = (TUNED_FONT_VW * TUNED_WORD_LENGTH) / WORD.length;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Intro curtain. Five columns of repeated "Ghost Writer ®"; the centre column
 * starts stretched across the viewport, snaps into the grid, then the whole
 * wall fades while one word zooms through the camera.
 *
 * The beats below match the compiled timeline in the template, down to the
 * delays (1000 / 100 / 500 / 1000 / 1000 / 1800ms).
 */
export default function Loader() {
  const { isLoaded, setLoaded } = useUi();

  const rootRef = useRef<HTMLDivElement>(null);
  const col1Ref = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const centerTopRef = useRef<HTMLDivElement>(null);
  const centerBottomRef = useRef<HTMLDivElement>(null);
  const centerEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLoaded) return;

    let cancelled = false;
    const timeline = gsap.timeline();

    // Hold the page still while the curtain plays.
    if (window.ss) window.ss.isFixed = true;

    const fadeIn = (el: HTMLElement | null, duration = 1) => {
      if (!el) return;
      const { lines } = splitText(el, 'lines');
      const inners = lines
        .map((line) => line.querySelector<HTMLElement>('.line-inner'))
        .filter((node): node is HTMLElement => Boolean(node));

      gsap.set(el, { opacity: 1 });
      gsap.to(inners.length ? inners : el, {
        y: 0,
        opacity: 1,
        duration,
        ease: 'power3.out',
        stagger: 0.06,
      });
    };

    const run = async () => {
      const center = centerRef.current;
      if (center) {
        const { chars } = splitText(center, 'chars');
        gsap.set(center, { opacity: 1 });
        gsap.to(chars, {
          y: 0,
          scaleY: 1,
          opacity: 1,
          duration: 1,
          ease: 'power3.out',
          stagger: 0.02,
        });
      }

      await delay(1000);
      if (cancelled) return;
      fadeIn(centerTopRef.current);

      await delay(100);
      if (cancelled) return;
      fadeIn(centerBottomRef.current);

      await delay(500);
      if (cancelled) return;

      const col1 = col1Ref.current;
      if (col1) {
        timeline.to(col1.querySelectorAll('.loader__item'), {
          duration: 1,
          left: 0,
          x: 0,
          ease: 'power2.inOut',
          stagger: 0.01,
          onComplete: () => col1.classList.add('done'),
        });
      }

      await delay(1000);
      if (cancelled) return;

      const root = rootRef.current;
      const all = root ? Array.from(root.querySelectorAll<HTMLElement>('.loader__item')) : [];
      const fading = all.filter((el) => !el.classList.contains('loader__item--ec'));

      all.forEach((el, i) => {
        setTimeout(() => {
          if (!cancelled) fadeIn(el, 0.9);
        }, 20 * i);
      });

      await delay(1000);
      if (cancelled) return;

      timeline.to(fading, { duration: 0.5, opacity: 0 });

      /*
       * The closing zoom scales this one word up by 100x. GSAP scales about the
       * element's own centre, which is only the centre of the screen if the word
       * happens to sit there — and it does not: it is one text run inside the
       * third of five columns, so its box moves with the length of the word.
       *
       * Pin the origin to the point of the element that is currently over the
       * middle of the viewport. Scaling holds that point still, so the zoom
       * radiates from the centre of the screen whatever the word is.
       */
      const zoomEl = centerEndRef.current;
      if (zoomEl) {
        const rect = zoomEl.getBoundingClientRect();
        const originX = ((window.innerWidth / 2 - rect.left) / rect.width) * 100;
        const originY = ((window.innerHeight / 2 - rect.top) / rect.height) * 100;
        gsap.set(zoomEl, { transformOrigin: `${originX}% ${originY}%` });
      }

      timeline.to(zoomEl, {
        duration: 1.3,
        scale: 100,
        opacity: 0,
        ease: 'power3.inOut',
        force3D: false,
      });

      await delay(1800);
      if (cancelled) return;

      setLoaded(true);
      if (window.ss) {
        window.ss.isFixed = false;
        window.ss.measure();
      }
      refreshTriggers();

      // Kick off the hero reveal the moment the curtain clears.
      const hero = document.querySelector<HTMLElement>('.home-1');
      if (hero) reveal(hero, { immediate: true });
    };

    void run();

    return () => {
      cancelled = true;
      timeline.kill();
      if (window.ss) window.ss.isFixed = false;
    };
  }, [isLoaded, setLoaded]);

  if (isLoaded) return null;

  const item = (key: string | number) => (
    <div key={key} data-a-p="" className="loader__item">
      {WORD}
    </div>
  );

  return (
    <div
      className="loader"
      ref={rootRef}
      style={{ ['--loader-item-fs' as string]: `${ITEM_FONT_VW}vw` }}
    >
      <div className="loader__cols">
        <div ref={col1Ref} className="loader__col loader__col--1">
          <div ref={centerTopRef} data-a-p="" className="loader__item loader__item--ct">
            {WORD}
          </div>
          {item('c1-a')}
          <div ref={centerRef} data-a-h="" className="loader__item loader__item--c">
            {WORD}
          </div>
          {item('c1-b')}
          <div ref={centerBottomRef} data-a-p="" className="loader__item loader__item--cb">
            {WORD}
          </div>
        </div>

        <div className="loader__col loader__col--2">
          {Array.from({ length: 5 }, (_, i) => item(`c2-${i}`))}
        </div>

        <div className="loader__col loader__col--3">
          {Array.from({ length: 2 }, (_, i) => item(`c3a-${i}`))}
          <div ref={centerEndRef} data-a-p="" className="loader__item loader__item--ec">
            {WORD}
          </div>
          {Array.from({ length: 2 }, (_, i) => item(`c3b-${i}`))}
        </div>

        <div className="loader__col loader__col--4">
          {Array.from({ length: 5 }, (_, i) => item(`c4-${i}`))}
        </div>

        <div className="loader__col loader__col--5">
          {Array.from({ length: 5 }, (_, i) => item(`c5-${i}`))}
        </div>
      </div>
    </div>
  );
}
