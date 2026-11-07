'use client';

import type { ReactNode } from 'react';

import {
  CloverIcon,
  DiamondsIcon,
  ProblemIcon,
  SolutionIcon,
  StairsIcon,
} from '@/components/icons';
import { MESSENGERS, type PurposeIconName, type PurposeItem } from '@/data/content';
import { useSectionScale, useStickyScroller } from '@/lib/hooks';

import '@/components/RoundedSection/rounded-section.css';
import './purpose.css';

/**
 * `home-3` — the accent-green rounded panel. The page uses it twice: once as
 * "Purpose of using Ghost Writer" and again as "Problems that we solve", so the
 * heading and the cards are props.
 *
 * `[data-section-sticky]` pins the panel while `[data-section-sticky-scroller]`
 * (its inner column) is driven past it.
 */

const ICONS: Record<PurposeIconName, (props: { className?: string }) => ReactNode> = {
  problem: (props) => <ProblemIcon {...props} />,
  solution: (props) => <SolutionIcon {...props} />,
  stairs: (props) => <StairsIcon {...props} />,
  diamonds: (props) => <DiamondsIcon {...props} />,
  clover: (props) => <CloverIcon {...props} />,
};

interface PurposeProps {
  /** Rendered before the italic part of the heading. */
  title: string;
  titleAccent: string;
  items: PurposeItem[];
  /** The first instance keeps the extra `.sticky-activated` wrapper class. */
  activated?: boolean;
}

export default function Purpose({ title, titleAccent, items, activated = false }: PurposeProps) {
  const wrapperRef = useStickyScroller<HTMLDivElement>();
  const sectionRef = useSectionScale<HTMLElement>();

  return (
    <div className="sticky-wrapper" ref={wrapperRef}>
      <div
        data-section-sticky=""
        className={activated ? 'sticky-activated' : undefined}
      >
        <section ref={sectionRef} className="rounded-section home-3" data-section-scale="">
          <div className="rounded-section__wrapper">
            <div data-section-sticky-scroller="" className="container grid home-3__container">
              <div className="home-3__left">
                <h2 className="h1 home-3__h">
                  {title} <span className="h1 h1--i">{titleAccent}</span>
                </h2>
              </div>

              <div className="home-3__right">
                {items.map((item) => {
                  const Icon = ICONS[item.icon];

                  return (
                    <div className="home-3__item home-3-item" key={item.title}>
                      <div className="home-3-item__top">
                        <Icon className="home-3-item__icon" />
                        <h3 className="home-3-item__h">{item.title}</h3>
                      </div>

                      {item.paragraphs.map((text, i) => (
                        <p className="home-3-item__text" key={i}>
                          {text}
                        </p>
                      ))}

                      {item.withMessengers ? (
                        <ul className="home-3-item__ul">
                          {MESSENGERS.map((messenger, i) => (
                            <li className="home-3-item-li home-3-item__li" key={messenger.name}>
                              <div className="home-3-item-li__line" />
                              <div className="home-3-item-li__content">
                                <p className="home-3-item-li__name">{messenger.name}</p>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={messenger.icon}
                                  className="home-3-item-li__icon"
                                  alt={messenger.name}
                                />
                              </div>
                              {/* The original closes the list with a second rule. */}
                              {i === MESSENGERS.length - 1 ? (
                                <div className="home-3-item-li__line" />
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <div className="home-3-item__line" />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
