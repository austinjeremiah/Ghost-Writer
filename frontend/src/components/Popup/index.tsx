'use client';

import { useEffect, type ReactNode } from 'react';

import { PopupCloseIcon } from '@/components/icons';

import './popup.css';

/**
 * Modal shell. The `popup-enter` / `popup-leave-to` class names come from the
 * original Vue transition; here they are driven by a mounted flag so the CSS
 * transitions still run on open and close.
 */

interface PopupProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

export default function Popup({ isOpen, onClose, children }: PopupProps) {
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('e-fixed');

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('e-fixed');
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="popup">
      <div className="popup__backdrop" onClick={onClose} />
      <div className="popup__window">
        <button className="popup__btn" onClick={onClose} aria-label="Close">
          <span className="popup__close-icon">
            <PopupCloseIcon />
          </span>
        </button>
        {children}
      </div>
    </div>
  );
}
