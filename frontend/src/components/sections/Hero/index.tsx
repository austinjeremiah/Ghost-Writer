'use client';

import Button from '@/components/Button';
import { GlobeIcon } from '@/components/icons';
import { DotPattern } from '@/components/ui/dot-pattern';
import { useUi } from '@/store/ui';

import './hero.css';

/**
 * `home-1` — "We're just sending forms / and that's all".
 *
 * The section is wrapped in `.home-1-sticky-wrapper` so the next section can
 * slide up over it (`.over-revealer` has `margin-top: -100vh`). The reveal is
 * fired by the loader rather than a scroll trigger, since it is already in view
 * on first paint.
 *
 * Three layers, back to front: the cream ground, the dot grid on top of it,
 * then the content.
 */
export default function Hero() {
  const { openPopup } = useUi();

  return (
    <div className="home-1-sticky-wrapper">
      <div className="home-1-sticky">
        <section className="section section--nm home-1">
          {/*
            magicui's DotPattern renders one <circle> per cell, so the spacing
            is what decides the node count — at 32px this is ~1,250 circles
            across a 1440x900 hero instead of ~5,100 at the 16px default.
            The colour comes from `currentColor`, set on .home-1__dots.
          */}
          <DotPattern
            width={32}
            height={32}
            cr={1.4}
            className="home-1__dots"
          />

          <div className="container home-1__container">
            <div className="home-1__top">
              <h1 data-a-h="" className="h1 home-1__h1">
                <span className="home-1__h1-first">
                  We<small className="home-1__h1-small">&apos;re</small>
                </span>{' '}
                just sending <span className="h1--i">forms</span>
              </h1>

              <div className="home-1__right">
                <GlobeIcon data-a-o="" />
                <Button
                  className="home-1__btn"
                  data-a-t=""
                  text="Try now"
                  onClick={openPopup}
                />
              </div>
            </div>

            <h2 data-a-h="" className="h1 h1--i home-1__h2">
              and that&rsquo;s all
            </h2>

            <p data-a-p="" className="home-1__text redline-text">
              We are not a form builder. We do not seek to solve all problems. We Just send form
              data to instant messengers and email in the most convenient way
            </p>

            <Button
              className="home-1__btn home-1__btn--mobile"
              data-a-t=""
              text="Try now"
              onClick={openPopup}
            />

            <div className="home-1__gl js-hidden" />
          </div>
        </section>
      </div>
    </div>
  );
}
