import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileText } from 'lucide-react';
import { ROLES, type AreaStatRow } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { inputClass } from '@/components/ui/Field';
import { FilterBar } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { QuickDateRange } from '@/components/ui/QuickDateRange';
import { useAuth } from '@/features/auth/auth-context';
import { FranchisePicker, type FranchiseSelection } from '@/features/dashboard/FranchisePicker';
import { api } from '@/lib/api-client';
import { toQueryString } from '@/lib/crud';
import { formatCurrency, todayIso } from '@/lib/format';
import { openPrintWindow, writeTable } from '@/lib/print-table';
import { downloadXlsx } from '@/lib/xlsx';

type Level = 'city' | 'village';

/** Job sheets by customer area: City-wise and Gaon-wise. */
export function AreaStatsPage() {
  const { user } = useAuth();
  // Money is for the Branch Manager and Super Admin; the CCO sees job counts.
  const showMoney = user?.role === ROLES.SUPER_ADMIN || user?.role === ROLES.BRANCH_MANAGER;
  const [level, setLevel] = useState<Level>('city');
  const [from, setFrom] = useState(`${todayIso().slice(0, 8)}01`);
  const [to, setTo] = useState(todayIso());
  const [scope, setScope] = useState<FranchiseSelection>({ stateId: '', cityId: '', branchId: '' });
  const [search, setSearch] = useState('');
  const params = { from, to, ...scope, level };
  const q = useQuery({ queryKey: ['reports', 'area-stats', params], queryFn: () => api.get<AreaStatRow[]>(`/reports/area-stats?${toQueryString(params)}`) });

  const term = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((r) => !term || [r.village, r.city, r.district, r.state].some((v) => v?.toLowerCase().includes(term)));
  const totals = rows.reduce((t, r) => ({ total: t.total + r.total, open: t.open + r.open, delivered: t.delivered + r.delivered }), { total: 0, open: 0, delivered: 0 });

  const columns: Column<AreaStatRow>[] = [
    ...(level === 'village' ? [{ header: 'Gaon', cell: (r: AreaStatRow) => <span className={`font-medium ${r.village ? '' : 'text-slate-400'}`}>{r.village ?? 'Not entered'}</span> }] : []),
    { header: 'City / Taluka', cell: (r) => <span className={`${level === 'city' ? 'font-medium' : ''} ${r.city ? '' : 'text-slate-400'}`}>{r.city ?? 'Not entered'}</span> },
    { header: 'District', cell: (r) => r.district ?? '—' },
    { header: 'State', cell: (r) => r.state ?? '—' },
    { header: 'Job sheets', className: 'text-right', cell: (r) => <span className="font-semibold">{r.total}</span> },
    { header: 'Mobile', className: 'text-right', cell: (r) => r.mobile },
    { header: 'Accessory', className: 'text-right', cell: (r) => r.accessory },
    { header: 'Walk-in', className: 'text-right', cell: (r) => r.walkIn },
    { header: 'Retailer', className: 'text-right', cell: (r) => r.retailer },
    { header: 'Open', className: 'text-right', cell: (r) => r.open },
    { header: 'Delivered', className: 'text-right', cell: (r) => r.delivered },
    { header: 'RWR', className: 'text-right', cell: (r) => r.rwr },
    { header: 'Cancelled', className: 'text-right', cell: (r) => r.cancelled },
    ...(showMoney ? [{ header: 'Invoiced', className: 'text-right', cell: (r: AreaStatRow) => formatCurrency(r.revenue ?? 0) }] : []),
  ];

  const title = level === 'city' ? 'City-wise stats' : 'Gaon-wise stats';
  const headers = [...(level === 'village' ? ['Gaon'] : []), 'City / Taluka', 'District', 'State', 'Job sheets', 'Mobile', 'Accessory', 'Walk-in', 'Retailer', 'Open', 'Delivered', 'RWR', 'Cancelled', ...(showMoney ? ['Invoiced'] : [])];
  const exportRows = () =>
    rows.map((r) => [...(level === 'village' ? [r.village ?? 'Not entered'] : []), r.city ?? 'Not entered', r.district, r.state, r.total, r.mobile, r.accessory, r.walkIn, r.retailer, r.open, r.delivered, r.rwr, r.cancelled, ...(showMoney ? [r.revenue] : [])]);
  const pdf = () => {
    const win = openPrintWindow();
    if (!win) return toast.error('Allow pop-ups to download the PDF');
    writeTable(win, { title, subtitle: `${from} to ${to}`, headers, rows: exportRows(), landscape: true });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="City & Gaon Stats"
        description="Where job sheets come from, by city and by gaon"
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={!rows.length} onClick={() => void downloadXlsx(`${level}_stats_${from}_${to}.xlsx`, headers, exportRows(), title)}><Download className="size-4" /> Excel</Button>
            <Button variant="secondary" size="sm" disabled={!rows.length} onClick={pdf}><FileText className="size-4" /> PDF</Button>
          </>
        }
      />
      {user?.role === ROLES.SUPER_ADMIN && <FranchisePicker value={scope} onChange={setScope} />}
      <FilterBar>
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {([['city', 'City-wise'], ['village', 'Gaon-wise']] as [Level, string][]).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={level === v} onClick={() => setLevel(v)} className={`rounded px-3 py-1.5 ${level === v ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>{label}</button>
          ))}
        </div>
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" className={`${inputClass} w-40!`} />
        <span className="text-slate-500">to</span>
        <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} aria-label="To" className={`${inputClass} w-40!`} />
        <QuickDateRange onSelect={(f, t) => (setFrom(f), setTo(t))} allowAll={false} label={false} />
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search area" placeholder="Search gaon, city, district" className={`${inputClass} w-64!`} />
      </FilterBar>
      {q.error && <p className="text-sm text-red-600">{q.error.message}</p>}
      <Card title={`${title} · ${rows.length} area${rows.length === 1 ? '' : 's'} · ${totals.total} job sheets (${totals.open} open, ${totals.delivered} delivered)`}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => [r.state, r.district, r.city, r.village].join('|')} isLoading={q.isLoading} emptyMessage="No job sheets in this period" minTableWidth="1100px" />
      </Card>
    </div>
  );
}
