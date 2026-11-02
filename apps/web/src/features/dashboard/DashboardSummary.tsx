import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeIndianRupee,
  CircleDollarSign,
  ClockAlert,
  Hourglass,
  IndianRupee,
  LayoutList,
  PackageCheck,
  Wrench,
} from 'lucide-react';
import {
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  type DashboardSummaryDto,
  type PaymentMode,
} from '@msm/shared';
import { Card } from '@/components/ui/Card';
import { inputClass } from '@/components/ui/Field';
import { api } from '@/lib/api-client';
import { toQueryString } from '@/lib/crud';
import { formatCurrency, formatDate, todayIso } from '@/lib/format';
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
  const today = todayIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [paymentMode, setPaymentMode] = useState<PaymentMode | ''>('');
  const presets = datePresets();
  const range = from || to ? { from, to } : {};
  const summary = useQuery({
    queryKey: ['reports', 'dashboard-summary', branchId, from, to, paymentMode],
    queryFn: () => api.get<DashboardSummaryDto>(`/reports/dashboard-summary?${toQueryString({ ...range, branchId, paymentMode })}`),
  });
  const d = summary.data;
  const jobs = (extra: Record<string, string> = {}) =>
    linkable ? `/jobs?${toQueryString({ ...range, branchId, ...extra })}` : undefined;
  const money = (value?: number) => (value === undefined ? undefined : formatCurrency(value));
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
  const allReceived = d
    ? d.completedReceivedByMode.CASH + d.completedReceivedByMode.UPI + d.completedReceivedByMode.CARD
    : undefined;

  return (
    <Card
      title="Job summary"
      subtitle={`${periodLabel} · financial cards use the workflow event date`}
      icon={LayoutList}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total in" value={d?.totalIn} to={jobs()} tone="brand" icon={ArrowDownToLine} hint="Jobs received" />
        <StatCard label="Total out" value={d?.totalOut} to={jobs({ view: 'out' })} tone="good" icon={ArrowUpFromLine} hint="Delivered" />
        <StatCard label="Pending works" value={d?.pending} to={jobs({ view: 'pending' })} icon={Wrench} hint={d ? `${d.underRepair} with engineers` : undefined} />
        <StatCard
          label="More than 15 days"
          value={d?.over15Days}
          to={jobs({ view: 'over15' })}
          tone={d?.over15Days ? 'critical' : 'default'}
          icon={Hourglass}
          hint="Still open"
        />
      </div>

      <div className="mt-5 border-t border-slate-100 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Financial position</h3>
            <p className="text-xs text-slate-500">Choose a date period; payment mode changes only “Received from completed jobs”.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
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

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Ready to collect"
            value={money(d?.readyToCollectAmount)}
            tone="good"
            icon={PackageCheck}
            hint={d ? `${d.readyToCollectCount} ready job${d.readyToCollectCount === 1 ? '' : 's'} · balance due now` : undefined}
          />
          <StatCard
            label="Pending customer approval"
            value={money(d?.pendingApprovalAmount)}
            tone="warning"
            icon={ClockAlert}
            hint={d ? `${d.pendingApprovalCount} estimate${d.pendingApprovalCount === 1 ? '' : 's'} for CCO follow-up` : undefined}
          />
          <StatCard
            label="Approved · under repair"
            value={money(d?.approvedUnderRepairAmount)}
            tone="brand"
            icon={BadgeIndianRupee}
            hint={d ? `${d.approvedUnderRepairCount} approved job${d.approvedUnderRepairCount === 1 ? '' : 's'} in repair` : undefined}
          />
          <StatCard
            label="Received from completed jobs"
            value={money(d?.completedReceivedAmount)}
            tone="info"
            icon={CircleDollarSign}
            hint={d ? `${d.completedReceivedCount} completed job${d.completedReceivedCount === 1 ? '' : 's'} · ${paymentMode ? PAYMENT_MODE_LABELS[paymentMode] : 'all modes'}` : undefined}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
            <IndianRupee className="size-3.5" /> Received mode
          </span>
          {([
            { value: '' as const, label: 'All', amount: allReceived },
            ...PAYMENT_MODES.map((mode) => ({ value: mode, label: PAYMENT_MODE_LABELS[mode], amount: d?.completedReceivedByMode[mode] })),
          ]).map((option) => (
            <button
              key={option.value || 'ALL'}
              type="button"
              onClick={() => setPaymentMode(option.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                paymentMode === option.value
                  ? 'bg-slate-900 text-white ring-slate-900'
                  : 'bg-slate-50 text-slate-700 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              {option.label}{option.amount === undefined ? '' : ` · ${formatCurrency(option.amount)}`}
            </button>
          ))}
        </div>
      </div>

      {!!d?.engineerPending.length && (
        <div className="mt-5 border-t border-slate-100 pt-5">
          <div className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Engineer-wise pending</div>
          <ul className="flex flex-wrap gap-2">
            {d.engineerPending.map((engineer) => (
              <li key={engineer.engineerId}>
                <Link
                  to={jobs({ view: 'pending', engineerId: engineer.engineerId }) ?? '#'}
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
