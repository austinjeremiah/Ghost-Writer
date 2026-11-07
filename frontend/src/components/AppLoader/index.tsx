'use client';

import { useUi } from '@/store/ui';

import '@/components/Loader/loader.css';

/** The small spinner shown while a form request is in flight. */
export default function AppLoader() {
  const { isWaiting } = useUi();
  if (!isWaiting) return null;

  return (
    <div className="app-loader">
      <svg className="circular" viewBox="25 25 50 50">
        <circle className="path" cx="50" cy="50" r="20" fill="none" strokeWidth="2" strokeMiterlimit="10" />
      </svg>
    </div>
  );
}
