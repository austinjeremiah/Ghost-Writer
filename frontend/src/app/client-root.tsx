'use client';
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

// `ssr: false` is only allowed inside a client component, so the server layout imports this file.
// Wallets are detected through `window`, so the provider tree cannot render on the server.
const Providers = dynamic(() => import('./providers'), { ssr: false, loading: () => null });

export function ClientRoot({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
