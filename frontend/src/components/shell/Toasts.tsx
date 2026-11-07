'use client';
import { createContext, useCallback, useContext, useState, type ComponentType, type ReactNode } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

export type ToastInput = {
  icon: ComponentType<{ size?: number }>;
  text: ReactNode;
  action?: { label: string; href: string; external?: boolean };
};
type Toast = ToastInput & { id: number };

const ToastCtx = createContext<((t: ToastInput) => void) | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback((t: ToastInput) => {
    const id = nextId++;
    setToasts((ts) => [...ts, { ...t, id }].slice(-4));
    setTimeout(() => dismiss(id), 9000);
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(({ id, icon: Icon, text, action }) => (
          <div key={id} className="toast">
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
