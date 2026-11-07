'use client';
import { useEffect, useState } from 'react';
import { CircleCheck, Copy } from 'lucide-react';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="iconbtn"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined);
      }}
    >
      {copied ? <CircleCheck size={14} /> : <Copy size={14} />}
    </button>
  );
}
