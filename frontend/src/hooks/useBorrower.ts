// hooks/useBorrower.ts
'use client';
import { ApiError } from '@/lib/api';
import { useAddress, useBorrowerQuery } from './queries';

export type BorrowerStatus = 'no_wallet' | 'loading' | 'not_registered' | 'registered' | 'error';

export function useBorrower() {
  const address = useAddress();
  const q = useBorrowerQuery(address);
  let status: BorrowerStatus;
  if (!address) status = 'no_wallet';
  else if (q.isPending) status = 'loading';
  else if (q.error instanceof ApiError && q.error.status === 404) status = 'not_registered';
  else if (q.error) status = 'error';
  else status = 'registered';
  return { address, status, borrower: q.data ?? null, error: q.error, refetch: q.refetch };
}
