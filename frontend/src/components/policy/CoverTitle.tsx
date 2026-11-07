import { Landmark, TrendingDown } from 'lucide-react';
import { e8ToUsd, shortId, usd } from '@/lib/format';
import type { PolicyDTO } from '@/lib/types';

export function coverTitle(p: Pick<PolicyDTO, 'kind' | 'asset' | 'strikeE8' | 'obligationId'>) {
  return p.kind === 'price'
    ? `${p.asset} below ${usd(e8ToUsd(p.strikeE8))}`
    : `Suilend liquidation ${shortId(p.obligationId)}`;
}

export function CoverTitle({ policy }: { policy: Pick<PolicyDTO, 'kind' | 'asset' | 'strikeE8' | 'obligationId'> }) {
  const Icon = policy.kind === 'price' ? TrendingDown : Landmark;
  return (
    <span className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
      <Icon size={16} aria-label={policy.kind === 'price' ? 'Price cover' : 'Liquidation cover'} />
      <span>{coverTitle(policy)}</span>
    </span>
  );
}
