import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import {
  JOB_STATUS_LABELS,
  JOB_STATUSES,
  ROLES,
  type BranchDto,
  type EngineerReportRowDto,
  type EngineerWorkloadDto,
  type JobStatus,
  type Paginated,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, inputClass } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/auth-context';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { api } from '@/lib/api-client';
import { toQueryString, useOptions } from '@/lib/crud';
import { downloadCsv } from '@/lib/csv';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';

const PAYMENT_LABELS: Record<EngineerReportRowDto['paymentStatus'], { label: string; cls: string }> = {
  PAID: { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-50 text-amber-800' },
  UNPAID: { label: 'Unpaid', cls: 'bg-red-50 text-red-700' },
  NO_CHARGE: { label: 'No charge', cls: 'bg-slate-100 text-slate-600' },
  REFUND_DUE: { label: 'Refund due', cls: 'bg-purple-50 text-purple-700' },
};

type Filters = { jobNumber: string; from: string; to: string; engineerId: string; status: string; branchId: string };
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

  const exportCsv = async () => {
    const all = await api.get<Paginated<EngineerReportRowDto>>(`/reports/engineer-jobs?${toQueryString({ ...applied, page: 1, pageSize: 500 })}`);
    downloadCsv(
      `engineer_report_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Job No', 'Date', 'Customer', 'Product', 'Problem', 'Engineer', 'Status', 'Assigned', 'Testing Date', 'Repair Date', 'Amount', 'Paid', 'Balance', 'Payment', 'Transfer History', 'Remarks'],
      all.items.map((r) => [
        r.job.jobNumber, formatDate(r.job.createdAt), r.customer, r.product, r.problem, r.engineer, JOB_STATUS_LABELS[r.job.status as JobStatus] ?? r.job.status,
        r.assignedAt ? formatDateTime(r.assignedAt) : '', r.testingAt ? formatDate(r.testingAt) : '', r.repairedAt ? formatDate(r.repairedAt) : '',
        r.totalAmount, r.paidAmount, r.balance, PAYMENT_LABELS[r.paymentStatus].label, r.transferHistory, r.remarks,
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Engineer Report" description="Jobs handled by each engineer — including jobs later transferred or reassigned" />
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
            {JOB_STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit"><Search className="size-4" /> Search</Button>
          <Button variant="secondary" onClick={() => (setDraft(EMPTY), setApplied(EMPTY), setPage(1))}>Reset</Button>
        </div>
      </form>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">{report.data ? `${report.data.total} job${report.data.total === 1 ? '' : 's'}` : ''}</p>
        <Button variant="secondary" size="sm" onClick={() => void exportCsv()}>
          <Download className="size-4" /> Excel
        </Button>
      </div>
      <DataTable columns={columns} rows={report.data?.items} rowKey={(r) => r.job.id} isLoading={report.isLoading} emptyMessage="No jobs match these filters" />
      {report.data && <Pagination page={report.data.page} pageSize={report.data.pageSize} total={report.data.total} onChange={setPage} />}
    </div>
  );
}
