'use client';

import { useCallback, useEffect, useState } from 'react';

import Burger from '@/components/Burger';
import { ArrowRightIcon, Logo } from '@/components/icons';
import { NAV_LINKS } from '@/data/content';
import { useUi } from '@/store/ui';

import './navbar.css';

/**
 * Fixed header. Anchor clicks are handled by hand because the page scrolls
 * inside `#scroll-container`, where the browser's native hash jump does not
 * reach.
 */
export default function Navbar() {
  const [isOpen, setOpen] = useState(false);
  const { openPopup } = useUi();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  const goTo = (href: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    close();

    if (window.ss) {
      window.ss.scrollToElement(href);
      return;
    }

    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <header className="navbar">
      <div className="container navbar__container">
        <div className="navbar__content">
          <a
            href="/"
            className="navbar__logo"
            aria-label="Ghost Writer"
            onClick={(event) => {
              event.preventDefault();
              window.ss?.scrollTo(0);
            }}
          >
            <Logo />
          </a>

          <nav className={['navbar__nav', isOpen ? 'open' : ''].filter(Boolean).join(' ')}>
            <ul className="navbar__ul">
              {NAV_LINKS.map((link) => (
                <li
                  key={link.href}
                  className={[
                    link.mobileHidden ? 'navbar__item--mob-hidden' : '',
                    'navbar__item',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <a href={link.href} className="navbar__link" onClick={goTo(link.href)}>
                    {link.label}
                  </a>
                </li>
              ))}
              <li className="navbar__item">
                <button
                  className="navbar__link navbar__link--signin"
                  onClick={() => {
                    close();
                    openPopup();
                  }}
                >
                  <span>Join the beta</span>
                  <ArrowRightIcon />
                </button>
              </li>
            </ul>
          </nav>

          <Burger isOpen={isOpen} onToggle={() => setOpen((value) => !value)} />
        </div>
      </div>
    </header>
  );
}
