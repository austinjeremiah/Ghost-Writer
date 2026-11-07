'use client';
import type { ReactNode } from 'react';
import { CircleCheck, CircleX, Hash, RefreshCw, Timer, TriangleExclamationPoint } from 'lucide-react';
import { useOnEvent } from '@/lib/events';
import { fromBase, link, timeLeft } from '@/lib/format';
import { useAddress, useConfig, usePolicies } from '@/hooks/queries';
import { HealthBanner } from './HealthBanner';
import { MobileNav, Sidebar } from './Sidebar';
import { ToastProvider, useToast } from './Toasts';
import { TopBar } from './TopBar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <GlobalToasts />
      <div className="gw-shell">
        <Sidebar />
        <div className="gw-main">
          <TopBar />
          <MobileNav />
          <HealthBanner />
          <main className="gw-content">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}

/** Doc §4.4: toasts only for events that concern the connected wallet. */
function GlobalToasts() {
  const toast = useToast();
  const address = useAddress();
  const { data: cfg } = useConfig();
  const { data } = usePolicies(address);
  const mine = new Set((data?.policies ?? []).map((p) => p.policyId));

  useOnEvent(['warning.issued', 'breach.reported', 'breach.reset', 'policy.paid', 'ledger.anchored', 'memory.failed'], (e) => {
    if (!address) return;
    switch (e.type) {
      case 'warning.issued':
        if (e.data.borrower !== address) return;
        toast({
          icon: TriangleExclamationPoint,
          text: 'SUI is within 5% of your trigger. Topping up now lowers your future price.',
          action: { label: 'View policy', href: `/policies/${e.data.policyId}` },
        });
        break;
      case 'breach.reported':
        if (!mine.has(e.data.policyId)) return;
        toast({
          icon: Timer,
          text: `Price is below your trigger. Payout in ${cfg ? timeLeft(cfg.pool.confirmDelayMs) : 'a few minutes'} if it stays there.`,
          action: { label: 'Watch', href: `/policies/${e.data.policyId}` },
        });
        break;
      case 'breach.reset':
        if (!mine.has(e.data.policyId)) return;
        toast({ icon: RefreshCw, text: 'Price recovered. Breach timer reset.' });
        break;
      case 'policy.paid':
        if (e.data.holder !== address) return;
        toast({
          icon: CircleCheck,
          text: `${fromBase(e.data.payout)} DUSDC paid to your wallet.`,
          action: cfg ? { label: 'View tx', href: link.testnetTx(cfg, e.data.digest), external: true } : undefined,
        });
        break;
      case 'ledger.anchored':
        if (e.data.borrower !== address) return;
        toast({ icon: Hash, text: `Your record #${e.data.seq} is anchored on Sui.`, action: { label: 'My memory', href: '/memory' } });
        break;
      case 'memory.failed':
        if (e.data.account !== address) return;
        toast({ icon: CircleX, text: `Saving a record to your memory failed: ${e.data.error}. It will retry.` });
        break;
    }
  });
  return null;
}
