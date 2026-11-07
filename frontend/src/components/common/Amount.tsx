import { fromBase } from '@/lib/format';

export function Amount({ units, symbol = 'DUSDC', className }: { units: string; symbol?: string; className?: string }) {
  return <span className={className}>{fromBase(units)} {symbol}</span>;
}
