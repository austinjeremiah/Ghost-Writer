'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { AccordionArrowIcon } from '@/components/icons';
import type { FaqItem } from '@/data/content';

import './accordion.css';

/**
 * FAQ accordion, one panel open at a time.
 *
 * The stylesheet animates the answer with
 * `.accordion__item.opened .accordion__text { height: calc(var(--h, 1vh) * 100) }`,
 * so the only thing JavaScript has to do is measure the content and publish a
 * hundredth of that height as `--h`. The transition itself stays in CSS, as the
 * template had it.
 */
export default function Accordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = useCallback(
    (index: number) => setOpenIndex((current) => (current === index ? null : index)),
    [],
  );

  return (
    <div className="accordion">
      <div className="accordion__items">
        <div className="h-line accordion__line" />
        {items.map((item, index) => (
          <AccordionItem
            key={item.question}
            item={item}
            index={index}
            isOpen={openIndex === index}
            onToggle={() => toggle(index)}
          />
        ))}
      </div>
    </div>
  );
}

function AccordionItem({
  item,
  index,
  isOpen,
  onToggle,
}: {
  item: FaqItem;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const itemRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const item = itemRef.current;
    const text = textRef.current;
    if (!item || !text) return;

    const measure = () => {
      // scrollHeight is the natural height even while the box is collapsed.
      item.style.setProperty('--h', `${text.scrollHeight / 100}px`);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(text);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const number = String(index + 1).padStart(2, '0');

  return (
    <div
      ref={itemRef}
      className={['accordion__item', isOpen ? 'opened' : ''].filter(Boolean).join(' ')}
      onClick={onToggle}
    >
      <div className="accordion__overlay" />
      <div className="grid accordion__cols">
        <div className="h3 accordion__num">{number}</div>
        <h3 className="h4 accordion__h4">
          <button
            type="button"
            className="accordion__trigger"
            aria-expanded={isOpen}
            onClick={(event) => {
              // The row itself already toggles; don't let it fire twice.
              event.stopPropagation();
              onToggle();
            }}
          >
            {item.question}
          </button>
        </h3>
        <div className="accordion__arrow">
          <AccordionArrowIcon />
        </div>
      </div>

      <div ref={textRef} className="accordion__text">
        {item.answer.map((line, i) => (
          <span key={i}>
            {i > 0 ? <br /> : null}
            {line}
          </span>
        ))}
      </div>

      <div className="h-line accordion__line" />
    </div>
  );
}
