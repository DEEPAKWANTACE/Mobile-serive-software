import { useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarDays,
  Coins,
  Info,
  List,
  MapPin,
  Package,
  Phone,
  ReceiptText,
  Smartphone,
  TrendingUp,
  Wallet,
  Wrench,
} from 'lucide-react';
import { APPROVED_REPAIR_PENDING_STATUSES, ROLES, type BranchDto, type DashboardSummaryDto } from '@msm/shared';
import { inputClass } from '@/components/ui/Field';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/lib/api-client';
import { toQueryString, useOptions } from '@/lib/crud';
import { formatDate, todayIso } from '@/lib/format';

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

type Preset = { key: string; label: string; from: string; to: string };

function presets(): Preset[] {
  const today = todayIso();
  const yesterday = shiftDate(today, -1);
  const weekStart = shiftDate(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shiftDate(monthStart, -1);
  return [
    { key: 'two-days', label: 'Today + Yesterday', from: yesterday, to: today },
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: yesterday, to: yesterday },
    { key: 'week', label: 'This week', from: weekStart, to: today },
    { key: 'month', label: 'This month', from: monthStart, to: today },
    { key: 'last-month', label: 'Last month', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    { key: 'all', label: 'All time', from: '', to: '' },
  ];
}

const rupees = (value?: number) => (value === undefined ? '–' : `₹${Math.round(value).toLocaleString('en-IN')}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Five-box payment summary shared by the CCO, Branch Manager and Super Admin dashboards.
 * Collection / expenses / net follow the chosen period — CCO always sees the latest two days
 * (today + yesterday, rolling); Branch Manager / Super Admin can pick any date or range.
 * Repair pending (approved) and Ready to collect always show every currently open job, whatever its date.
 */
export function PaymentSummary({ branchId }: { branchId?: string }) {
  const { user } = useAuth();
  const anyPeriod = user?.role === ROLES.SUPER_ADMIN || user?.role === ROLES.BRANCH_MANAGER;
  const all = presets();
  const twoDays = all[0]!;
  const [from, setFrom] = useState(twoDays.from);
  const [to, setTo] = useState(twoDays.to);
  const shown = anyPeriod ? all : all.filter((p) => p.key === 'two-days' || p.key === 'today' || p.key === 'yesterday');
  const active = shown.find((p) => p.from === from && p.to === to);
  const range = from || to ? { from, to } : {};

  const summary = useQuery({
    queryKey: ['reports', 'dashboard-summary', branchId, from, to, ''],
    queryFn: () => api.get<DashboardSummaryDto>(`/reports/dashboard-summary?${toQueryString({ ...range, branchId })}`),
  });
  const d = summary.data;

  // Super Admin viewing one branch: show its name in the header.
  const branches = useOptions<BranchDto>('branches', {}, { enabled: user?.role === ROLES.SUPER_ADMIN && !!branchId });
  const branchName =
    user?.branch?.name ?? (branchId ? (branches.items.find((b) => b.id === branchId)?.name ?? 'Selected branch') : 'All branches');

  const periodLabel = active
    ? active.label
    : from && to
      ? from === to
        ? formatDate(from)
        : `${formatDate(from)} – ${formatDate(to)}`
      : from
        ? `From ${formatDate(from)}`
        : to
          ? `Up to ${formatDate(to)}`
          : 'All time';
  const dayBook = (view: string) => `/accounts/day-book?${toQueryString({ view, from: from || '2000-01-01', to: to || todayIso(), branchId })}`;
  const jobs = (extra: Record<string, string>) => `/jobs?${toQueryString({ ...extra, branchId })}`;
  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <section className="rounded-2xl bg-slate-50 p-2.5 ring-1 ring-slate-200 sm:p-3" aria-label="Payment summary">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:items-start sm:gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Payment Summary</h2>
          <p className="hidden text-xs text-slate-500 sm:block">
            {anyPeriod ? 'Choose any date or range for collection, expenses and net amount' : 'Collection, expenses and net amount for the latest 2 days'}
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2 rounded-xl bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm ring-1 ring-slate-200 sm:gap-3 sm:px-3 sm:py-1.5">
          <span className="inline-flex shrink-0 items-center gap-1.5 font-medium">
            <CalendarDays className="size-3.5 text-brand-600 sm:size-4" /> {todayLabel}
          </span>
          <span className="h-4 w-px bg-slate-200 sm:h-5" />
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0 text-brand-600 sm:size-4" /> <span className="truncate">{branchName}</span>
          </span>
        </div>
      </div>

      {/* Phones: one sideways-scrolling row of period chips instead of several wrapped rows. */}
      <div
        className="-mx-2.5 mt-2 flex items-center gap-1.5 overflow-x-auto px-2.5 pb-1 sm:mx-0 sm:mt-2 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-0 sm:pb-0"
        aria-label="Payment summary period"
      >
        {shown.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              setFrom(p.from);
              setTo(p.to);
            }}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ring-1 transition sm:px-3 ${
              active?.key === p.key ? 'bg-brand-600 text-white ring-brand-600 shadow-sm' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100'
            }`}
          >
            {p.label}
          </button>
        ))}
        {anyPeriod && (
          <>
            <label className="ml-1 flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-600">
              From
              <input type="date" aria-label="Payment summary from date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} w-36!`} />
            </label>
            <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-600">
              To
              <input type="date" aria-label="Payment summary to date" value={to} min={from || undefined} max={todayIso()} onChange={(e) => setTo(e.target.value)} className={`${inputClass} w-36!`} />
            </label>
          </>
        )}
      </div>

      {summary.error && <p className="mt-3 text-sm text-red-600">{summary.error.message}</p>}

      <div className="mt-2.5 grid gap-2.5 sm:gap-3 lg:grid-cols-3">
        <Box
          icon={Wallet}
          title="Total Collection"
          subtitle={`Cash + Online received · ${periodLabel}`}
          amount={rupees(d?.collection.total)}
          chip={d && <><Phone className="size-3.5 sm:size-4" /> {plural(d.collection.deliveredCount, 'Delivered Call')}</>}
          left={{ label: 'Cash Received', value: rupees(d?.collection.cash) }}
          right={{ label: 'Online Received', value: rupees(d?.collection.online) }}
          to={dayBook('received')}
        />
        <Box
          icon={ReceiptText}
          title="Total Expenses"
          subtitle={periodLabel}
          amount={rupees(d?.expenses.total)}
          chip={d && <><Coins className="size-3.5 sm:size-4" /> {d.expenses.count} Expense {d.expenses.count === 1 ? 'Entry' : 'Entries'}</>}
          left={{ label: 'Cash Expenses', value: rupees(d?.expenses.cash) }}
          right={{ label: 'Online Expenses', value: rupees(d?.expenses.online) }}
          to={dayBook('expenses')}
        />
        <Box
          icon={TrendingUp}
          title="Net Available Amount"
          subtitle={`Collection – Expenses · ${periodLabel}`}
          amount={rupees(d?.net.total)}
          left={{ label: 'Net Cash', value: rupees(d?.net.cash) }}
          right={{ label: 'Net Online', value: rupees(d?.net.online) }}
          to={dayBook('net')}
        />
      </div>

      <div className="mt-2.5 grid gap-2.5 sm:gap-3 lg:grid-cols-2">
        <Box
          icon={Wrench}
          title="To Repair Pending (Approved)"
          subtitle="Customer approved, repair pending"
          count={{ value: d?.approvedUnderRepairCount, unit: 'Calls / Phones', note: 'Approved' }}
          side={{ label: 'Approved Amount', value: rupees(d?.approvedUnderRepairAmount) }}
          to={jobs({ statuses: APPROVED_REPAIR_PENDING_STATUSES.join(','), sort: 'oldest' })}
        />
        <Box
          icon={Package}
          title="Ready to Collect"
          subtitle="Repaired, waiting for customer"
          count={{ value: d?.readyToCollectCount, unit: 'Phones', note: 'Pending Delivery' }}
          side={{ label: 'Pending Amount', value: rupees(d?.readyToCollectAmount) }}
          to={jobs({ status: 'READY_FOR_DELIVERY', sort: 'oldest' })}
        />
      </div>

      <p className="mt-2.5 flex items-start gap-2 rounded-xl bg-brand-50 px-2.5 py-1.5 text-xs text-slate-700 ring-1 ring-brand-100 sm:px-3 sm:py-2">
        <Info className="mt-0.5 size-3.5 shrink-0 text-brand-600" />
        <span>
          <strong>Note:</strong> To Repair Pending and Ready to Collect show all pending calls until repair/delivery is completed, irrespective of date.
        </span>
      </p>
    </section>
  );
}

