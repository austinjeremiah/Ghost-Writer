'use client';

import { useRef, useState } from 'react';

import Roadmap from '@/components/Roadmap';
import { BigArrowIcon } from '@/components/icons';
import { ROADMAP_CURRENT } from '@/data/content';
import { useHorizontalScroll, useReveal } from '@/lib/hooks';

import './roadmap-section.css';

/**
 * `home-10` — "Project roadmap". The intro block reveals on scroll, then the
 * roadmap track is pulled sideways by the same horizontal-scroll mechanism used
 * by the integration heading.
 */
export default function RoadmapSection() {
  const sectionRef = useReveal<HTMLElement>({ threshold: 0.4 });
  const wrapperRef = useHorizontalScroll<HTMLDivElement>(1);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const localWrapper = useRef<HTMLDivElement>(null);

  return (
    <section
      ref={sectionRef}
      id="roadmap"
      className="section home-10"
      data-in-view="0.4"
    >
      <div className="container home-10__container">
        <div className="home-10__content">
          <div className="home-10__top">
            <h2 data-a-h="" className="h1 home-10__h">
              Project <span className="h1--i">roadmap</span>
            </h2>
            <p data-a-p="" className="home-10__text">
              Part of the Ghost Writer is already done, but we continue to work on it to give you the
              best user experience
            </p>
          </div>

          <div className="home-10__bottom">
            <BigArrowIcon data-a-t="" className="home-10__bottom-arrow" />
            <div className="home-10__bottom-date-wrapper">
              <small data-a-o="" className="home-10__bottom-date-description">
                {ROADMAP_CURRENT.description}
              </small>
              <span data-a-t="" className="home-10__bottom-date">
                {ROADMAP_CURRENT.month}{' '}
                <span className="home-10__bottom-day" data-a-h="">
                  {ROADMAP_CURRENT.day}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="wrapper"
        ref={(node) => {
          wrapperRef.current = node;
          localWrapper.current = node;
          setTrigger(node);
        }}
      >
        <div className="scroller">
          <div className="scroller-el" style={{ ['--t' as string]: 0 }}>
            <Roadmap trigger={trigger} />
          </div>
        </div>
      </div>
    </section>
  );
}
