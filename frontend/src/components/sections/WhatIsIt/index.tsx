'use client';

import Video from '@/components/Video';
import { useReveal } from '@/lib/hooks';

import './what-is-it.css';

/**
 * `home-2` — "What does it mean Ghost Writer?". Sits in an `.over-revealer`, which
 * pulls it up over the hero by a full viewport height.
 */
export default function WhatIsIt() {
  const ref = useReveal<HTMLElement>({ threshold: 0.4 });

  return (
    <div className="over-revealer home-2-over-revealer">
      <section ref={ref} data-in-view="0.4" className="section home-2">
        <div className="container home-2__container">
          <div className="home-2__left">
            <div className="home-2__visual">
              <Video src="/1.mp4" label="Ghost Writer intro loop" />
            </div>
          </div>

          <div className="home-2__right">
            <h2 data-a-h="" className="h1 home-2__h">
              What does it mean <span className="h1 h1--i">Ghost Writer?</span>
            </h2>
            <p data-a-p="" className="home-2__text redline-text">
              This is a simply-use service, which allows to you configure the sending of contact
              forms from your website to selected messengers in a few clicks
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
