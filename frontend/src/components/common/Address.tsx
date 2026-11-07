'use client';
import { ExternalLink } from 'lucide-react';
import { shortId } from '@/lib/format';
import { CopyButton } from './CopyButton';

export function Address({ id, href, full = false }: { id: string; href?: string; full?: boolean }) {
  return (
    <span className="addr" title={id}>
      <span>{full ? id : shortId(id)}</span>
      <CopyButton value={id} label="Copy ID" />
      {href && (
        <a className="iconbtn" href={href} target="_blank" rel="noreferrer" aria-label="Open in explorer" onClick={(e) => e.stopPropagation()}>
          <ExternalLink size={14} />
        </a>
      )}
    </span>
  );
}
