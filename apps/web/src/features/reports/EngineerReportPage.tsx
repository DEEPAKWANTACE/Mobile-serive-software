import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, FileText, MessageSquare, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  JOB_STATUS_FILTER_OPTIONS,
  JOB_STATUS_LABELS,
  ROLES,
  type BranchDto,
  type DashboardSummaryDto,
  type EngineerReportRowDto,
  type EngineerWorkloadDto,
  type JobStatus,
  type Paginated,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { QuickDateRange } from '@/components/ui/QuickDateRange';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, inputClass } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/auth-context';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { api } from '@/lib/api-client';
import { toQueryString, useOptions } from '@/lib/crud';
import { downloadCsv } from '@/lib/csv';
import { openPrintWindow, writeTable } from '@/lib/print-table';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate, formatDateTime, todayIso } from '@/lib/format';

const PAYMENT_LABELS: Record<EngineerReportRowDto['paymentStatus'], { label: string; cls: string }> = {
  PAID: { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-50 text-amber-800' },
  UNPAID: { label: 'Unpaid', cls: 'bg-red-50 text-red-700' },
  NO_CHARGE: { label: 'No charge', cls: 'bg-slate-100 text-slate-600' },
  REFUND_DUE: { label: 'Refund due', cls: 'bg-purple-50 text-purple-700' },
};

type Filters = { jobNumber: string; from: string; to: string; engineerId: string; status: string; branchId: string };

/** Export fields: Excel gets all of them, the PDF only the chosen ones. */
const EXPORT_FIELDS: { key: string; label: string; value: (r: EngineerReportRowDto) => string | number | null }[] = [
  { key: 'jobNumber', label: 'Job No', value: (r) => r.job.jobNumber },
  { key: 'date', label: 'Date', value: (r) => formatDate(r.job.createdAt) },
  { key: 'customer', label: 'Customer', value: (r) => r.customer },
  { key: 'product', label: 'Product', value: (r) => r.product },
  { key: 'problem', label: 'Problem', value: (r) => r.problem },
  { key: 'engineer', label: 'Engineer', value: (r) => r.engineer },
  { key: 'status', label: 'Status', value: (r) => JOB_STATUS_LABELS[r.job.status as JobStatus] ?? r.job.status },
  { key: 'assigned', label: 'Assigned', value: (r) => (r.assignedAt ? formatDateTime(r.assignedAt) : '') },
  { key: 'testing', label: 'Testing Date', value: (r) => (r.testingAt ? formatDate(r.testingAt) : '') },
  { key: 'repaired', label: 'Repair Date', value: (r) => (r.repairedAt ? formatDate(r.repairedAt) : '') },
  { key: 'amount', label: 'Amount', value: (r) => r.totalAmount },
  { key: 'paid', label: 'Paid', value: (r) => r.paidAmount },
  { key: 'balance', label: 'Balance', value: (r) => r.balance },
  { key: 'payment', label: 'Payment', value: (r) => PAYMENT_LABELS[r.paymentStatus].label },
  { key: 'transfers', label: 'Transfer History', value: (r) => r.transferHistory },
  { key: 'remarks', label: 'Remarks', value: (r) => r.remarks },
];
/** One-click column sets for the PDF. */
const PDF_PRESETS: { label: string; keys: string[] }[] = [
  { label: 'Short', keys: ['jobNumber', 'date', 'customer', 'product', 'engineer', 'status', 'amount'] },
  { label: 'Pending check', keys: ['jobNumber', 'date', 'product', 'problem', 'engineer', 'status'] },
  { label: 'Money', keys: ['jobNumber', 'customer', 'engineer', 'amount', 'paid', 'balance', 'payment'] },
  { label: 'All', keys: EXPORT_FIELDS.map((f) => f.key) },
];
const PDF_COLUMNS_KEY = 'engineer-report-pdf-columns';
const loadPdfColumns = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PDF_COLUMNS_KEY) ?? 'null') as string[] | null;
    if (Array.isArray(saved) && saved.length) return saved.filter((k) => EXPORT_FIELDS.some((f) => f.key === k));
  } catch { /* storage unavailable */ }
  return PDF_PRESETS[0]!.keys;
};
const EMPTY: Filters = { jobNumber: '', from: '', to: '', engineerId: '', status: '', branchId: '' };

