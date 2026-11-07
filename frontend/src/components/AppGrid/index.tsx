'use client';

import { useEffect, useState } from 'react';

import './app-grid.css';

/**
 * The 12-column debug overlay. The template bound it to a keypress handler
 * that shipped empty; here `g` toggles it, which is what it was for.
 */
export default function AppGrid() {
  const [isVisible, setVisible] = useState(false);

  useEffect(() => {
    const onKeyPress = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key.toLowerCase() === 'g') setVisible((value) => !value);
    };

    document.addEventListener('keypress', onKeyPress);
    return () => document.removeEventListener('keypress', onKeyPress);
  }, []);

  return (
    <div
      className={['app-grid container grid', isVisible ? 'app-grid--visible' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="app-grid__col" />
      ))}
    </div>
  );
}
