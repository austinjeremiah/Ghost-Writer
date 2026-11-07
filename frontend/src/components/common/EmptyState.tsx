import type { ComponentType, ReactNode } from 'react';

export function EmptyState({ icon: Icon, title, body, action }: {
  icon: ComponentType<{ size?: number }>; title: string; body?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon size={24} /></span>
      <h3>{title}</h3>
      {body && <p className="muted">{body}</p>}
      {action}
    </div>
  );
}
