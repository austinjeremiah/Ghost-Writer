'use client';
import { createContext, useCallback, useContext, useState, type ComponentType, type ReactNode } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

export type ToastInput = {
  icon: ComponentType<{ size?: number }>;
  text: ReactNode;
  action?: { label: string; href: string; external?: boolean };
  /**
   * Stay until the reader dismisses it. For events they must not miss because they happened to be
   * on another page — a payout above all, which is money arriving and is worth going back to read.
   */
  sticky?: boolean;
};
type Toast = ToastInput & { id: number };

const ToastCtx = createContext<((t: ToastInput) => void) | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback((t: ToastInput) => {
    const id = nextId++;
    setToasts((ts) => {
      const next = [...ts, { ...t, id }];
      // Trim to four, but drop the oldest transient one first so a sticky notice is never
      // pushed out by routine chatter.
      while (next.length > 4) {
        const victim = next.findIndex((x) => !x.sticky);
        next.splice(victim === -1 ? 0 : victim, 1);
      }
      return next;
    });
    if (!t.sticky) setTimeout(() => dismiss(id), 9000);
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(({ id, icon: Icon, text, action, sticky }) => (
          <div key={id} className={sticky ? 'toast toast--sticky' : 'toast'}>
            <Icon size={18} />
            <div className="toast-body">
              <div>{text}</div>
              {action && (action.external
                ? <a className="toast-action" href={action.href} target="_blank" rel="noreferrer">{action.label}</a>
                : <Link className="toast-action" href={action.href}>{action.label}</Link>)}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(id)}><X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast must be inside ToastProvider');
  return c;
}
