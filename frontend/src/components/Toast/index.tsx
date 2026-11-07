'use client';

import { useEffect, useRef } from 'react';

import { ToastCloseIcon } from '@/components/icons';
import { gsap } from '@/lib/gsap';
import type { Toast as ToastModel } from '@/store/ui';

import './toast.css';

/** A toast dismisses itself once its 5-second progress bar completes. */
export default function Toast({
  toast,
  onHide,
}: {
  toast: ToastModel;
  onHide: (id: number) => void;
}) {
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;

    const tween = gsap.to(el, {
      duration: 5,
      width: '100%',
      ease: 'linear',
      onComplete: () => onHide(toast.id),
    });

    return () => {
      tween.kill();
    };
  }, [toast.id, onHide]);

  return (
    <div className={`toast toast--${toast.color}`}>
      <div ref={progressRef} className="toast__progress" />
      <div className="toast__message">{toast.text}</div>
      <button
        className="toast__close"
        aria-label="Close notification"
        onClick={(event) => {
          event.preventDefault();
          onHide(toast.id);
        }}
      >
        <ToastCloseIcon />
      </button>
    </div>
  );
}
