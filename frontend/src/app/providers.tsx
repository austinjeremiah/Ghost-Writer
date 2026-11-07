'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { useState, type ReactNode } from 'react';
import { dAppKit } from '@/lib/dapp-kit';
import { EventsProvider } from '@/lib/events';
import { AppShell } from '@/components/shell/AppShell';

export default function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <DAppKitProvider dAppKit={dAppKit}>
        <EventsProvider>
          <AppShell>{children}</AppShell>
        </EventsProvider>
      </DAppKitProvider>
    </QueryClientProvider>
  );
}
