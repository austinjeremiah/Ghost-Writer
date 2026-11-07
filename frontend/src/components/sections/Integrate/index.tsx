'use client';

import { useEffect, useRef } from 'react';

import Revealer from '@/components/Revealer';
import Video from '@/components/Video';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import { useHorizontalScroll, useReveal, useSectionScale } from '@/lib/hooks';
import { splitText } from '@/lib/split-text';
import { INTEGRATION_STEPS } from '@/data/content';

import './integrate.css';

/**
 * `home-5` — "How you can integrate it with your code?".
 *
 * Two things happen here. The oversized heading is a horizontal scroller: its
 * `.scroller-el` slides sideways as the tall `.wrapper` is scrolled through,
 * and each character lifts into place (the stylesheet parks `.home-5__h .char`
 * at `translateY(101%)` on desktop). Below it, the four steps reveal in turn
 * and the screencast is uncovered by the `Revealer`.
 */
export default function Integrate() {
  const wrapperRef = useHorizontalScroll<HTMLDivElement>(1);
  const stepsRef = useReveal<HTMLDivElement>({ threshold: 0.2 });
  const videoRef = useSectionScale<HTMLDivElement>();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) return;

    const { chars } = splitText(heading, 'chars');
    if (!chars.length) return;

    if (window.innerWidth < 1060) {
      gsap.set(chars, { y: 0, opacity: 1 });
      return;
    }

    const tween = gsap.to(chars, {
      y: 0,
      opacity: 1,
      duration: 1,
      ease: 'power3.out',
      stagger: 0.02,
      scrollTrigger: {
        trigger: heading,
        start: 'top 90%',
        once: true,
      },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
      ScrollTrigger.refresh();
    };
  }, []);

  return (
    <section
      id="integration"
      className="section section--pb section--nm home-5"
      style={{ ['--hh' as string]: '100vh' }}
    >
      <div className="wrapper" ref={wrapperRef}>
        <div className="scroller">
          <div className="scroller-el">
            <div className="home-5__h-wrapper">
              <h2 ref={headingRef} className="h1 home-5__h">
                How you can integrate it with your code?
              </h2>
            </div>
          </div>
        </div>
      </div>

      <div ref={stepsRef} data-in-view="0.2" className="container home-5__container">
        <ul className="home-5__items">
          {INTEGRATION_STEPS.map((item, i) => (
            <li className="home-5-li home-5__li" key={item.step}>
              <div data-a-l="" className="home-5-li__line" />
              <div className="home-5-li__content">
                <span data-a-twrapper="" className="home-5-li__step">
                  <span data-a-t="">{item.step}</span>
                </span>
                <p data-a-twrapper="" className="home-5-li__text">
                  <span data-a-t="">{item.text}</span>
                </p>
              </div>
              {/* The last row is closed off with a second rule. */}
              {i === INTEGRATION_STEPS.length - 1 ? (
                <div data-a-l="" className="home-5-li__line" />
              ) : null}
            </li>
          ))}
        </ul>

        <div className="home-5__sticky-wrapper">
          <div className="home-5__sticky">
            <div ref={videoRef} data-section-scale="" className="home-5__video-wrapper">
              <Video src="/screencast.mp4" label="Ghost Writer screencast" />
            </div>
            <Revealer target=".home-5__video-wrapper" />
          </div>
        </div>
      </div>
    </section>
  );
}
