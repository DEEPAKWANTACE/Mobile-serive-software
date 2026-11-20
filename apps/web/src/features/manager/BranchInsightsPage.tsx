import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { toast } from 'sonner';
import {
  CALL_OUTCOME_LABELS,
  CALL_PURPOSE_LABELS,
  JOB_STATUS_LABELS,
  type CallOutcome,
  type CallPurpose,
  type CallingReportDto,
  type CallRecordsResult,
  type ReturnNoteDto,
  type DiagnosisPendingRowDto,
  type JobStatus,
  type ManagerAlertDto,
  type ManagerOverviewDto,
  type PendingJobRowDto,
  type PoRowDto,
  type ProfitLossDto,
  type ProfitLossRowDto,
  type PurchaseOrderDto,
  type StockOverviewDto,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { inputClass } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { QuickDateRange } from '@/components/ui/QuickDateRange';
import { BranchScopePicker } from '@/features/accounts/BranchScopePicker';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { api } from '@/lib/api-client';
import { toQueryString } from '@/lib/crud';
import { formatCurrency, formatDate, formatDateTime, todayIso } from '@/lib/format';
import { openPrintWindow, writeTable } from '@/lib/print-table';
import { downloadXlsx } from '@/lib/xlsx';

type Cell = string | number | null | undefined;
type Tab = 'overview' | 'pending' | 'diagnosis' | 'calling' | 'returnNotes' | 'po' | 'stock' | 'pnl';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'pending', label: 'Pending 15+ days' },
  { key: 'diagnosis', label: 'Diagnosis pending' },
  { key: 'calling', label: 'Calling & Happy Calling' },
  { key: 'returnNotes', label: 'Return Notes' },
  { key: 'po', label: 'Purchase Order' },
  { key: 'stock', label: 'Stock' },
  { key: 'pnl', label: 'Profit & Loss' },
];

const statusLabel = (s: string) => JOB_STATUS_LABELS[s as JobStatus] ?? s;
const monthStart = () => `${todayIso().slice(0, 8)}01`;
const weekStart = () => todayIso(-6);
const slug = (t: string) => t.replace(/\W+/g, '_').toLowerCase();

function ExportButtons({ title, subtitle, headers, rows }: { title: string; subtitle: string; headers: string[]; rows: Cell[][] }) {
  const pdf = () => {
    const win = openPrintWindow();
    if (!win) return toast.error('Allow pop-ups to download the PDF');
    writeTable(win, { title, subtitle, headers, rows, landscape: headers.length > 6 });
  };
  return (
    <div className="flex gap-2">
      <Button type="button" variant="secondary" size="sm" disabled={!rows.length} onClick={() => void downloadXlsx(`${slug(title)}_${todayIso()}.xlsx`, headers, rows, title)}>
        <Download className="size-4" /> Excel
      </Button>
      <Button type="button" variant="secondary" size="sm" disabled={!rows.length} onClick={pdf}>
        <FileText className="size-4" /> PDF
      </Button>
    </div>
  );
}

