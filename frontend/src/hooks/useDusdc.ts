'use client';
import { useQuery } from '@tanstack/react-query';
import { dusdcBalance } from '@/lib/buy';
import { useAddress, useConfig } from './queries';

export const dusdcKey = (address: string | null) => ['dusdc', address ?? ''] as const;

/** gUSD (Testnet) held by the connected wallet, in base units. Refetched every 30 s and after a buy. */
export function useDusdc() {
  const address = useAddress();
  const { data: cfg } = useConfig();
  return useQuery({
    queryKey: dusdcKey(address),
    queryFn: () => dusdcBalance(cfg!, address!),
    enabled: !!address && !!cfg,
    refetchInterval: 30_000,
  });
}
