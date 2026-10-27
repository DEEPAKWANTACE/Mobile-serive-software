import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router';

export type DashboardMetricItem = {
  key: string;
  label: string;
  value: ReactNode;
  to?: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: 'default' | 'brand' | 'good' | 'warning' | 'critical';
  selected?: boolean;
  onSelect?: () => void;
};

const valueTones: Record<NonNullable<DashboardMetricItem['tone']>, string> = {
  default: 'text-slate-900',
  brand: 'text-brand-700',
  good: 'text-emerald-700',
  warning: 'text-amber-700',
  critical: 'text-red-700',
};

/** Compact dashboard table: metric names are the navigation links, matching the legacy vertical-list workflow. */
export function DashboardMetricList({ items, valueLabel = 'Count / value', columns = 1 }: { items: DashboardMetricItem[]; valueLabel?: string; columns?: 1 | 2 | 3 }) {
  const hasActions = items.some((item) => item.onSelect);
  const compactGrid = columns > 1;
  const columnClass = columns === 3 ? 'md:grid-cols-2 xl:grid-cols-3' : columns === 2 ? 'md:grid-cols-2' : '';
  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      {!compactGrid && (
        <div className={`grid ${hasActions ? 'grid-cols-[minmax(0,1fr)_auto_auto]' : 'grid-cols-[minmax(0,1fr)_auto]'} items-center gap-3 bg-slate-100 px-4 py-2 text-xs font-semibold tracking-wide text-slate-600 uppercase`}>
          <span>Name</span>
          <span className="text-right">{valueLabel}</span>
          {hasActions && <span className="hidden text-right sm:block">Action</span>}
        </div>
      )}
      <div className={compactGrid ? `grid ${columnClass}` : 'divide-y divide-slate-200'}>
        {items.map((item) => {
          const Icon = item.icon;
          const name = item.onSelect ? (
            <button
              type="button"
              onClick={item.onSelect}
              className="text-left font-semibold text-brand-700 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              {item.label}
            </button>
          ) : item.to ? (
            <Link to={item.to} className="font-semibold text-brand-700 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none">
              {item.label}
            </Link>
          ) : (
            <span className="font-semibold text-slate-800">{item.label}</span>
          );
          return (
            <div
              key={item.key}
              className={`grid ${hasActions && !compactGrid ? 'grid-cols-[minmax(0,1fr)_auto_auto]' : 'grid-cols-[minmax(0,1fr)_auto]'} items-center gap-3 px-4 ${compactGrid ? 'border-b border-slate-200 py-2.5 md:border-r' : 'py-3'} ${item.selected ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
            >
              <div className="flex min-w-0 items-start gap-3">
                {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />}
                <div className="min-w-0 text-sm">
                  <div>{name}</div>
                  {item.hint && <div className="mt-0.5 text-xs text-slate-500">{item.hint}</div>}
                </div>
              </div>
              <div className={`text-right text-base font-semibold tabular-nums ${valueTones[item.tone ?? 'default']}`}>{item.value ?? '–'}</div>
              {hasActions && !compactGrid && (
                <div className="text-right">
                  {item.onSelect && (
                    <button type="button" onClick={item.onSelect} className="whitespace-nowrap text-xs font-semibold text-brand-700 hover:underline">
                      {item.selected ? 'Shown below' : 'Show below'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
