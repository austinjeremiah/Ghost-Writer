import type { ReactNode } from 'react';
import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react';

export type Step = { label: string; state: 'todo' | 'doing' | 'done' | 'error'; detail?: ReactNode; link?: ReactNode };

export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={s.label} className="step" data-state={s.state} aria-current={s.state === 'doing' ? 'step' : undefined}>
          <span className="step-icon" aria-hidden>
            {s.state === 'done' ? <CircleCheck size={16} />
              : s.state === 'error' ? <CircleX size={16} />
              : s.state === 'doing' ? <LoaderCircle size={16} className="spin" />
              : i + 1}
          </span>
          <div>
            <div className="step-label">{s.label}</div>
            {(s.detail || s.link) && <div className="step-detail">{s.detail}{s.link}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
