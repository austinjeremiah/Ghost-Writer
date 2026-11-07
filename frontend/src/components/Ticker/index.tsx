'use client';

import { useEffect, useMemo, useRef } from 'react';

import { StarIcon } from '@/components/icons';
import { gsap } from '@/lib/gsap';

import './ticker.css';

/**
 * Endless marquee. The template repeated the phrase enough times to cover
 * twice the track width, then translated the strip by half its own width and
 * wrapped — so the seam is never visible. `--dir` spins the star icon.
 */

interface TickerProps {
  text: string;
  /** Seconds for one full pass. The template used 80. */
  duration?: number;
  /** How many characters of track to aim for, used to pick the copy count. */
  multiplier?: number;
  direction?: 1 | -1;
}

export default function Ticker({
  text,
  duration = 80,
  multiplier = 21,
  direction = 1,
}: TickerProps) {
  const itemsRef = useRef<HTMLDivElement>(null);

  // Same count formula as the original: at least 2, always even.
  const copies = useMemo(() => {
    const base = Math.max(Math.ceil((multiplier / Math.max(text.length, 1)) * 4), 2);
    return base % 2 === 0 ? base : base + 1;
  }, [multiplier, text.length]);

  // The last word is italicised, matching `A few important <i>benefits</i>`.
  const [lead, tail] = useMemo(() => {
    const words = text.split(' ');
    const last = words.pop() ?? '';
    return [words.join(' '), last];
  }, [text]);

  useEffect(() => {
    const el = itemsRef.current;
    if (!el) return;

    const tween = gsap.fromTo(
      el,
      { x: 0 },
      {
        x: () => -el.scrollWidth / 2,
        duration,
        ease: 'none',
        repeat: -1,
      },
    );

    return () => {
      tween.kill();
    };
  }, [duration, copies]);

  // The star spins through `.ticker__item svg { transform: rotate(calc(360deg
  // * var(--dir))); transition: transform 10s linear }`. A fixed `--dir` lands
  // on a whole number of turns and never moves, so the counter is stepped once
  // per transition to keep handing the rule a new target.
  useEffect(() => {
    const el = itemsRef.current;
    if (!el) return;

    const SPIN_MS = 10_000;
    let turns = 0;

    const step = () => {
      turns += direction;
      el.style.setProperty('--dir', String(turns));
    };

    // Kick the first turn off on the next frame; setting the property in the
    // same frame as the initial value would not transition.
    const frame = requestAnimationFrame(step);
    const timer = setInterval(step, SPIN_MS);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [direction]);

  return (
    <div className="ticker">
      <div
        ref={itemsRef}
        className="ticker__items"
        style={{ ['--dir' as string]: 0 }}
      >
        {Array.from({ length: copies }, (_, i) => (
          <div className="ticker__item" key={i}>
            <StarIcon />
            &nbsp;
            <div className="ticker__text">
              {lead} <span className="h1--i">{tail}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
