import type { ComponentType } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';

type Tone = 'default' | 'brand' | 'info' | 'good' | 'warning' | 'critical';

type Props = {
  label: string;
  value: number | string | undefined;
  to?: string;
  tone?: Tone;
  icon?: ComponentType<{ className?: string }>;
  hint?: string;
};

// Status tones (good / warning / critical) are reserved for state; "brand"/"info" mark identity, "default" is neutral.
const tones: Record<Tone, { badge: string; value: string }> = {
  default: { badge: 'bg-slate-100 text-slate-600', value: 'text-slate-900' },
  brand: { badge: 'bg-brand-50 text-brand-600', value: 'text-slate-900' },
  info: { badge: 'bg-brand-50 text-brand-600', value: 'text-slate-900' },
  good: { badge: 'bg-emerald-50 text-emerald-700', value: 'text-slate-900' },
  warning: { badge: 'bg-amber-50 text-amber-700', value: 'text-slate-900' },
  critical: { badge: 'bg-red-50 text-red-700', value: 'text-red-700' },
};

export function StatCard({ label, value, to, tone = 'default', icon: Icon, hint }: Props) {
  const t = tones[tone];
  const body = (
    <div className="group relative h-full rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ring-1 ring-slate-200/80 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] leading-tight font-medium text-slate-500">{label}</div>
          <div className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums ${t.value}`}>{value ?? '–'}</div>
          {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
        </div>
        {Icon && (
          <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${t.badge}`}>
            <Icon className="size-5" />
          </span>
        )}
      </div>
      {to && <ArrowUpRight className="absolute right-3 bottom-3 size-4 text-slate-300 transition group-hover:text-brand-600" />}
    </div>
  );
  return to ? (
    <Link to={to} className="block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}
