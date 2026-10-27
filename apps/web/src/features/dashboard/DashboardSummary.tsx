import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, CalendarRange, Hourglass, IndianRupee, LayoutList, Wrench } from 'lucide-react';
import type { DashboardSummaryDto } from '@msm/shared';
import { Card } from '@/components/ui/Card';
import { inputClass } from '@/components/ui/Field';
import { api } from '@/lib/api-client';
import { toQueryString } from '@/lib/crud';
import { formatCurrency, todayIso } from '@/lib/format';
import { DashboardMetricList } from './DashboardMetricList';

/**
 * The old system's summary strip: All / Datewise, Total In, Total Out, Total Balance,
 * More than 15 days and Pending works — each tile opens the matching Job Master list.
 */
export function DashboardSummary({ branchId, linkable = true }: { branchId?: string; /** false for roles without Job Master access. */ linkable?: boolean }) {
  const [mode, setMode] = useState<'all' | 'date'>('all');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const range = mode === 'date' ? { from, to } : {};
  const summary = useQuery({
    queryKey: ['reports', 'dashboard-summary', branchId, range],
    queryFn: () => api.get<DashboardSummaryDto>(`/reports/dashboard-summary?${toQueryString({ ...range, branchId })}`),
  });
  const d = summary.data;
  const jobs = (extra: Record<string, string> = {}) =>
    linkable ? `/jobs?${toQueryString({ ...range, ...extra })}` : undefined;
  const money = (v?: number) => (v === undefined ? undefined : formatCurrency(v));

  return (
    <Card
      title="Job summary"
      subtitle={mode === 'all' ? 'All jobs' : 'Jobs received in the selected dates'}
      icon={LayoutList}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
            {(['all', 'date'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1 font-medium ${mode === m ? 'bg-white shadow-sm' : 'text-slate-600'}`}
              >
                {m === 'all' ? 'All' : 'Datewise'}
              </button>
            ))}
          </div>
          {mode === 'date' && (
            <>
              <input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} w-36!`} />
              <input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={`${inputClass} w-36!`} />
            </>
          )}
        </div>
      }
    >
      <DashboardMetricList
        items={[
          { key: 'in', label: 'Total in', value: d?.totalIn, to: jobs(), tone: 'brand', icon: ArrowDownToLine, hint: 'Jobs received' },
          { key: 'out', label: 'Total out', value: d?.totalOut, to: jobs({ view: 'out' }), tone: 'good', icon: ArrowUpFromLine, hint: 'Delivered' },
          { key: 'pending', label: 'Pending works', value: d?.pending, to: jobs({ view: 'pending' }), icon: Wrench, hint: d ? `${d.underRepair} with engineers` : undefined },
          { key: 'over15', label: 'More than 15 days', value: d?.over15Days, to: jobs({ view: 'over15' }), tone: d?.over15Days ? 'critical' : 'default', icon: Hourglass, hint: 'Still open' },
          { key: 'amount', label: 'Total amount', value: money(d?.totalAmount), to: jobs(), icon: IndianRupee, hint: d ? `${money(d.totalPaid)} paid` : undefined },
          { key: 'balance', label: 'Total balance', value: money(d?.totalBalance), to: jobs({ view: 'balance' }), tone: d?.totalBalance ? 'warning' : 'default', icon: CalendarRange, hint: 'To collect' },
        ]}
      />
      {!!d?.engineerPending.length && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Engineer-wise pending</div>
          <DashboardMetricList
            valueLabel="Pending"
            items={d.engineerPending.map((e) => ({
              key: e.engineerId,
              label: e.engineer,
              value: e.pending,
              to: jobs({ view: 'pending', engineer: e.engineerId }),
            }))}
          />
        </div>
      )}
    </Card>
  );
}
