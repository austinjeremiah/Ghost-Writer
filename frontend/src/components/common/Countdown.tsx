'use client';
import { useEffect, useRef, useState } from 'react';
import { timeLeft } from '@/lib/format';

/** Ticks every second; calls onDone once when it reaches zero. */
export function Countdown({ to, onDone, className }: { to: number; onDone?: () => void; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const done = useRef(false);
  const cb = useRef(onDone);
  useEffect(() => { cb.current = onDone; });

  useEffect(() => {
    done.current = false;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);

  const left = to - now;
  useEffect(() => {
    if (left <= 0 && !done.current) { done.current = true; cb.current?.(); }
  }, [left]);

  return <span className={className}>{timeLeft(left)}</span>;
}
