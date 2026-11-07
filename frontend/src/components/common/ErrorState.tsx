'use client';
import { CircleX, RefreshCw } from 'lucide-react';
import { userMessage } from '@/lib/errors';

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="note note--deny" role="alert" style={{ alignItems: 'center' }}>
      <CircleX size={16} />
      <span style={{ flex: 1 }}>{userMessage(error)}</span>
      {onRetry && (
        <button type="button" className="btn btn--sm btn--ghost" onClick={onRetry}>
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  );
}
