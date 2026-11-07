'use client';

import { useEffect, useRef } from 'react';

import { RoadmapPathIcon } from '@/components/icons';
import { drawPath } from '@/lib/animations';
import { ROADMAP_ITEMS } from '@/data/content';

import './roadmap.css';

/**
 * The horizontal roadmap track: a 3370px-wide curve with a milestone sitting at
 * each of its three turns. The stroke draws itself as the section is scrolled
 * (the template shipped the path with `stroke-dasharray` already set, which is
 * exactly what `drawPath` reproduces).
 */
export default function Roadmap({ trigger }: { trigger: HTMLElement | null }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const path = root?.querySelector('path') ?? null;
    return drawPath(path as SVGPathElement | null, trigger);
  }, [trigger]);

  // The milestones ship at `opacity: 0` and are revealed by `.is-visible`.
  // They travel sideways rather than down the page, so viewport intersection —
  // not scroll position — is what decides when each one has arrived.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const items = Array.from(root.querySelectorAll<HTMLElement>('.roadmap__item'));
    if (!items.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      // Fire a little before the label's leading edge clears the viewport.
      { threshold: 0.2, rootMargin: '0px -5% 0px -5%' },
    );

    for (const item of items) observer.observe(item);

    return () => observer.disconnect();
  }, []);

  return (
    <div className="home-10__roadmap roadmap" ref={rootRef}>
      <RoadmapPathIcon />
      <small className="roadmap__circle" />
      {ROADMAP_ITEMS.map((item) => (
        <div className="roadmap__item" key={item.title}>
          <span className="roadmap__date">
            {item.month} <span>{item.day}</span>
          </span>
          <p className="roadmap__title">{item.title}</p>
        </div>
      ))}
    </div>
  );
}
