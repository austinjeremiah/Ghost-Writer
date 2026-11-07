'use client';

import { CloseSmallIcon } from '@/components/icons';

import './burger.css';

/** Three dots that collapse into a close button; mobile only. */
export default function Burger({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={['navbar__burger', 'burger', isOpen ? 'burger--open' : '']
        .filter(Boolean)
        .join(' ')}
      aria-label="Navigation button"
      aria-expanded={isOpen}
      onClick={onToggle}
    >
      <span className="burger__dot burger__dot--1" />
      <span className="burger__dot burger__dot--2">
        <span className="burger__close-icon">
          <CloseSmallIcon />
        </span>
      </span>
      <span className="burger__dot burger__dot--3" />
    </button>
  );
}
