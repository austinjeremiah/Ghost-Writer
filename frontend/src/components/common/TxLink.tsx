'use client';
import { ExternalLink } from 'lucide-react';
import { useConfig } from '@/hooks/queries';
import { link, shortId } from '@/lib/format';

export function TxLink({ digest, network, label }: { digest: string; network: 'testnet' | 'mainnet'; label?: string }) {
  const { data: cfg } = useConfig();
  const text = label ?? `${network === 'mainnet' ? 'Mainnet' : 'Testnet'} tx ${shortId(digest)}`;
  if (!cfg) return <span className="addr">{text}</span>;
  const href = network === 'mainnet' ? link.mainnetTx(cfg, digest) : link.testnetTx(cfg, digest);
  return (
    <a className="extlink" href={href} target="_blank" rel="noreferrer" title={digest} onClick={(e) => e.stopPropagation()}>
      {text} <ExternalLink size={13} />
    </a>
  );
}
