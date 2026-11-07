'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Address, BlobLink, CopyButton, ErrorState } from '@/components/common';
import { useEvents } from '@/lib/events';
import { ago, link } from '@/lib/format';
import { useConfig, useHealth, useProof } from '@/hooks/queries';
import type { Health } from '@/lib/types';

const WORKER_LABELS: Record<keyof Health['workers'], string> = {
  priceWatcher: 'Price watcher',
  liquidationWatcher: 'Liquidation watcher',
  checkpointPulse: 'Checkpoint pulse',
  memoryQueue: 'Memory queue',
  hedger: 'Hedger',
};

function workerClass(v: string) {
  if (v === 'running' || v === 'stream') return 'badge badge--pass';
  if (v === 'polling') return 'badge badge--warn';
  if (v === 'stopped') return 'badge badge--deny';
  return 'badge badge--muted';
}

const Dash = () => <span className="muted">—</span>;

function Key({ value }: { value: string }) {
  return <span className="addr" style={{ wordBreak: 'break-all' }}>{value}<CopyButton value={value} /></span>;
}

export default function ProofPage() {
  const proof = useProof();
  const config = useConfig();
  const health = useHealth();
  const { lastCheckpoint } = useEvents();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  const p = proof.data;
  const cfg = config.data;

  const rows: Array<[string, ReactNode]> = [
    ['Memories on Walrus Mainnet', p ? <span className="big-sm">{p.mainnetMemories}</span> : <Dash />],
    ['Latest memory blobs', p
      ? p.lastBlobIds.length
        ? <ul className="stack-sm">{p.lastBlobIds.map((b) => <li key={b} className="row"><BlobLink blobId={b} label={b} /><CopyButton value={b} /></li>)}</ul>
        : <span className="muted">None yet</span>
      : <Dash />],
    ['Underwriter memory account', p && cfg ? <Address id={p.underwriterAccountId} full href={link.mainnetObject(cfg, p.underwriterAccountId)} /> : <Dash />],
    ['Agent ID (underwriter delegate public key)', p ? <Key value={p.memwalAgentId} /> : <Dash />],
    ['Contract package (Testnet)', p && cfg ? <Address id={p.packageId} full href={link.testnetObject(cfg, p.packageId)} /> : <Dash />],
    ['Vault pool (Testnet)', p && cfg ? <Address id={p.poolId} full href={link.testnetObject(cfg, p.poolId)} /> : <Dash />],
    ['Nautilus enclave object', p && cfg ? <Address id={p.enclaveObjectId} full href={link.testnetObject(cfg, p.enclaveObjectId)} /> : <Dash />],
    ['Quote signing key', cfg ? <Key value={cfg.pool.quotePubkeyHex} /> : <Dash />],
    ['Record signing key', cfg ? <Key value={cfg.recordPubkeyHex} /> : <Dash />],
    ['Backend workers', health.data
      ? <span className="row">{(Object.keys(WORKER_LABELS) as Array<keyof Health['workers']>).map((k) => (
          <span key={k} className={workerClass(health.data.workers[k])}>{WORKER_LABELS[k]}: {health.data.workers[k]}</span>
        ))}</span>
      : <Dash />],
    ['Live chain heartbeat', lastCheckpoint
      ? <span>Testnet checkpoint <span className="mono">#{lastCheckpoint.seq}</span> · {ago(lastCheckpoint.at)}</span>
      : <span className="muted">Waiting for the first checkpoint from the backend…</span>],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Proof</h1>
          <p className="page-sub">Every ID a judge or the submission form needs, each linked to its explorer.</p>
        </div>
      </div>
      <div className="stack">
        {proof.isError && <ErrorState error={proof.error} onRetry={() => proof.refetch()} />}
        {config.isError && <ErrorState error={config.error} onRetry={() => config.refetch()} />}
        {health.isError && <ErrorState error={health.error} onRetry={() => health.refetch()} />}
        <section className="card">
          <dl className="dl">
            {rows.map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