/** Engineer Report: jobs per engineer (current or past assignment) with status, repair date, amount and payment status. */
export function EngineerReportPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value, ...(k === 'branchId' && { engineerId: '' }) }));

  const params = { ...applied, page, pageSize: 50 };
  const report = useQuery({
    queryKey: ['reports', 'engineer-jobs', params],
    queryFn: () => api.get<Paginated<EngineerReportRowDto>>(`/reports/engineer-jobs?${toQueryString(params)}`),
    placeholderData: (prev) => prev,
  });
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: isSuperAdmin });
  const engineerBranch = isSuperAdmin ? draft.branchId : user?.branch?.id;
  const engineers = useQuery({
    queryKey: ['engineers', engineerBranch],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers?branchId=${engineerBranch}`),
    enabled: !!engineerBranch,
  });

  const summaryRange = applied.from || applied.to ? { from: applied.from, to: applied.to } : {};
  const summary = useQuery({
    queryKey: ['reports', 'dashboard-summary', engineerBranch, summaryRange],
    queryFn: () => api.get<DashboardSummaryDto>(`/reports/dashboard-summary?${toQueryString({ ...summaryRange, branchId: engineerBranch })}`),
  });

  const copyEngineerDetails = (e: { engineer: string; pending: number; phone: string | null }) => {
    const periodLabel = applied.from && applied.to
      ? `(${formatDate(applied.from)} to ${formatDate(applied.to)})`
      : applied.from
        ? `(from ${formatDate(applied.from)})`
        : applied.to
          ? `(up to ${formatDate(applied.to)})`
          : '(Today / Open)';
    const text = `*End of Day Pending Report*\nEngineer: ${e.engineer}\nPending Jobs: ${e.pending}\nPeriod: ${periodLabel}\nPlease check and clear pending jobs.`;
    navigator.clipboard.writeText(text);
    toast.success(`Copied pending details for ${e.engineer}`);
  };

  const whatsappEngineer = (e: { engineer: string; pending: number; phone: string | null }) => {
    const periodLabel = applied.from && applied.to
      ? `(${formatDate(applied.from)} to ${formatDate(applied.to)})`
      : applied.from
        ? `(from ${formatDate(applied.from)})`
        : applied.to
          ? `(up to ${formatDate(applied.to)})`
          : '(Today / Open)';
    const text = `*End of Day Pending Report*\nEngineer: ${e.engineer}\nPending Jobs: ${e.pending}\nPeriod: ${periodLabel}\nPlease check and clear pending jobs.`;
    const cleanPhone = (e.phone || '').replace(/\D/g, '');
    const phoneParam = cleanPhone ? (cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone) : '';
    const url = phoneParam
      ? `https://api.whatsapp.com/send?phone=${phoneParam}&text=${encodeURIComponent(text)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const applyQuickRange = (from: string, to: string) => {
    const next = { ...draft, from, to };
    setDraft(next);
    setApplied(next);
    setPage(1);
  };

  const search = () => {
    setApplied(draft);
    setPage(1);
  };

  const nowrap = (v: React.ReactNode) => <span className="whitespace-nowrap">{v || '—'}</span>;
  const columns: Column<EngineerReportRowDto>[] = [
    {
      header: 'Job No',
      cell: (r) => (
        <Link to={`/jobs/${r.job.id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">
          {r.job.jobNumber}
        </Link>
      ),
    },
    { header: 'Date', cell: (r) => nowrap(formatDate(r.job.createdAt)) },
    { header: 'Customer', cell: (r) => nowrap(r.customer) },
    { header: 'Product', cell: (r) => nowrap(r.product) },
    { header: 'Problem', cell: (r) => <span className="block max-w-48 truncate" title={r.problem}>{r.problem}</span> },
    { header: 'Engineer', cell: (r) => nowrap(r.engineer ?? <span className="text-slate-400">—</span>) },
    { header: 'Status', cell: (r) => <JobStatusBadge status={r.job.status as JobStatus} /> },
    { header: 'Assigned', cell: (r) => nowrap(r.assignedAt && formatDateTime(r.assignedAt)) },
    { header: 'Testing Date', cell: (r) => nowrap(r.testingAt && formatDate(r.testingAt)) },
    { header: 'Repair Date', cell: (r) => nowrap(r.repairedAt && formatDate(r.repairedAt)) },
    { header: 'Amount', className: 'text-right', cell: (r) => <span className="tabular-nums">{formatCurrency(r.totalAmount)}</span> },
    { header: 'Balance', className: 'text-right', cell: (r) => <span className="tabular-nums">{formatCurrency(r.balance)}</span> },
    {
      header: 'Payment',
      cell: (r) => <span className={`rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${PAYMENT_LABELS[r.paymentStatus].cls}`}>{PAYMENT_LABELS[r.paymentStatus].label}</span>,
    },
    { header: 'Transfer History', cell: (r) => (r.transferHistory.includes('→') ? nowrap(r.transferHistory) : <span className="text-slate-400">—</span>) },
    { header: 'Remarks', cell: (r) => <span className="block max-w-64 truncate text-slate-600" title={r.remarks ?? ''}>{r.remarks ?? '—'}</span> },
    ...(isSuperAdmin ? [{ header: 'Branch', cell: (r: EngineerReportRowDto) => r.job.branchCode }] : []),
  ];

  const fetchAll = () => api.get<Paginated<EngineerReportRowDto>>(`/reports/engineer-jobs?${toQueryString({ ...applied, page: 1, pageSize: 500 })}`);
  const exportCsv = async () => {
    const all = await fetchAll();
    downloadCsv(
      `engineer_report_${new Date().toISOString().slice(0, 10)}.csv`,
      EXPORT_FIELDS.map((f) => f.label),
      all.items.map((r) => EXPORT_FIELDS.map((f) => f.value(r))),
    );
  };

  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfColumns, setPdfColumns] = useState<string[]>(loadPdfColumns);
  const exportPdf = async () => {
    const fields = EXPORT_FIELDS.filter((f) => pdfColumns.includes(f.key));
    if (!fields.length) return toast.error('Select at least one column');
    try { localStorage.setItem(PDF_COLUMNS_KEY, JSON.stringify(pdfColumns)); } catch { /* storage unavailable */ }
    const win = openPrintWindow();
    if (!win) return toast.error('Allow pop-ups to download the PDF');
    setPdfOpen(false);
    try {
      const all = await fetchAll();
      const period = applied.from || applied.to ? `${applied.from ? formatDate(applied.from) : '…'} to ${applied.to ? formatDate(applied.to) : '…'}` : 'All dates';
      writeTable(win, {
        title: 'Engineer Report',
        subtitle: `${period} · ${all.total} job${all.total === 1 ? '' : 's'}${all.total > all.items.length ? ` (first ${all.items.length})` : ''}`,
        headers: fields.map((f) => f.label),
        rows: all.items.map((r) => fields.map((f) => {
          const v = f.value(r);
          return typeof v === 'number' && ['amount', 'paid', 'balance'].includes(f.key) ? formatCurrency(v) : v;
        })),
        landscape: fields.length > 7,
      });
    } catch (err) {
      win.close();
      toast.error(err instanceof Error ? err.message : 'Could not build the PDF');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Engineer Report" description="Jobs handled by each engineer — including jobs later transferred or reassigned" />
      
      {/* Quick date range filters */}
      <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <QuickDateRange onSelect={applyQuickRange} />
      </div>

      {/* Engineer-wise pending overview with Copy Details and WhatsApp buttons */}
      {!!summary.data?.engineerPending.length && (
        <Card title="Engineer-wise Pending Summary" subtitle="End of day pending jobs — copy or WhatsApp status to engineers">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.data.engineerPending.map((e) => (
              <div
                key={e.engineerId}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-3 hover:bg-slate-50 transition"
              >
                <div>
                  <div className="font-medium text-sm text-slate-900">{e.engineer}</div>
                  <div className="text-xs text-slate-500">
                    <span className="font-semibold text-brand-700">{e.pending}</span> pending jobs
                    {e.phone ? ` · 📞 ${e.phone}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => copyEngineerDetails(e)}
                    className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 transition shadow-2xs"
                    title="Copy details"
                  >
                    <Copy className="size-3 text-slate-500" />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => whatsappEngineer(e)}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 transition shadow-2xs"
                    title="Send WhatsApp message"
                  >
                    <MessageSquare className="size-3" />
                    WhatsApp
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <form
        onSubmit={(e) => (e.preventDefault(), search())}
        className="grid grid-cols-1 gap-3 rounded-lg bg-white p-4 ring-1 ring-slate-200 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end"
      >
        <Field label="Job No" className="lg:w-44">
          <input value={draft.jobNumber} onChange={set('jobNumber')} className={`${inputClass} font-mono uppercase`} />
        </Field>
        <Field label="From" className="lg:w-44">
          <input type="date" value={draft.from} max={draft.to || undefined} onChange={set('from')} className={inputClass} />
        </Field>
        <Field label="To" className="lg:w-44">
          <input type="date" value={draft.to} min={draft.from || undefined} onChange={set('to')} className={inputClass} />
        </Field>
        {isSuperAdmin && (
          <Field label="Branch" className="lg:w-44">
            <select value={draft.branchId} onChange={set('branchId')} className={inputClass}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
          </Field>
        )}
        <Field label="Engineer" className="lg:w-44">
          <select value={draft.engineerId} onChange={set('engineerId')} disabled={!engineerBranch} className={inputClass}>
            <option value="">{engineerBranch ? 'All engineers' : 'Select branch first'}</option>
            {(engineers.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Status" className="lg:w-44">
          <select value={draft.status} onChange={set('status')} className={inputClass}>
            <option value="">All statuses</option>
            {JOB_STATUS_FILTER_OPTIONS.map((s) => <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit"><Search className="size-4" /> Search</Button>
          <Button variant="secondary" onClick={() => (setDraft(EMPTY), setApplied(EMPTY), setPage(1))}>Reset</Button>
        </div>
      </form>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">{report.data ? `${report.data.total} job${report.data.total === 1 ? '' : 's'}` : ''}</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void exportCsv()}>
            <Download className="size-4" /> Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPdfOpen(true)}>
            <FileText className="size-4" /> PDF
          </Button>
        </div>
      </div>
      <Modal open={pdfOpen} onClose={() => setPdfOpen(false)} title="Download PDF" size="md">
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Quick select</div>
            <div className="flex flex-wrap gap-2">
              {PDF_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPdfColumns(p.keys)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${p.keys.length === pdfColumns.length && p.keys.every((k) => pdfColumns.includes(k)) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {EXPORT_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={pdfColumns.includes(f.key)}
                  onChange={(e) => setPdfColumns((cols) => (e.target.checked ? [...cols, f.key] : cols.filter((k) => k !== f.key)))}
                  className="size-4 accent-brand-600"
                />
                {f.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">Uses the current filters. In the print window choose “Save as PDF”.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPdfOpen(false)}>Cancel</Button>
            <Button onClick={() => void exportPdf()} disabled={!pdfColumns.length}>
              <FileText className="size-4" /> Download PDF ({pdfColumns.length} columns)
            </Button>
          </div>
        </div>
      </Modal>
      <DataTable columns={columns} rows={report.data?.items} rowKey={(r) => r.job.id} isLoading={report.isLoading} emptyMessage="No jobs match these filters" />
      {report.data && <Pagination page={report.data.page} pageSize={report.data.pageSize} total={report.data.total} onChange={setPage} />}
    </div>
  );
}
