'use client';

import { HEADACHE_ITEMS } from '@/data/content';
import { useReveal } from '@/lib/hooks';

import './headache.css';

/** `home-8` — "Ghost Writer relieves the headache of developers and site owners". */
export default function Headache() {
  const headingRef = useReveal<HTMLDivElement>({ threshold: 0.4 });
  const listRef = useReveal<HTMLUListElement>({ threshold: 0.25 });

  return (
    <section className="section home-8">
      <div className="container home-8__container">
        <div ref={headingRef} className="home-8__content" data-in-view="0.4">
          <div className="home-8__top">
            <h2 data-a-h="" className="h1 home-8__h home-8__h--1">
              <span className="h1--i">Ghost Writer</span> relieves the headache
            </h2>
          </div>
          <div className="home-8__bottom">
            <h2 data-a-h="" className="h1 home-8__h home-8__h--2">
              of <span className="h1--i">developers</span> and site{' '}
              <span className="h1--i">owners</span>
            </h2>
          </div>
        </div>

        <ul ref={listRef} data-in-view="0.25" className="home-8__items">
          {HEADACHE_ITEMS.map((item) => (
            <li className="home-8__item home-8-item" key={item.title}>
              <div data-a-l="" className="home-8-item__line" />
              <div className="grid home-8-item__content">
                <h3 data-a-twrapper="" className="home-8-item__h">
                  <span data-a-t="">{item.title}</span>
                </h3>
                <p data-a-twrapper="" className="home-8-item__text">
                  <span data-a-t="">{item.text}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
