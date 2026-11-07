'use client';

import Button from '@/components/Button';
import { BigArrowIcon } from '@/components/icons';
import { useReveal } from '@/lib/hooks';
import { useUi } from '@/store/ui';

import './messengers.css';

/** `home-6` — "Integration of your form with different {messengers}". */
export default function Messengers() {
  const ref = useReveal<HTMLElement>({ threshold: 0.3 });
  const { openPopup } = useUi();

  return (
    <div className="over-revealer home-6-over-revealer">
      <section ref={ref} className="section home-6">
        <div className="container home-6__container">
          <h2 data-a-h="" className="h1 home-6__h">
            Integration of your form with different{' '}
            <span className="h1 h1--i">{'{messengers}'}</span>
          </h2>

          <BigArrowIcon className="home-6__arrow" data-a-o="" />

          <p data-a-p="" className="home-6__text">
            Most often, the data that a potential client leaves in the form are sent to email or to
            the CRM system. But the fact is that a small business does not always use a CRM system,
            and also does not always have a manager who monitors customer requests via email in
            real time
          </p>

          <Button className="home-6__btn" data-a-t="" text="Get a beta" onClick={openPopup} />
        </div>
      </section>
    </div>
  );
}
