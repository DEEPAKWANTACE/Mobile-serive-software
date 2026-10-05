import type { ComponentType, ReactNode } from 'react';

type Props = {
  title?: string;
  subtitle?: string;
  icon?: ComponentType<{ className?: string }>;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Card({ title, subtitle, icon: Icon, actions, children, className = '' }: Props) {
  return (
    <section className={`rounded-xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ring-1 ring-slate-200/80 ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon && (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                <Icon className="size-4" />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-slate-900">{title}</h2>
              {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
