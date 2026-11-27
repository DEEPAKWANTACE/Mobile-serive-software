import { useState, type ComponentType } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ClockAlert,
  Hourglass,
  LayoutList,
  Wrench,
} from 'lucide-react';
import {
  ROLES,
  type DashboardSummaryDto,
} from '@msm/shared';
import { Card } from '@/components/ui/Card';
import { inputClass } from '@/components/ui/Field';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/lib/api-client';
import { toQueryString } from '@/lib/crud';
import { formatDate, todayIso } from '@/lib/format';
import { StatCard } from './StatCard';

type DatePreset = { key: string; label: string; from: string; to: string };

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function datePresets(): DatePreset[] {
  const today = todayIso();
  const weekdayFromMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const weekStart = shiftDate(today, -weekdayFromMonday);
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shiftDate(monthStart, -1);
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: shiftDate(today, -1), to: shiftDate(today, -1) },
    { key: 'week', label: 'This week', from: weekStart, to: today },
    { key: 'last-week', label: 'Last week', from: shiftDate(weekStart, -7), to: shiftDate(weekStart, -1) },
    { key: 'month', label: 'This month', from: monthStart, to: today },
    { key: 'last-month', label: 'Last month', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    { key: 'all', label: 'All time', from: '', to: '' },
  ];
}

/** Operational totals plus the four workflow-aware money panels requested for the counter dashboard. */
export function DashboardSummary({ branchId, linkable = true }: { branchId?: string; /** false for roles without Job Master access. */ linkable?: boolean }) {
  const { user } = useAuth();
  // Only Branch Manager / Super Admin may pick any period; everyone else sees today or yesterday.
  const anyPeriod = user?.role === ROLES.SUPER_ADMIN || user?.role === ROLES.BRANCH_MANAGER;
  const today = todayIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const presets = datePresets().filter((p) => anyPeriod || p.key === 'today' || p.key === 'yesterday');
  const range = from || to ? { from, to } : {};
  const summary = useQuery({
    queryKey: ['reports', 'dashboard-summary', branchId, from, to],
    queryFn: () => api.get<DashboardSummaryDto>(`/reports/dashboard-summary?${toQueryString({ ...range, branchId })}`),
  });
  const d = summary.data;
  const jobs = (extra: Record<string, string> = {}) =>
    linkable ? `/jobs?${toQueryString({ ...range, branchId, ...extra })}` : undefined;
  // Pending figures are "open right now", so their lists are not narrowed to the chosen period.
  const openJobs = (extra: Record<string, string> = {}) =>
    linkable ? `/jobs?${toQueryString({ branchId, ...extra })}` : undefined;
  const money = (value?: number) => (value === undefined ? undefined : `₹${Math.round(value).toLocaleString('en-IN')}`);
  const activePreset = presets.find((preset) => preset.from === from && preset.to === to)?.key;
  const periodLabel = activePreset
    ? presets.find((preset) => preset.key === activePreset)!.label
    : from && to
      ? `${formatDate(from)} to ${formatDate(to)}`
      : from
        ? `From ${formatDate(from)}`
        : to
          ? `Up to ${formatDate(to)}`
          : 'All time';

  return (
    <Card
      title="Job summary"
      subtitle={periodLabel}
      icon={LayoutList}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total in" value={d?.totalIn} to={jobs()} tone="brand" icon={ArrowDownToLine} hint="Jobs received" />
        <StatCard label="Total out" value={d?.totalOut} to={jobs({ view: 'out' })} tone="good" icon={ArrowUpFromLine} hint="Delivered" />
        <StatCard label="Pending works" value={d?.pending} to={openJobs({ view: 'pending' })} icon={Wrench} hint={d ? `All open jobs · ${d.underRepair} with engineers` : undefined} />
        <StatCard
          label="More than 15 days"
          value={d?.over15Days}
          to={openJobs({ view: 'over15' })}
          tone={d?.over15Days ? 'critical' : 'default'}
          icon={Hourglass}
          hint="Still open"
        />
      </div>

      <div className="mt-5 border-t border-slate-100 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Period</h3>
            <p className="text-xs text-slate-500">{anyPeriod ? 'Choose a date period' : 'Today or yesterday'} for jobs in / out. Collection, expenses, approved and ready amounts are in the payment summary above.</p>
          </div>
          {anyPeriod && <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              From
              <input
                type="date"
                aria-label="Financial summary from date"
                value={from}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
                className={`${inputClass} w-36!`}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              To
              <input
                type="date"
                aria-label="Financial summary to date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
                className={`${inputClass} w-36!`}
              />
            </label>
          </div>}
        </div>

        <div className="mt-3 flex flex-wrap gap-2" aria-label="Financial summary date presets">
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => {
                setFrom(preset.from);
                setTo(preset.to);
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                activePreset === preset.key
                  ? 'bg-brand-600 text-white ring-brand-600 shadow-sm'
                  : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MoneyTile
            label="Pending customer approval"
            value={money(d?.pendingApprovalAmount)}
            tone="warning"
            icon={ClockAlert}
            hint={d ? `${d.pendingApprovalCount} estimate${d.pendingApprovalCount === 1 ? '' : 's'} for CCO follow-up · any date` : undefined}
          />
        </div>
      </div>

      {!!d?.engineerPending.length && (
        <div className="mt-5 border-t border-slate-100 pt-5">
          <div className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Engineer-wise pending</div>
          <ul className="flex flex-wrap gap-2">
            {d.engineerPending.map((engineer) => (
              <li key={engineer.engineerId}>
                <Link
                  to={openJobs({ view: 'pending', engineerId: engineer.engineerId }) ?? '#'}
                  onClick={(event) => !linkable && event.preventDefault()}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-sm ring-1 ring-slate-200 hover:bg-slate-100"
                >
                  {engineer.engineer}
                  <span className="rounded-full bg-white px-1.5 text-xs font-semibold tabular-nums ring-1 ring-slate-200">{engineer.pending}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

const tileTones = {
  good: 'text-emerald-600',
  warning: 'text-amber-600',
  brand: 'text-brand-600',
  info: 'text-sky-600',
} as const;

/** Compact money tile, same size as the dashboard's small status tiles. */
function MoneyTile({ label, value, hint, icon: Icon, tone }: { label: string; value?: string; hint?: string; icon: ComponentType<{ className?: string }>; tone: keyof typeof tileTones }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white px-3.5 py-3 ring-1 ring-slate-200/80">
      <Icon className={`mt-0.5 size-4 shrink-0 ${tileTones[tone]}`} />
      <div className="min-w-0">
        <div className="text-xs leading-tight text-slate-500">{label}</div>
        <div className="mt-0.5 text-lg leading-tight font-semibold text-slate-900 tabular-nums">{value ?? '–'}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-tight text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}
