'use client';

import Video from '@/components/Video';
import { useReveal } from '@/lib/hooks';

import './easier.css';

/** `home-4` — "Designed to make life {easier}". Anchor target for "Why ghost writer". */
export default function Easier() {
  const ref = useReveal<HTMLElement>({ threshold: 0.3 });

  return (
    <section ref={ref} id="why" className="section home-4" data-in-view="0.3">
      <div className="container home-4__container">
        <div className="home-4__left">
          <h2 data-a-h="" className="h1 home-4__h">
            Designed to make life <span className="h1 h1--i">{'{easier}'}</span>
          </h2>
          <p data-a-p="" className="home-4__text redline-text">
            It is enough to waste time on monotonous activities. We know that whenever you&apos;re
            programming, the least you want to do is customize contact forms
          </p>
        </div>

        <div className="home-4__right">
          <Video src="/2.mp4" className="home-4__visual" label="Ghost Writer setup loop" />
        </div>
      </div>
    </section>
  );
}
