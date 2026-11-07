import { CircleCheck, CircleX, ShieldCheck, Timer } from 'lucide-react';
import type { PolicyStatus } from '@/lib/types';

const MAP: Record<PolicyStatus, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
  active: { label: 'Active', cls: 'badge', Icon: ShieldCheck },
  breach: { label: 'Breach', cls: 'badge badge--warn', Icon: Timer },
  paid: { label: 'Paid', cls: 'badge badge--pass', Icon: CircleCheck },
  expired: { label: 'Expired', cls: 'badge badge--muted', Icon: CircleX },
};

export function StatusBadge({ status }: { status: PolicyStatus }) {
  const { label, cls, Icon } = MAP[status];
  return <span className={cls}><Icon size={13} /> {label}</span>;
}