type Pair = { label: string; value: string };

/** One summary box, coloured from the selected theme's brand colours (bg-brand-600 + text-white picks the theme's ink colour). */
function Box({
  icon: Icon,
  title,
  subtitle,
  amount,
  chip,
  left,
  right,
  count,
  side,
  to,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  amount?: string;
  chip?: ReactNode;
  left?: Pair;
  right?: Pair;
  count?: { value?: number; unit: string; note: string };
  side?: Pair;
  to: string;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center gap-2 bg-brand-600 px-3 py-2 text-white sm:gap-2.5 sm:px-3.5">
        <Icon className="size-5 shrink-0 sm:size-6" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-tight font-bold">{title}</div>
          <div className="truncate text-[11px] leading-tight opacity-85">{subtitle}</div>
        </div>
        {/* The details link sits in the header to save a row. */}
        <Link to={to} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold ring-1 ring-white/40 hover:bg-white/30">
          <List className="hidden size-3.5 sm:block" /> <span className="sm:hidden">Details</span><span className="hidden sm:inline">View Details</span> <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="flex flex-1 flex-col justify-center px-3 py-2.5 sm:px-3.5">
        {amount !== undefined && <div className="text-center text-2xl font-extrabold text-brand-700 tabular-nums sm:text-3xl">{amount}</div>}
        {chip && (
          <div className="mt-1.5 flex items-center justify-center gap-1.5 rounded-lg bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 sm:mt-2 sm:gap-2 sm:px-3">
            {chip}
          </div>
        )}
        {left && right && (
          <div className="mt-2 grid grid-cols-2 divide-x divide-slate-200 text-center">
            {[left, right].map((pair) => (
              <div key={pair.label} className="px-2">
                <div className="text-[11px] text-slate-600 sm:text-xs">{pair.label}</div>
                <div className="text-base font-bold text-slate-900 tabular-nums">{pair.value}</div>
              </div>
            ))}
          </div>
        )}
        {count && side && (
          <div className="grid grid-cols-2 items-center divide-x divide-slate-200">
            <div className="flex items-center gap-2 pr-2 sm:gap-3 sm:pr-3">
              <Smartphone className="size-7 shrink-0 text-brand-600 sm:size-8" />
              <div className="min-w-0">
                <div className="text-slate-900">
                  <span className="text-2xl font-extrabold tabular-nums">{count.value ?? '–'}</span>{' '}
                  <span className="text-xs font-semibold sm:text-sm">{count.unit}</span>
                </div>
                <div className="mt-0.5 inline-block rounded bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-700 sm:mt-1 sm:px-2 sm:text-xs">({count.note})</div>
              </div>
            </div>
            <div className="pl-2 text-center sm:pl-3">
              <div className="text-xl font-extrabold text-brand-700 tabular-nums sm:text-2xl">{side.value}</div>
              <div className="text-[11px] text-slate-600 sm:text-xs">{side.label}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
