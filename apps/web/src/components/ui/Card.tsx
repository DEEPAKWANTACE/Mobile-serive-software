import type { ReactNode } from 'react';

export function Card({ title, actions, children, className = '' }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg bg-white ring-1 ring-slate-200 ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
