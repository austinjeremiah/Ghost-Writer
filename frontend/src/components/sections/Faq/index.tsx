'use client';

import Accordion from '@/components/Accordion';
import { FAQ_ITEMS } from '@/data/content';

import './faq.css';

/** `home-11` — the giant "FAQ" wordmark above the accordion. */
export default function Faq() {
  return (
    <section id="faq" className="section home-11">
      <div className="container">
        <h2 className="h1 home-11__h">
          F<span className="h1--i">A</span>Q
        </h2>
        <Accordion items={FAQ_ITEMS} />
      </div>
    </section>
  );
}
