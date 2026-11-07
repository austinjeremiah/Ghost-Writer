'use client';
import { Database } from 'lucide-react';
import { useConfig } from '@/hooks/queries';
import { link, shortId } from '@/lib/format';

export function BlobLink({ blobId, label }: { blobId: string; label?: string }) {
  const { data: cfg } = useConfig();
  const text = label ?? `blob ${shortId(blobId)}`;
  if (!cfg) return <span className="addr">{text}</span>;
  return (
    <a className="extlink" href={link.blob(cfg, blobId)} target="_blank" rel="noreferrer" title={blobId} onClick={(e) => e.stopPropagation()}>
      <Database size={13} /> {text}
    </a>
  );
}
