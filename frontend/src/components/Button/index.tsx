'use client';

import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

import './button.css';

/**
 * The bracketed `[ TEXT ]` button. On hover the label slides up and a marquee
 * copy of it slides in from below, which is why the text is repeated four
 * times inside `.button__hover-text` — exactly as the template did it.
 */

interface BaseProps {
  text: string;
  className?: string;
}

function Content({ text }: { text: string }) {
  return (
    <>
      <span className="button__content-before">[</span>
      <span className="button__content">
        <span className="button__items">
          <span className="button__text">{text}</span>
          <span className="button__hover-text-wrapper">
            <span className="button__hover-text">
              {`${text} ${text} ${text} ${text}`}
            </span>
          </span>
        </span>
      </span>
      <span className="button__content-after">]</span>
    </>
  );
}

type ButtonProps = BaseProps & ButtonHTMLAttributes<HTMLButtonElement> & { tag?: 'button' };
type LinkProps = BaseProps & AnchorHTMLAttributes<HTMLAnchorElement> & { tag: 'a' };

export default function Button(props: ButtonProps | LinkProps) {
  if (props.tag === 'a') {
    const { text, className, tag: _tag, ...rest } = props;
    return (
      <a {...rest} className={['button', className].filter(Boolean).join(' ')}>
        <Content text={text} />
      </a>
    );
  }

  const { text, className, tag: _tag, type, ...rest } = props as ButtonProps;
  return (
    <button {...rest} type={type ?? 'button'} className={['button', className].filter(Boolean).join(' ')}>
      <Content text={text} />
    </button>
  );
}
