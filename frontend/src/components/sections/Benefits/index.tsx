'use client';

import Ticker from '@/components/Ticker';
import { BigArrowIcon } from '@/components/icons';
import { BENEFITS, BENEFITS_TICKER_TEXT } from '@/data/content';
import { useCardsScale, useReveal } from '@/lib/hooks';

import './benefits.css';

/**
 * `home-7` — the benefits grid under a rotated marquee.
 *
 * `[data-cards-scale]` staggers the six cards: each starts lower and taller
 * than the one before it, then they settle flush as the list scrolls through.
 */
export default function Benefits() {
  const ref = useReveal<HTMLElement>({ threshold: 0.5 });
  const listRef = useCardsScale<HTMLUListElement>();

  return (
    <section ref={ref} id="benefits" data-in-view="0.5" className="section home-7">
      <Ticker text={BENEFITS_TICKER_TEXT} duration={80} direction={1} />

      <div className="container home-7__container">
        <div className="home-7__content">
          <div className="home-7__text-wrapper">
            <BigArrowIcon data-a-t="" className="home-7__icon" />
            <p data-a-p="" className="home-7__text redline-text">
              Each of these benefits has been tested first-hand by Ghost Writer developers. But what
              can I say: our product is a symbiosis of practical solutions that were made to
              facilitate daily work
            </p>
          </div>

          <ul ref={listRef} className="grid home-7__items">
            {BENEFITS.map((benefit) => (
              <li data-cards-scale="" className="home-7-item home-7__item" key={benefit.title}>
                <p className="home-7-item__text">{benefit.text}</p>
                <h3 className="home-7-item__title">{benefit.title}</h3>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
