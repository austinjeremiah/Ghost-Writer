// hooks/queries.ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { api } from '@/lib/api';
import type { PolicyStatus, UnderwriterNamespace } from '@/lib/types';

export const qk = {
  health: ['health'] as const,
  config: ['config'] as const,
  market: ['market'] as const,
  borrower: (a: string) => ['borrower', a] as const,
  history: (a: string) => ['history', a] as const,
  positions: (a: string) => ['positions', a] as const,
  policiesRoot: ['policies'] as const,
  policies: (holder?: string, status?: PolicyStatus) => ['policies', holder ?? '', status ?? ''] as const,
  policy: (id: string) => ['policy', id] as const,
  book: ['book'] as const,
  uwMemoryRoot: ['uwMemory'] as const,
  uwMemory: (ns: UnderwriterNamespace) => ['uwMemory', ns] as const,
  memoryWrites: ['memoryWrites'] as const,
  proof: ['proof'] as const,
};

/** Connected wallet address, normalized; null when disconnected. */
export function useAddress(): string | null {
  const acct = useCurrentAccount();
  return acct ? normalizeSuiAddress(acct.address) : null;
}

export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: api.health, refetchInterval: 30_000 });
export const useConfig = () => useQuery({ queryKey: qk.config, queryFn: api.config, staleTime: Infinity });
export const useMarket = () => useQuery({ queryKey: qk.market, queryFn: api.market, refetchInterval: 60_000 }); // price.tick keeps spot fresh between refetches
export const useBorrowerQuery = (a: string | null) =>
  useQuery({ queryKey: qk.borrower(a ?? ''), queryFn: () => api.borrower(a!), enabled: !!a, retry: false });
export const useHistory = (a: string | null) =>
  useQuery({ queryKey: qk.history(a ?? ''), queryFn: () => api.history(a!), enabled: !!a, staleTime: 30_000 }); // backend caches 30 s
export const usePositions = (a: string | null) =>
  useQuery({ queryKey: qk.positions(a ?? ''), queryFn: () => api.positions(a!), enabled: !!a });
export const usePolicies = (holder?: string | null, status?: PolicyStatus) =>
  useQuery({ queryKey: qk.policies(holder ?? undefined, status), queryFn: () => api.policies({ holder: holder ?? undefined, status }), enabled: holder !== null });
export const usePolicy = (id: string) => useQuery({ queryKey: qk.policy(id), queryFn: () => api.policy(id) });
export const useBook = () => useQuery({ queryKey: qk.book, queryFn: api.book });
export const useUnderwriterMemory = (ns: UnderwriterNamespace) => useQuery({ queryKey: qk.uwMemory(ns), queryFn: () => api.underwriterMemory(ns) });
export const useMemoryWrites = () => useQuery({ queryKey: qk.memoryWrites, queryFn: () => api.memoryWrites(50) });
export const useProof = () => useQuery({ queryKey: qk.proof, queryFn: api.proof });
