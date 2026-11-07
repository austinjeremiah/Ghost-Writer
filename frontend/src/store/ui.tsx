'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Replaces the template's Pinia store. The original kept exactly these keys:
 * `isPopupOpened`, `inLoaded`, `isWaiting`, `isSceneInited` and `toasts`.
 */

export type ToastColor = 'default' | 'success' | 'danger';

export interface Toast {
  id: number;
  text: string;
  color: ToastColor;
}

interface UiState {
  isPopupOpened: boolean;
  openPopup: () => void;
  closePopup: () => void;

  isLoaded: boolean;
  setLoaded: (value: boolean) => void;

  isWaiting: boolean;
  setWaiting: (value: boolean) => void;

  isSceneInited: boolean;
  setSceneInited: (value: boolean) => void;

  toasts: Toast[];
  addToast: (text: string, color?: ToastColor) => void;
  removeToast: (id: number) => void;
}

const UiContext = createContext<UiState | null>(null);

let toastId = 0;

export function UiProvider({ children }: { children: ReactNode }) {
  const [isPopupOpened, setPopupOpened] = useState(false);
  const [isLoaded, setLoaded] = useState(false);
  const [isWaiting, setWaiting] = useState(false);
  const [isSceneInited, setSceneInited] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const openPopup = useCallback(() => {
    setPopupOpened(true);
    if (window.ss) window.ss.isFixed = true;
  }, []);

  const closePopup = useCallback(() => {
    setPopupOpened(false);
    if (window.ss) window.ss.isFixed = false;
  }, []);

  const addToast = useCallback((text: string, color: ToastColor = 'default') => {
    toastId += 1;
    setToasts((current) => [...current, { id: toastId, text, color }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo<UiState>(
    () => ({
      isPopupOpened,
      openPopup,
      closePopup,
      isLoaded,
      setLoaded,
      isWaiting,
      setWaiting,
      isSceneInited,
      setSceneInited,
      toasts,
      addToast,
      removeToast,
    }),
    [
      isPopupOpened,
      openPopup,
      closePopup,
      isLoaded,
      isWaiting,
      isSceneInited,
      toasts,
      addToast,
      removeToast,
    ],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const context = useContext(UiContext);
  if (!context) throw new Error('useUi must be used inside <UiProvider>');
  return context;
}