const jobLink = (id: string, no: string) => (
  <Link to={`/jobs/${id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">
    {no}
  </Link>
);

type Range = { from: string; to: string };
function RangePicker({ range, setRange, weekly }: { range: Range; setRange: (r: Range) => void; weekly?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <QuickDateRange allowAll={false} label={false} onSelect={(from, to) => setRange({ from, to })} />
      {weekly && (
        <Button type="button" variant="secondary" size="sm" onClick={() => setRange({ from: weekStart(), to: todayIso() })}>
          Last 7 days
        </Button>
      )}
      <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className={`${inputClass} w-40!`} aria-label="From" />
      <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className={`${inputClass} w-40!`} aria-label="To" />
    </div>
  );
}

const tile = (label: string, value: string, tone = '') => (
  <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
    <div className="text-xs font-semibold text-slate-500 uppercase">{label}</div>
    <div className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
  </div>
);

const PRIORITY_CLS = { HIGH: 'border-red-200 bg-red-50 text-red-800', MEDIUM: 'border-amber-200 bg-amber-50 text-amber-900', LOW: 'border-slate-200 bg-slate-50 text-slate-700' } as const;

/** Priority-coloured alert list; also used on the dashboard. */
export function ManagerAlerts({ branchId = '' }: { branchId?: string }) {
  const q = useQuery({
    queryKey: ['manager', 'alerts', branchId],
    queryFn: () => api.get<ManagerAlertDto[]>(`/manager/alerts?${toQueryString({ branchId })}`),
    refetchInterval: 120_000,
  });
  const items = q.data ?? [];
  return (
    <Card title={`Alerts${items.length ? ` (${items.length})` : ''}`}>
      {q.isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-emerald-700">All clear — nothing needs your attention.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((a) => (
            <li key={a.key}>
              <Link to={a.link} className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:opacity-90 ${PRIORITY_CLS[a.priority]}`}>
                <span>
                  <span className="mr-2 rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold">{a.priority}</span>
                  {a.label}
                </span>
                <span className="text-lg font-semibold tabular-nums">{a.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OverviewTab({ branchId }: { branchId: string }) {
  const [range, setRange] = useState<Range>({ from: todayIso(), to: todayIso() });
  const q = useQuery({
    queryKey: ['manager', 'overview', range, branchId],
    queryFn: () => api.get<ManagerOverviewDto>(`/manager/overview?${toQueryString({ ...range, branchId })}`),
  });
  const d = q.data;
  return (
    <div className="space-y-4">
      <ManagerAlerts branchId={branchId} />
      <RangePicker range={range} setRange={setRange} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {tile('Jobs received', String(d.jobsReceived))}
            {tile('Jobs completed (delivered)', String(d.jobsCompleted))}
            {tile('Pending jobs (open now)', String(d.jobsPending))}
            {tile('Pending approvals', String(d.pendingApprovals))}
            {tile('Collection', formatCurrency(d.collection.total), 'text-emerald-700')}
            {tile('Cash / online', `${formatCurrency(d.collection.cash)} / ${formatCurrency(d.collection.online)}`)}
            {tile('Expenses', formatCurrency(d.expenses))}
            {tile('Customer payments pending', formatCurrency(d.pendingPayments), 'text-amber-700')}
            {tile('Stock value (cost)', formatCurrency(d.stock.value))}
            {tile('Stock items / units', `${d.stock.items} / ${d.stock.units}`)}
            {tile('Low-stock items', String(d.stock.lowCount), d.stock.lowCount ? 'text-red-600' : '')}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Engineer-wise performance">
              <DataTable
                columns={[
                  { header: 'Engineer', cell: (r: ManagerOverviewDto['engineers'][number]) => r.name },
                  { header: 'Assigned', className: 'text-right', cell: (r) => r.assigned },
                  { header: 'Repaired', className: 'text-right', cell: (r) => r.completed },
                  { header: 'Open now', className: 'text-right', cell: (r) => r.open },
                ]}
                rows={d.engineers}
                rowKey={(r) => r.name}
                emptyMessage="No engineer activity"
              />
            </Card>
            <Card title="CCO-wise performance">
              <DataTable
                columns={[
                  { header: 'CCO', cell: (r: ManagerOverviewDto['ccos'][number]) => r.name },
                  { header: 'Job sheets', className: 'text-right', cell: (r) => r.jobSheets },
                  { header: 'Calls logged', className: 'text-right', cell: (r) => r.calls },
                ]}
                rows={d.ccos}
                rowKey={(r) => r.name}
                emptyMessage="No CCO activity"
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function PendingTab({ branchId }: { branchId: string }) {
  const [days, setDays] = useState(15);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useQuery({
    queryKey: ['manager', 'pending', days, status, from, to, branchId],
    queryFn: () => api.get<PendingJobRowDto[]>(`/manager/pending-jobs?${toQueryString({ days, status, from, to, branchId })}`),
  });
  const rows = q.data ?? [];
  const columns: Column<PendingJobRowDto>[] = [
    { header: 'Job No', cell: (r) => jobLink(r.id, r.jobNumber) },
    { header: 'Customer', cell: (r) => r.customer },
    { header: 'Model', cell: (r) => r.model },
    { header: 'IMEI', cell: (r) => r.imei ?? '—' },
    { header: 'Login date', cell: (r) => formatDate(r.loginDate) },
    { header: 'Status', cell: (r) => <JobStatusBadge status={r.status as JobStatus} /> },
    { header: 'Pending days', className: 'text-right', cell: (r) => <span className={`font-semibold tabular-nums ${r.pendingDays > 30 ? 'text-red-600' : 'text-amber-600'}`}>{r.pendingDays}</span> },
    { header: 'Engineer', cell: (r) => r.engineer ?? '—' },
  ];
  const statuses = Object.keys(JOB_STATUS_LABELS).filter((s) => s !== 'DELIVERED' && s !== 'CANCELLED');
  return (
    <Card
      title={`Jobs pending more than ${days} days (${rows.length})`}
      actions={
        <ExportButtons
          title={`Pending jobs over ${days} days`}
          subtitle={status ? statusLabel(status) : 'All open statuses'}
          headers={['Job No', 'Customer', 'Model', 'IMEI', 'Login date', 'Status', 'Pending days', 'Engineer']}
          rows={rows.map((r) => [r.jobNumber, r.customer, r.model, r.imei, formatDate(r.loginDate), statusLabel(r.status), r.pendingDays, r.engineer])}
        />
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold text-slate-500 uppercase">Older than</label>
        <input type="number" min={1} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 15))} className={`${inputClass} w-20!`} />
        <span className="text-sm text-slate-500">days</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputClass} w-48!`}>
          <option value="">All open statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} w-40!`} aria-label="Login from" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} w-40!`} aria-label="Login to" />
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={q.isLoading} emptyMessage="No old pending jobs" />
    </Card>
  );
}

function DiagnosisTab({ branchId }: { branchId: string }) {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<Range>({ from: todayIso(), to: todayIso() });
  const q = useQuery({
    queryKey: ['manager', 'diagnosis', range, branchId],
    queryFn: () => api.get<DiagnosisPendingRowDto[]>(`/manager/diagnosis-pending?${toQueryString({ ...range, branchId })}`),
  });
  const remark = useMutation({
    mutationFn: (v: { jobId: string; remark: string }) => api.post('/manager/remarks', v),
    onSuccess: () => {
      toast.success('Remark saved');
      void queryClient.invalidateQueries({ queryKey: ['manager', 'diagnosis'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const rows = q.data ?? [];
  const columns: Column<DiagnosisPendingRowDto>[] = [
    { header: 'Job No', cell: (r) => jobLink(r.id, r.jobNumber) },
    { header: 'Login date', cell: (r) => formatDate(r.loginDate) },
    { header: 'Engineer', cell: (r) => r.engineer ?? <span className="text-slate-400">Unassigned</span> },
    { header: 'Customer', cell: (r) => r.customer },
    { header: 'Model', cell: (r) => r.model },
    { header: 'Status', cell: (r) => <JobStatusBadge status={r.status as JobStatus} /> },
    {
      header: 'Type',
      cell: (r) =>
        r.kind === 'SAME_DAY' ? (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">Same-day pending</span>
        ) : (
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">Carried over · {r.daysOpen}d</span>
        ),
    },
    { header: 'Reason', cell: (r) => r.reason },
    {
      header: 'Manager remark',
      cell: (r) => (
        <div className="max-w-56 text-sm">
          {r.remark && <div className="mb-1 text-slate-700">{r.remark}</div>}
          <Button
            variant="link"
            onClick={() => {
              const text = window.prompt(`Remark for ${r.jobNumber} (why was it not diagnosed?)`, '');
              if (text && text.trim().length >= 2) remark.mutate({ jobId: r.id, remark: text.trim() });
            }}
          >
            {r.remark ? 'Add another' : 'Add remark'}
          </Button>
        </div>
      ),
    },
  ];
  return (
    <Card
      title={`Diagnosis pending (${rows.length})`}
      actions={
        <ExportButtons
          title="Diagnosis pending report"
          subtitle={`${formatDate(range.from)} to ${formatDate(range.to)}`}
          headers={['Job No', 'Login date', 'Engineer', 'Customer', 'Model', 'Status', 'Type', 'Reason', 'Manager remark']}
          rows={rows.map((r) => [r.jobNumber, formatDate(r.loginDate), r.engineer ?? 'Unassigned', r.customer, r.model, statusLabel(r.status), r.kind === 'SAME_DAY' ? 'Same-day pending' : `Carried over ${r.daysOpen}d`, r.reason, r.remark])}
        />
      }
    >
      <div className="mb-3">
        <RangePicker range={range} setRange={setRange} />
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={q.isLoading} emptyMessage="Every job in this period has been diagnosed" />
    </Card>
  );
}

/** Loose CSV reader for carrier call logs: finds the phone, date/time and duration columns by their headings. */
function parseCallLog(text: string): { phone: string; calledAt: string; durationSec: number }[] {
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) (out.push(cur.trim()), (cur = ''));
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = split(lines[0]!).map((h) => h.toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iPhone = col(/phone|number|mobile|customer|called/);
  const iTime = col(/time|date|start/);
  const iDur = col(/dur|sec/);
  if (iPhone < 0 || iTime < 0) throw new Error('The file needs a phone/number column and a date/time column');
  const toIso = (v: string) => {
    const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
    let d: Date;
    if (m) {
      let h = Number(m[4]);
      if (m[7]) h = (h % 12) + (m[7].toLowerCase() === 'pm' ? 12 : 0);
      d = new Date(`${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}T${String(h).padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}+05:30`);
    } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v) && !/(z|[+-]\d{2}:?\d{2})$/i.test(v)) {
      d = new Date(`${v.replace(' ', 'T')}${v.length === 16 ? ':00' : ''}+05:30`);
    } else d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  const rows: { phone: string; calledAt: string; durationSec: number }[] = [];
  for (const line of lines.slice(1)) {
    const c = split(line);
    const calledAt = toIso(c[iTime] ?? '');
    const phone = (c[iPhone] ?? '').replace(/\D/g, '');
    if (!calledAt || phone.length < 5) continue;
    rows.push({ phone, calledAt, durationSec: iDur >= 0 ? Math.max(0, Math.round(Number((c[iDur] ?? '0').replace(/[^\d.]/g, '')) || 0)) : 0 });
  }
  return rows;
}

function CallingTab({ branchId }: { branchId: string }) {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<Range>({ from: todayIso(), to: todayIso() });
  const [cco, setCco] = useState('');
  const importLog = useMutation({
    mutationFn: async (file: File) => {
      const records = parseCallLog(await file.text());
      if (!records.length) throw new Error('No usable rows found in that file');
      return api.post<CallRecordsResult>('/manager/call-records', { records: records.slice(0, 5000), branchId: branchId || undefined });
    },
    onSuccess: (r) => {
      toast.success(`${r.inserted} call records added · ${r.verified} logged calls verified`);
      void queryClient.invalidateQueries({ queryKey: ['manager', 'calling'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const q = useQuery({
    queryKey: ['manager', 'calling', range, branchId],
    queryFn: () => api.get<CallingReportDto>(`/manager/calling-report?${toQueryString({ ...range, branchId })}`),
  });
  const d = q.data;
  const ccos = [...new Set((d?.rows ?? []).map((r) => r.cco))].sort();
  const rows = (d?.rows ?? []).filter((r) => !cco || r.cco === cco);
  const columns: Column<CallingReportDto['rows'][number]>[] = [
    { header: 'Date', cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.at)}</span> },
    { header: 'Job', cell: (r) => jobLink(r.jobId, r.jobNumber) },
    { header: 'Customer', cell: (r) => <span>{r.customer}<div className="text-xs text-slate-500"><a href={`tel:${r.phone}`} className="hover:underline">{r.phone}</a></div></span> },
    { header: 'CCO', cell: (r) => r.cco },
    { header: 'Purpose', cell: (r) => CALL_PURPOSE_LABELS[r.purpose as CallPurpose] ?? r.purpose },
    {
      header: 'Status',
      cell: (r) => <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${r.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{CALL_OUTCOME_LABELS[r.outcome as CallOutcome] ?? r.outcome}</span>,
    },
    { header: 'Discussion', cell: (r) => <span className="block max-w-56">{r.discussion ?? '—'}</span> },
    { header: 'Feedback', cell: (r) => <span className="block max-w-48">{r.feedback ?? '—'}</span> },
    { header: 'Satisfaction', className: 'text-center', cell: (r) => (r.satisfaction ? `${r.satisfaction}/5` : '—') },
    { header: 'Next follow-up', cell: (r) => (r.nextFollowUpAt ? formatDateTime(r.nextFollowUpAt) : '—') },
    {
      header: 'Record',
      cell: (r) =>
        r.source === 'VERIFIED' ? (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800">Verified</span>
        ) : (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600" title="Entered by staff; not matched to a telephone call record">Manual</span>
        ),
    },
  ];
  const pendingCols: Column<CallingReportDto['pending'][number]>[] = [
    { header: 'Job', cell: (r) => jobLink(r.jobId, r.jobNumber) },
    { header: 'Customer', cell: (r) => r.customer },
    { header: 'Phone', cell: (r) => <a href={`tel:${r.phone}`} className="text-brand-600 hover:underline">📞 {r.phone}</a> },
    { header: 'Status', cell: (r) => <JobStatusBadge status={r.status as JobStatus} /> },
    { header: 'Waiting', className: 'text-right', cell: (r) => `${r.daysWaiting}d` },
  ];
  return (
    <div className="space-y-4">
      <RangePicker range={range} setRange={setRange} />
      {d && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tile('Calls assigned (waiting jobs)', String(d.summary.assigned))}
          {tile('Calls attempted', String(d.summary.attempted))}
          {tile('Connected', String(d.summary.connected), 'text-emerald-700')}
          {tile('Not connected', String(d.summary.notConnected), 'text-red-600')}
          {tile('Calling pending (never called)', String(d.summary.pending), d.summary.pending ? 'text-amber-700' : '')}
          {tile('Follow-ups due', String(d.summary.followUpDue))}
          {tile('Avg satisfaction', d.summary.avgSatisfaction != null ? `${d.summary.avgSatisfaction}/5` : '—')}
          {tile('Verified by call record', String(d.summary.verified))}
        </div>
      )}
      <Card
        title={`Calling records (${rows.length})`}
        actions={
          <ExportButtons
            title="Customer calling report"
            subtitle={`${formatDate(range.from)} to ${formatDate(range.to)}${cco ? ` · ${cco}` : ''}`}
            headers={['Date', 'Job', 'Customer', 'Phone', 'CCO', 'Purpose', 'Status', 'Discussion', 'Feedback', 'Satisfaction', 'Next follow-up', 'Record']}
            rows={rows.map((r) => [formatDateTime(r.at), r.jobNumber, r.customer, r.phone, r.cco, CALL_PURPOSE_LABELS[r.purpose as CallPurpose] ?? r.purpose, CALL_OUTCOME_LABELS[r.outcome as CallOutcome] ?? r.outcome, r.discussion, r.feedback, r.satisfaction, r.nextFollowUpAt ? formatDateTime(r.nextFollowUpAt) : '', r.source === 'VERIFIED' ? 'Verified' : 'Manual'])}
          />
        }
      >
        <div className="mb-3 flex items-center gap-2">
          <select value={cco} onChange={(e) => setCco(e.target.value)} className={`${inputClass} w-48!`}>
            <option value="">All CCOs</option>
            {ccos.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
            {importLog.isPending ? 'Importing…' : 'Import call log (CSV)'}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) importLog.mutate(f); e.target.value = ''; }} />
          </label>
          <span className="text-xs text-slate-500">“Manual” = typed in by staff. Import the carrier / telephone call log (columns: phone number, date-time, duration) and matching calls turn “Verified”.</span>
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={q.isLoading} emptyMessage="No calls logged in this period" minTableWidth="1200px" />
      </Card>
      <Card title={`Calling pending — waiting customers with no call yet (${d?.pending.length ?? 0})`}>
        <DataTable columns={pendingCols} rows={d?.pending} rowKey={(r) => r.jobId} emptyMessage="Every waiting customer has been called" />
      </Card>
    </div>
  );
}

function PoTab({ branchId }: { branchId: string }) {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<Range>({ from: monthStart(), to: todayIso() });
  const [f, setF] = useState({ category: '', subcategory: '', brand: '', model: '', color: '' });
  const q = useQuery({
    queryKey: ['manager', 'po', range, branchId],
    queryFn: () => api.get<PoRowDto[]>(`/manager/purchase-order?${toQueryString({ ...range, branchId })}`),
  });
  const saved = useQuery({
    queryKey: ['manager', 'pos', branchId],
    queryFn: () => api.get<PurchaseOrderDto[]>(`/manager/purchase-orders?${toQueryString({ branchId })}`),
  });
  const create = useMutation({
    mutationFn: () => api.post<PurchaseOrderDto>('/manager/purchase-orders', { ...range, branchId: branchId || undefined }),
    onSuccess: (po) => {
      toast.success(`${po.poNumber} created`);
      void queryClient.invalidateQueries({ queryKey: ['manager'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const forward = useMutation({
    mutationFn: (id: string) => api.post(`/manager/purchase-orders/${id}/forward`, {}),
    onSuccess: () => {
      toast.success('Forwarded to Head Office');
      void queryClient.invalidateQueries({ queryKey: ['manager', 'pos'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const all = q.data ?? [];
  const opts = (pick: (r: PoRowDto) => string | null) => [...new Set(all.map(pick).filter((v): v is string => !!v))].sort();
  const rows = all.filter(
    (r) =>
      (!f.category || r.category === f.category) && (!f.subcategory || r.subcategory === f.subcategory) && (!f.brand || r.brand === f.brand) && (!f.model || r.model === f.model) && (!f.color || r.color === f.color),
  );
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
  const totalAmt = rows.reduce((s, r) => s + r.amount, 0);
  const lineRow = (r: PoRowDto): Cell[] => [r.product, r.partCode, [r.category, r.subcategory].filter(Boolean).join(' > '), r.brand, r.model, r.color, r.quantity, r.unitCost, r.amount];
  const headers = ['Product', 'Part code', 'Category', 'Brand', 'Model', 'Colour', 'PO qty', 'Rate', 'Amount'];
  const columns: Column<PoRowDto>[] = [
    { header: 'Product', cell: (r) => r.product },
    { header: 'Part code', cell: (r) => <span className="font-mono">{r.partCode}</span> },
    { header: 'Category', cell: (r) => [r.category, r.subcategory].filter(Boolean).join(' › ') || '—' },
    { header: 'Brand', cell: (r) => r.brand ?? '—' },
    { header: 'Model', cell: (r) => r.model ?? '—' },
    { header: 'Colour', cell: (r) => r.color ?? '—' },
    { header: 'PO qty', className: 'text-right', cell: (r) => <span className="font-semibold tabular-nums">{r.quantity}</span> },
    { header: 'Rate', className: 'text-right', cell: (r) => <span className="tabular-nums">{formatCurrency(r.unitCost)}</span> },
    { header: 'Amount', className: 'text-right', cell: (r) => <span className="tabular-nums">{formatCurrency(r.amount)}</span> },
  ];
  const sel = (key: keyof typeof f, label: string, values: string[]) => (
    <select key={key} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} className={`${inputClass} w-40!`}>
      <option value="">{label}</option>
      {values.map((v) => (
        <option key={v} value={v}>{v}</option>
      ))}
    </select>
  );
  const poActions = (po: PurchaseOrderDto): ReactNode => (
    <div className="flex flex-wrap items-center gap-2">
      <ExportButtons title={po.poNumber} subtitle={`${formatDate(po.from)} to ${formatDate(po.to)} · ${po.branchCode} · ${po.status === 'FORWARDED' ? 'Forwarded to Head Office' : 'Draft'}`} headers={headers} rows={po.lines.map(lineRow)} />
      {po.status === 'DRAFT' && (
        <Button size="sm" loading={forward.isPending} onClick={() => forward.mutate(po.id)}>
          Forward to Head Office
        </Button>
      )}
    </div>
  );
  return (
    <div className="space-y-4">
      <Card
        title={`Parts consumed, not yet ordered (${totalQty} pcs · ${formatCurrency(totalAmt)})`}
        actions={
          <div className="flex flex-wrap gap-2">
            <ExportButtons title={`Purchase order preview${f.category ? ` - ${f.category}` : ''}`} subtitle={`${formatDate(range.from)} to ${formatDate(range.to)} · parts issued to jobs`} headers={headers} rows={rows.map(lineRow)} />
            <Button size="sm" disabled={!all.length} loading={create.isPending} onClick={() => create.mutate()}>
              Create PO from all ({all.reduce((s, r) => s + r.quantity, 0)} pcs)
            </Button>
          </div>
        }
      >
        <div className="mb-3 space-y-2">
          <RangePicker range={range} setRange={setRange} />
          <div className="flex flex-wrap gap-2">
            {sel('category', 'All categories', opts((r) => r.category))}
            {sel('subcategory', 'All subcategories', opts((r) => r.subcategory))}
            {sel('brand', 'All brands', opts((r) => r.brand))}
            {sel('model', 'All models', opts((r) => r.model))}
            {sel('color', 'All colours', opts((r) => r.color))}
          </div>
          <p className="text-xs text-slate-500">Quantities come from parts actually issued to jobs. Creating a PO marks those parts as ordered, so they can never appear on a second PO. The filters narrow the PDF/Excel download; “Create PO” always covers everything shown above the filters.</p>
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.partId} isLoading={q.isLoading} emptyMessage="Nothing new to order in this period" />
      </Card>
      <Card title="Saved purchase orders">
        {(saved.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No purchase orders yet.</p>
        ) : (
          <div className="space-y-4">
            {(saved.data ?? []).map((po) => (
              <div key={po.id} className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-semibold">{po.poNumber}</span>
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${po.status === 'FORWARDED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{po.status === 'FORWARDED' ? 'Forwarded' : 'Draft'}</span>
                    <div className="text-xs text-slate-500">
                      {formatDate(po.from)} – {formatDate(po.to)} · {po.totalQuantity} pcs · {formatCurrency(po.totalAmount)} · by {po.createdBy}
                      {po.forwardedAt ? ` · forwarded ${formatDateTime(po.forwardedAt)}` : ''}
                    </div>
                  </div>
                  {poActions(po)}
                </div>
                <DataTable columns={columns} rows={po.lines} rowKey={(r) => r.partId} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StockTab({ branchId }: { branchId: string }) {
  const q = useQuery({
    queryKey: ['manager', 'stock', branchId],
    queryFn: () => api.get<StockOverviewDto>(`/manager/stock-overview?${toQueryString({ branchId })}`),
  });
  const d = q.data;
  const columns: Column<StockOverviewDto['low'][number]>[] = [
    { header: 'Part code', cell: (r) => <span className="font-mono">{r.code}</span> },
    { header: 'Product', cell: (r) => r.name },
    { header: 'Colour', cell: (r) => r.color ?? '—' },
    { header: 'In stock', className: 'text-right', cell: (r) => <span className={`font-semibold ${r.quantity === 0 ? 'text-red-600' : 'text-amber-700'}`}>{r.quantity}</span> },
    { header: 'Minimum', className: 'text-right', cell: (r) => r.reorderLevel },
  ];
  return (
    <div className="space-y-4">
      {d && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tile('Part items', String(d.items))}
          {tile('Units in stock', String(d.units))}
          {tile('Stock value (cost)', formatCurrency(d.value))}
          {tile('Low stock', String(d.low.length), d.low.length ? 'text-red-600' : '')}
        </div>
      )}
      <Card
        title={`Low stock alert (${d?.low.length ?? 0})`}
        actions={<ExportButtons title="Low stock" subtitle="At or below minimum level" headers={['Part code', 'Product', 'Colour', 'In stock', 'Minimum']} rows={(d?.low ?? []).map((r) => [r.code, r.name, r.color, r.quantity, r.reorderLevel])} />}
      >
        <DataTable columns={columns} rows={d?.low} rowKey={(r) => r.partId} isLoading={q.isLoading} emptyMessage="No part is below its minimum level" />
        <p className="mt-3 text-xs text-slate-500">Full stock, receiving and the ledger are under Store → Stock, Stock Transfers and Stock Ledger.</p>
      </Card>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: ProfitLossRowDto[] }) {
  const columns: Column<ProfitLossRowDto>[] = [
    { header: title, cell: (r) => r.label },
    { header: 'Qty', className: 'text-right', cell: (r) => r.quantity },
    { header: 'Purchase', className: 'text-right', cell: (r) => formatCurrency(r.purchase) },
    { header: 'Selling', className: 'text-right', cell: (r) => formatCurrency(r.selling) },
    { header: 'Profit', className: 'text-right', cell: (r) => <span className={r.profit < 0 ? 'text-red-600' : 'text-emerald-700'}>{formatCurrency(r.profit)}</span> },
  ];
  return (
    <Card title={title} actions={<ExportButtons title={`Profit by ${title}`} subtitle="" headers={[title, 'Qty', 'Purchase', 'Selling', 'Profit']} rows={rows.map((r) => [r.label, r.quantity, r.purchase, r.selling, r.profit])} />}>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} emptyMessage="No consumption in this period" />
    </Card>
  );
}

function PnlTab({ branchId }: { branchId: string }) {
  const [range, setRange] = useState<Range>({ from: monthStart(), to: todayIso() });
  const q = useQuery({
    queryKey: ['manager', 'pnl', range, branchId],
    queryFn: () => api.get<ProfitLossDto>(`/manager/profit-loss?${toQueryString({ ...range, branchId })}`),
  });
  const d = q.data;
  return (
    <div className="space-y-4">
      <RangePicker range={range} setRange={setRange} weekly />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {tile('Parts consumed', String(d.partsConsumed))}
            {tile('Purchase value', formatCurrency(d.purchaseValue))}
            {tile('Selling value', formatCurrency(d.sellingValue))}
            {tile('Gross profit', formatCurrency(d.grossProfit), d.grossProfit < 0 ? 'text-red-600' : 'text-emerald-700')}
            {tile('Expenses', formatCurrency(d.expenses))}
            {tile('Discounts', formatCurrency(d.discounts))}
            {tile('Refunds (info)', formatCurrency(d.refunds))}
            {tile('Net profit / loss', formatCurrency(d.netProfit), d.netProfit < 0 ? 'text-red-600' : 'text-emerald-700')}
          </div>
          <p className="text-xs text-slate-500">Profit is based on parts actually issued to jobs (selling price at issue minus purchase cost). Net = Gross − Expenses − Discounts; refunds are shown for reference and not deducted again.</p>
          <div className="grid gap-4 xl:grid-cols-2">
            <BreakdownTable title="Brand" rows={d.byBrand} />
            <BreakdownTable title="Category" rows={d.byCategory} />
            <BreakdownTable title="Model" rows={d.byModel} />
            <BreakdownTable title="Part code" rows={d.byPartCode} />
            <BreakdownTable title="Engineer consumption" rows={d.byEngineer} />
          </div>
        </>
      )}
    </div>
  );
}

function ReturnNotesTab({ branchId }: { branchId: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'SUBMITTED' | 'APPROVED' | 'REJECTED'>('SUBMITTED');
  const q = useQuery({
    queryKey: ['manager', 'return-notes', status, branchId],
    queryFn: () => api.get<ReturnNoteDto[]>(`/manager/return-notes?${toQueryString({ status, branchId })}`),
  });
  const decide = useMutation({
    mutationFn: (v: { jobId: string; action: 'approve' | 'reject'; remark?: string }) => api.post(`/manager/return-notes/${v.jobId}/${v.action}`, { remark: v.remark }),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'approve' ? 'Approved — unused parts returned to stock' : 'Sent back to the engineer');
      void queryClient.invalidateQueries({ queryKey: ['manager'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const columns: Column<ReturnNoteDto>[] = [
    { header: 'Job', cell: (r) => <span>{jobLink(r.jobId, r.jobNumber)}<div className="text-xs text-slate-500">{r.device} · {r.customer}</div></span> },
    { header: 'Engineer', cell: (r) => r.engineer ?? '—' },
    {
      header: 'Parts (issued → used)',
      cell: (r) => (
        <ul className="text-sm">
          {r.lines.map((l) => (
            <li key={l.jobPartId}><span className="font-mono">{l.code}</span> {l.name}{l.color ? ` · ${l.color}` : ''}: {l.quantity} → <b>{l.usedQuantity ?? l.quantity}</b></li>
          ))}
        </ul>
      ),
    },
    { header: 'Filed', cell: (r) => (r.submittedAt ? formatDateTime(r.submittedAt) : '—') },
    { header: 'Remark', cell: (r) => r.remark ?? '—' },
    {
      header: '',
      className: 'text-right',
      cell: (r) =>
        status === 'SUBMITTED' && (
          <span className="flex justify-end gap-2">
            <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ jobId: r.jobId, action: 'approve' })}>Approve</Button>
            <Button size="sm" variant="secondary" loading={decide.isPending} onClick={() => { const remark = window.prompt('Why is it being sent back?'); if (remark !== null) decide.mutate({ jobId: r.jobId, action: 'reject', remark: remark.trim() || undefined }); }}>Reject</Button>
          </span>
        ),
    },
  ];
  return (
    <Card title={`Return Notes (${q.data?.length ?? 0})`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['SUBMITTED', 'APPROVED', 'REJECTED'] as const).map((s) => (
          <Button key={s} type="button" size="sm" variant={status === s ? 'primary' : 'secondary'} onClick={() => setStatus(s)}>
            {s === 'SUBMITTED' ? 'Waiting for approval' : s === 'APPROVED' ? 'Approved' : 'Rejected'}
          </Button>
        ))}
        <span className="text-xs text-slate-500">Only approved Return Notes count as consumption for purchase orders and profit.</span>
      </div>
      <DataTable columns={columns} rows={q.data} rowKey={(r) => r.jobId} isLoading={q.isLoading} emptyMessage="No Return Notes here" />
    </Card>
  );
}

/** Branch Manager insights: overview, old pending jobs, diagnosis follow-up, calling, auto PO, stock and profit & loss. */
export function BranchInsightsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview') as Tab;
  const [branchId, setBranchId] = useState('');
  return (
    <div>
      <PageHeader title="Branch Insights" description="Alerts, pending jobs, calling, purchase orders, stock and profit & loss" actions={<BranchScopePicker value={branchId} onChange={setBranchId} />} />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.key} type="button" size="sm" variant={tab === t.key ? 'primary' : 'secondary'} onClick={() => setParams({ tab: t.key })}>
            {t.label}
          </Button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab branchId={branchId} />}
      {tab === 'pending' && <PendingTab branchId={branchId} />}
      {tab === 'diagnosis' && <DiagnosisTab branchId={branchId} />}
      {tab === 'calling' && <CallingTab branchId={branchId} />}
      {tab === 'returnNotes' && <ReturnNotesTab branchId={branchId} />}
      {tab === 'po' && <PoTab branchId={branchId} />}
      {tab === 'stock' && <StockTab branchId={branchId} />}
      {tab === 'pnl' && <PnlTab branchId={branchId} />}
    </div>
  );
}
