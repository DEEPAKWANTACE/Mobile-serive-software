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
    <section className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:p-4" aria-label="Payment summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Payment Summary</h2>
          <p className="text-sm text-slate-500">
            {anyPeriod ? 'Choose any date or range for collection, expenses and net amount' : 'Collection, expenses and net amount for the latest 2 days'}
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <CalendarDays className="size-4 text-slate-500" /> {todayLabel}
          </span>
          <span className="h-5 w-px bg-slate-200" />
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4 text-slate-500" /> {branchName}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Payment summary period">
        {shown.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              setFrom(p.from);
              setTo(p.to);
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
              active?.key === p.key ? 'bg-brand-600 text-white ring-brand-600 shadow-sm' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100'
            }`}
          >
            {p.label}
          </button>
        ))}
        {anyPeriod && (
          <>
            <label className="ml-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              From
              <input type="date" aria-label="Payment summary from date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} w-36!`} />
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              To
              <input type="date" aria-label="Payment summary to date" value={to} min={from || undefined} max={todayIso()} onChange={(e) => setTo(e.target.value)} className={`${inputClass} w-36!`} />
            </label>
          </>
        )}
      </div>

      {summary.error && <p className="mt-3 text-sm text-red-600">{summary.error.message}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Box
          tone="blue"
          icon={Wallet}
          title="Total Collection"
          subtitle={`Cash + Online received · ${periodLabel}`}
          amount={rupees(d?.collection.total)}
          chip={d && <><Phone className="size-4" /> {plural(d.collection.deliveredCount, 'Delivered Call')}</>}
          left={{ label: 'Cash Received', value: rupees(d?.collection.cash) }}
          right={{ label: 'Online Received', value: rupees(d?.collection.online) }}
          to={dayBook('received')}
        />
        <Box
          tone="orange"
          icon={ReceiptText}
          title="Total Expenses"
          subtitle={periodLabel}
          amount={rupees(d?.expenses.total)}
          chip={d && <><Coins className="size-4" /> {d.expenses.count} Expense {d.expenses.count === 1 ? 'Entry' : 'Entries'}</>}
          left={{ label: 'Cash Expenses', value: rupees(d?.expenses.cash) }}
          right={{ label: 'Online Expenses', value: rupees(d?.expenses.online) }}
          to={dayBook('expenses')}
        />
        <Box
          tone="green"
          icon={TrendingUp}
          title="Net Available Amount"
          subtitle={`Collection – Expenses · ${periodLabel}`}
          amount={rupees(d?.net.total)}
          left={{ label: 'Net Cash', value: rupees(d?.net.cash) }}
          right={{ label: 'Net Online', value: rupees(d?.net.online) }}
          to={dayBook('net')}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Box
          tone="purple"
          icon={Wrench}
          title="To Repair Pending (Approved)"
          subtitle="Customer approved, repair pending"
          count={{ value: d?.approvedUnderRepairCount, unit: 'Calls / Phones', note: 'Approved' }}
          side={{ label: 'Approved Amount', value: rupees(d?.approvedUnderRepairAmount) }}
          to={jobs({ statuses: APPROVED_REPAIR_PENDING_STATUSES.join(','), sort: 'oldest' })}
        />
        <Box
          tone="teal"
          icon={Package}
          title="Ready to Collect"
          subtitle="Repaired, waiting for customer"
          count={{ value: d?.readyToCollectCount, unit: 'Phones', note: 'Pending Delivery' }}
          side={{ label: 'Pending Amount', value: rupees(d?.readyToCollectAmount) }}
          to={jobs({ status: 'READY_FOR_DELIVERY', sort: 'oldest' })}
        />
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-sm text-slate-700 ring-1 ring-blue-100">
        <Info className="mt-0.5 size-4 shrink-0 text-blue-600" />
        <span>
          <strong>Note:</strong> To Repair Pending and Ready to Collect show all pending calls until repair/delivery is completed, irrespective of date.
        </span>
      </p>
    </section>
  );
}

const tones = {
  blue: { band: 'bg-blue-600', text: 'text-blue-900', chip: 'bg-blue-50 text-blue-900', button: 'bg-blue-600 hover:bg-blue-700', ring: 'ring-blue-200' },
  orange: { band: 'bg-orange-500', text: 'text-red-700', chip: 'bg-orange-50 text-orange-900', button: 'bg-orange-500 hover:bg-orange-600', ring: 'ring-orange-200' },
  green: { band: 'bg-green-700', text: 'text-green-800', chip: 'bg-green-50 text-green-900', button: 'bg-green-700 hover:bg-green-800', ring: 'ring-green-200' },
  purple: { band: 'bg-violet-700', text: 'text-violet-900', chip: 'bg-violet-50 text-violet-900', button: 'bg-violet-700 hover:bg-violet-800', ring: 'ring-violet-200' },
  teal: { band: 'bg-teal-600', text: 'text-teal-800', chip: 'bg-teal-50 text-teal-900', button: 'bg-teal-600 hover:bg-teal-700', ring: 'ring-teal-200' },
} as const;

type Pair = { label: string; value: string };

function Box({
  tone,
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
  tone: keyof typeof tones;
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
  const t = tones[tone];
  return (
    <div className={`flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ${t.ring}`}>
      <div className={`flex items-center gap-3 px-4 py-3 text-white ${t.band}`}>
        <Icon className="size-8 shrink-0" />
        <div className="min-w-0">
          <div className="text-base leading-tight font-bold">{title}</div>
          <div className="text-xs leading-tight text-white/90">{subtitle}</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col px-4 py-4">
        {amount !== undefined && <div className={`text-center text-3xl font-extrabold tabular-nums sm:text-4xl ${t.text}`}>{amount}</div>}
        {chip && <div className={`mt-3 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${t.chip}`}>{chip}</div>}
        {left && right && (
          <div className="mt-3 grid grid-cols-2 divide-x divide-slate-200 text-center">
            {[left, right].map((pair) => (
              <div key={pair.label} className="px-2">
                <div className="text-xs text-slate-600">{pair.label}</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">{pair.value}</div>
              </div>
            ))}
          </div>
        )}
        {count && side && (
          <div className="grid grid-cols-2 items-center divide-x divide-slate-200">
            <div className="flex items-center gap-3 pr-3">
              <Smartphone className={`size-10 shrink-0 ${t.text}`} />
              <div>
                <div className="text-slate-900">
                  <span className="text-3xl font-extrabold tabular-nums">{count.value ?? '–'}</span> <span className="text-sm font-semibold">{count.unit}</span>
                </div>
                <div className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ${t.chip}`}>({count.note})</div>
              </div>
            </div>
            <div className="pl-3 text-center">
              <div className={`text-2xl font-extrabold tabular-nums sm:text-3xl ${t.text}`}>{side.value}</div>
              <div className="text-xs text-slate-600">{side.label}</div>
            </div>
          </div>
        )}
        <div className="mt-auto pt-4 text-center">
          <Link to={to} className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm ${t.button}`}>
            <List className="size-4" /> View Details <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
