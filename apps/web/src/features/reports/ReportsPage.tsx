import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, ROLES, type ReportBranchRow, type ReportCcoRow, type ReportDto, type ReportEngineerRow } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { inputClass } from '@/components/ui/Field';
import { FilterBar } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/features/auth/auth-context';
import { FranchisePicker, type FranchiseSelection } from '@/features/dashboard/FranchisePicker';
import { StatCard } from '@/features/dashboard/StatCard';
import { api } from '@/lib/api-client';
import { toQueryString } from '@/lib/crud';
import { downloadCsv } from '@/lib/csv';
import { formatCurrency, todayIso } from '@/lib/format';

type Tab = 'branches' | 'engineers' | 'ccos';
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
const num = (v: number | null, suffix = '') => (v === null ? '—' : `${v}${suffix}`);

export function ReportsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const monthStart = `${todayIso().slice(0, 8)}01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayIso());
  const [scope, setScope] = useState<FranchiseSelection>({ stateId: '', cityId: '', branchId: '' });
  const [tab, setTab] = useState<Tab>('branches');

  const params = { from, to, ...scope };
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', params],
    queryFn: () => api.get<ReportDto>(`/reports?${toQueryString(params)}`),
  });

  const lastMonth = () => {
    const d = new Date(`${monthStart}T00:00:00`);
    d.setMonth(d.getMonth() - 1);
    const start = d.toISOString().slice(0, 10).slice(0, 8) + '01';
    const end = new Date(new Date(`${monthStart}T00:00:00`).getTime() - 86_400_000);
    setFrom(start);
    setTo(new Intl.DateTimeFormat('en-CA').format(end));
  };

  const period = `${from}_to_${to}`;
  const branchColumns: Column<ReportBranchRow>[] = [
    { header: 'Branch', cell: (r) => <span className="font-medium">{r.branch.name} <span className="text-slate-500">({r.branch.code})</span></span> },
    { header: 'City', cell: (r) => `${r.branch.city}, ${r.branch.state}` },
    { header: 'In', cell: (r) => r.received },
    { header: 'Out', cell: (r) => r.delivered },
    { header: 'Repaired', cell: (r) => r.repairedDelivered },
    { header: 'RWR', cell: (r) => r.rwrDelivered },
    { header: 'Pending now', cell: (r) => r.pendingNow },
    { header: '15+ days', cell: (r) => <span className={r.overdueNow ? 'font-semibold text-red-600' : ''}>{r.overdueNow}</span> },
    { header: 'Same day', cell: (r) => pct(r.sameDayPct) },
    { header: 'Avg TAT', cell: (r) => num(r.avgTatDays, ' d') },
    { header: 'To L4', cell: (r) => r.sentToL4 },
    { header: 'Revenue', className: 'text-right', cell: (r) => formatCurrency(r.revenue) },
  ];
  const engineerColumns: Column<ReportEngineerRow>[] = [
    { header: 'Engineer', cell: (r) => <span className="font-medium">{r.engineer.name}{!r.engineer.isActive && <span className="text-xs text-slate-400"> (inactive)</span>}</span> },
    { header: 'Branch', cell: (r) => r.engineer.branchCode },
    { header: 'Pending', cell: (r) => r.pending },
    { header: 'Done', cell: (r) => r.done },
    { header: 'Testing', cell: (r) => r.testing },
    { header: 'Spare N/A', cell: (r) => r.spareNotAvailable },
    { header: 'Returned OK', cell: (r) => <span className="font-semibold text-emerald-700">{r.returnedOk}</span> },
    { header: 'RWR', cell: (r) => r.rwr },
    { header: 'Transferred out', cell: (r) => r.transfersOut },
    { header: 'Avg repair time', cell: (r) => num(r.avgRepairHours, ' h') },
  ];
  const ccoColumns: Column<ReportCcoRow>[] = [
    { header: 'Name', cell: (r) => <span className="font-medium">{r.user.name}</span> },
    { header: 'Role', cell: (r) => ROLE_LABELS[r.user.role] },
    { header: 'Branch', cell: (r) => r.user.branchCode },
    { header: 'Job sheets', cell: (r) => r.received },
    { header: '…of which delivered', cell: (r) => r.deliveredOfReceived },
    { header: 'Approvals confirmed', cell: (r) => r.approvalsConfirmed },
    { header: 'Deliveries done', cell: (r) => r.deliveriesDone },
    { header: 'Advance collected', className: 'text-right', cell: (r) => formatCurrency(r.advanceCollected) },
    { header: 'Revenue', className: 'text-right', cell: (r) => formatCurrency(r.revenue) },
  ];

  const exportTab = () => {
    if (!data) return;
    if (tab === 'branches')
      downloadCsv(`branch-report_${period}.csv`, ['Branch', 'Code', 'City', 'State', 'In', 'Out', 'Repaired', 'RWR', 'Pending now', '15+ days', 'Same day %', 'Avg TAT (days)', 'Sent to L4', 'Revenue'],
        data.branches.map((r) => [r.branch.name, r.branch.code, r.branch.city, r.branch.state, r.received, r.delivered, r.repairedDelivered, r.rwrDelivered, r.pendingNow, r.overdueNow, r.sameDayPct, r.avgTatDays, r.sentToL4, r.revenue]));
    if (tab === 'engineers')
      downloadCsv(`engineer-report_${period}.csv`, ['Engineer', 'Branch', 'Pending', 'Done', 'Testing', 'Spare not available', 'Returned OK', 'RWR', 'Transferred out', 'Avg repair hours'],
        data.engineers.map((r) => [r.engineer.name, r.engineer.branchCode, r.pending, r.done, r.testing, r.spareNotAvailable, r.returnedOk, r.rwr, r.transfersOut, r.avgRepairHours]));
    if (tab === 'ccos')
      downloadCsv(`cco-report_${period}.csv`, ['Name', 'Role', 'Branch', 'Job sheets', 'Delivered of those', 'Approvals confirmed', 'Deliveries done', 'Advance collected', 'Revenue'],
        data.ccos.map((r) => [r.user.name, ROLE_LABELS[r.user.role], r.user.branchCode, r.received, r.deliveredOfReceived, r.approvalsConfirmed, r.deliveriesDone, r.advanceCollected, r.revenue]));
  };

  const s = data?.summary;
  let table: ReactNode = null;
  if (data) {
    if (tab === 'branches') table = <DataTable columns={branchColumns} rows={data.branches} rowKey={(r) => r.branch.id} emptyMessage="No branches" />;
    if (tab === 'engineers') table = <DataTable columns={engineerColumns} rows={data.engineers} rowKey={(r) => r.engineer.id} emptyMessage="No engineers" />;
    if (tab === 'ccos') table = <DataTable columns={ccoColumns} rows={data.ccos} rowKey={(r) => r.user.id} emptyMessage="No counter staff" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" description="Branch, engineer and CCO performance for a period" />
      {isSuperAdmin && <FranchisePicker value={scope} onChange={setScope} />}
      <FilterBar>
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" className={`${inputClass} w-40!`} />
        <span className="text-slate-500">to</span>
        <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} aria-label="To" className={`${inputClass} w-40!`} />
        <Button variant="secondary" size="sm" onClick={() => (setFrom(todayIso()), setTo(todayIso()))}>Today</Button>
        <Button variant="secondary" size="sm" onClick={() => (setFrom(monthStart), setTo(todayIso()))}>This month</Button>
        <Button variant="secondary" size="sm" onClick={lastMonth}>Last month</Button>
      </FilterBar>
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {s && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Total in" value={s.received} tone="info" />
          <StatCard label={`Total out (${s.repairedDelivered} repaired · ${s.rwrDelivered} RWR)`} value={s.delivered} tone="info" />
          <StatCard label="Pending now" value={s.pendingNow} tone="warning" />
          <StatCard label="Over 15 days" value={s.overdueNow} tone="warning" />
          <StatCard label="Revenue" value={formatCurrency(s.revenue)} />
          <StatCard label="Same-day delivery" value={pct(s.sameDayPct)} />
          <StatCard label="Avg turnaround" value={num(s.avgTatDays, ' days')} />
          <StatCard label="Sent to L4" value={s.sentToL4} />
        </div>
      )}
      <Card
        title={undefined}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
            {([['branches', 'Branch-wise'], ['engineers', 'Engineer-wise'], ['ccos', 'CCO-wise']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-3 py-1.5 ${tab === t ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
                {label}
              </button>
            ))}
          </div>
          <Button variant="secondary" disabled={!data} onClick={exportTab}>
            ⬇ Export to Excel
          </Button>
        </div>
        {table}
        <p className="mt-3 text-xs text-slate-500">
          “In/Out/Revenue/Returned OK/RWR” count the selected period. “Pending now”, “15+ days”, “Done”, “Testing”, “Spare N/A” are live counts right now.
        </p>
      </Card>
    </div>
  );
}
