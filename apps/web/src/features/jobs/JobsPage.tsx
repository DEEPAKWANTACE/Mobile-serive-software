import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Pencil, Plus, Table2, Trash2 } from 'lucide-react';
import {
  CANCELLABLE_STATUSES,
  JOB_STATUS_LABELS,
  JOB_STATUSES,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  ROLES,
  type BranchDto,
  type EngineerWorkloadDto,
  type JobListItemDto,
  type PaymentMode,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, inputClass } from '@/components/ui/Field';
import { FilterBar, FilterSelect, SearchInput } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/auth-context';
import { api, ApiError } from '@/lib/api-client';
import { toQueryString, useList, useOptions } from '@/lib/crud';
import { downloadCsv } from '@/lib/csv';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { EditJobForm } from './EditJobForm';
import { JobLookup } from './JobLookup';
import { JobStatusBadge } from './JobStatusBadge';
import { NewJobPage } from './NewJobPage';
import { useJob } from './api';

type Tab = 'show' | 'add' | 'edit' | 'delete';

/** Job Master: Show / Add / Edit / Delete. Engineers get "My Jobs" (show only, their own jobs). */
export function JobsPage() {
  const { user } = useAuth();
  const isEngineer = user?.role === ROLES.ENGINEER;
  const canDelete = user?.role === ROLES.SUPER_ADMIN || user?.role === ROLES.BRANCH_MANAGER;
  const [params, setParams] = useSearchParams();
  const tab = (isEngineer ? 'show' : (params.get('tab') as Tab | null)) ?? 'show';
  const setTab = (t: Tab) => setParams(t === 'show' ? {} : { tab: t }, { replace: true });

  const tabs: { key: Tab; label: string; icon: typeof Table2 }[] = [
    { key: 'show', label: 'Show', icon: Table2 },
    { key: 'add', label: 'Add', icon: Plus },
    { key: 'edit', label: 'Edit', icon: Pencil },
    { key: 'delete', label: canDelete ? 'Delete / Cancel' : 'Cancel', icon: Trash2 },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={isEngineer ? 'My Jobs' : 'Job Master'}
        description={isEngineer ? 'Jobs assigned to you' : 'Create, find, correct and remove job sheets'}
      />
      {!isEngineer && (
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </div>
      )}
      {tab === 'show' && <ShowJobs />}
      {tab === 'add' && <NewJobPage embedded />}
      {tab === 'edit' && <EditTab />}
      {tab === 'delete' && <DeleteTab canDelete={canDelete} />}
    </div>
  );
}

// ─── Show ───────────────────────────────────────────────────────────────────

const VIEWS = [
  ['', 'All'],
  ['pending', 'Pending works'],
  ['out', 'Out (delivered)'],
  ['balance', 'Balance due'],
  ['over15', 'More than 15 days'],
] as const;

const viewParams = (v: string) =>
  v === 'pending' ? { open: true } : v === 'out' ? { delivered: true } : v === 'balance' ? { balanceDue: true } : v === 'over15' ? { open: true, minAgeDays: 15 } : {};

export function ShowJobs() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const isEngineer = user?.role === ROLES.ENGINEER;
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState('');
  const [from, setFrom] = useState(searchParams.get('from') ?? '');
  const [to, setTo] = useState(searchParams.get('to') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [engineerId, setEngineerId] = useState(searchParams.get('engineer') ?? '');
  const [branchId, setBranchId] = useState('');
  const [view, setView] = useState(searchParams.get('view') ?? '');
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1));

  const params = { page, pageSize: 25, sort: 'newest', search, product, from, to, status, engineerId, branchId, ...viewParams(view) };
  const { data, isLoading } = useList<JobListItemDto>('jobs', params);
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: isSuperAdmin });
  const engineerBranch = isSuperAdmin ? branchId : user?.branch?.id;
  const engineers = useQuery({
    queryKey: ['engineers', engineerBranch],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers?branchId=${engineerBranch}`),
    enabled: !isEngineer && !!engineerBranch,
  });

  const money = (v: number) => <span className="tabular-nums">{formatCurrency(v)}</span>;
  const nowrap = (v: React.ReactNode) => <span className="whitespace-nowrap">{v ?? '—'}</span>;
  const columns: Column<JobListItemDto>[] = [
    {
      header: 'Job No',
      cell: (j) => (
        <Link to={`/jobs/${j.id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">
          {j.jobNumber}
        </Link>
      ),
    },
    { header: 'Date', cell: (j) => nowrap(formatDate(j.createdAt)) },
    { header: 'Customer Name', cell: (j) => nowrap(j.customer.name) },
    { header: 'Contact No', cell: (j) => <a href={`tel:${j.customer.phone}`} className="whitespace-nowrap text-brand-600 hover:underline">{j.customer.phone}</a> },
    { header: 'City', cell: (j) => nowrap(j.city) },
    { header: 'Product', cell: (j) => nowrap(j.device) },
    { header: 'Serial No', cell: (j) => <span className="font-mono text-xs whitespace-nowrap">{j.imei ?? j.serialNumber ?? '—'}</span> },
    { header: 'Problem', cell: (j) => <span className="block max-w-56 truncate" title={j.faults.join(', ')}>{j.faults.join(', ')}</span> },
    { header: 'Remark', cell: (j) => <span className="block max-w-48 truncate text-slate-600" title={j.remark ?? ''}>{j.remark ?? '—'}</span> },
    ...(isEngineer
      ? [
          { header: 'Status', cell: (j: JobListItemDto) => <JobStatusBadge status={j.status} /> },
          { header: 'Assigned', cell: (j: JobListItemDto) => nowrap(j.assignedAt ? formatDateTime(j.assignedAt) : null) },
        ]
      : [
          { header: 'Inward', cell: (j: JobListItemDto) => nowrap(j.inwardBy) },
          { header: 'Engineer', cell: (j: JobListItemDto) => nowrap(j.assignedEngineer?.name ?? <span className="text-slate-400">Unassigned</span>) },
          { header: 'Status', cell: (j: JobListItemDto) => <JobStatusBadge status={j.status} /> },
          { header: 'Repaired', cell: (j: JobListItemDto) => nowrap(j.repairedAt || j.readyAt ? 'Yes' : 'No') },
          { header: 'Repaired Date', cell: (j: JobListItemDto) => nowrap(j.readyAt ?? j.repairedAt ? formatDate((j.readyAt ?? j.repairedAt)!) : null) },
          { header: 'Out', cell: (j: JobListItemDto) => nowrap(j.status === 'DELIVERED' ? 'Yes' : 'No') },
          { header: 'Out Narration', cell: (j: JobListItemDto) => <span className="block max-w-48 truncate">{j.deliveryNote ?? '—'}</span> },
          { header: 'Out Date', cell: (j: JobListItemDto) => nowrap(j.deliveredAt ? formatDate(j.deliveredAt) : null) },
          { header: 'Total', className: 'text-right', cell: (j: JobListItemDto) => money(j.totalAmount) },
          { header: 'Paid', className: 'text-right', cell: (j: JobListItemDto) => money(j.paid) },
          {
            header: 'Balance',
            className: 'text-right',
            cell: (j: JobListItemDto) => <span className={`font-semibold tabular-nums ${j.balance > 0 ? 'text-orange-700' : j.balance < 0 ? 'text-red-600' : ''}`}>{formatCurrency(j.balance)}</span>,
          },
          ...(isSuperAdmin ? [{ header: 'Branch', cell: (j: JobListItemDto) => j.branch.code }] : []),
        ]),
  ];

  const exportCsv = async () => {
    const all = await api.get<{ items: JobListItemDto[] }>(`/jobs?${toQueryString({ ...params, page: 1, pageSize: 200 })}`);
    downloadCsv(
      `jobs_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Job No', 'Date', 'Customer', 'Contact', 'City', 'Product', 'Serial/IMEI', 'Problem', 'Remark', 'Inward', 'Engineer', 'Status', 'Repaired Date', 'Out Date', 'Out Narration', 'Total', 'Paid', 'Balance'],
      all.items.map((j) => [
        j.jobNumber, formatDate(j.createdAt), j.customer.name, j.customer.phone, j.city, j.device, j.imei ?? j.serialNumber, j.faults.join('; '), j.remark,
        j.inwardBy, j.assignedEngineer?.name, JOB_STATUS_LABELS[j.status], j.readyAt ?? j.repairedAt ? formatDate((j.readyAt ?? j.repairedAt)!) : '',
        j.deliveredAt ? formatDate(j.deliveredAt) : '', j.deliveryNote, j.totalAmount, j.paid, j.balance,
      ]),
    );
  };

  return (
    <div className="space-y-3">
      {!isEngineer && (
        <div className="flex flex-wrap gap-2">
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => reset(setView)(v)}
              className={`rounded-full px-3 py-1 text-sm ring-1 ${view === v ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <FilterBar>
        <SearchInput onSearch={reset(setSearch)} placeholder={isEngineer ? 'Job no, customer, mobile' : 'Job no, customer, mobile, city, IMEI'} />
        <SearchInput onSearch={reset(setProduct)} placeholder="Product (brand / model)" />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          From <input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className={`${inputClass} w-38!`} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          To <input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className={`${inputClass} w-38!`} />
        </label>
        <FilterSelect value={status} onChange={reset(setStatus)} placeholder="All statuses" options={JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] }))} />
        {!isEngineer && (
          <FilterSelect
            value={engineerId}
            onChange={reset(setEngineerId)}
            placeholder={engineerBranch ? 'All engineers' : 'Select branch for engineers'}
            disabled={!engineerBranch}
            options={[{ value: 'none', label: 'Unassigned' }, ...(engineers.data ?? []).map((e) => ({ value: e.id, label: e.name }))]}
          />
        )}
        {isSuperAdmin && (
          <FilterSelect value={branchId} onChange={(v) => (setBranchId(v), setEngineerId(''), setPage(1))} placeholder="All branches" options={branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))} />
        )}
        {!isEngineer && (
          <Button variant="secondary" onClick={() => void exportCsv()}>
            <Download className="size-4" /> Excel
          </Button>
        )}
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(j) => j.id} isLoading={isLoading} emptyMessage="No jobs match these filters" />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </div>
  );
}

// ─── Edit ───────────────────────────────────────────────────────────────────

function EditTab() {
  const [params] = useSearchParams();
  const [found, setFound] = useState<JobListItemDto | null>(null);
  const job = useJob(found?.id ?? '');
  return (
    <Card title="Edit job" subtitle="Search the job number, correct the details and save" icon={Pencil}>
      <JobLookup onFound={setFound} initial={params.get('job') ?? ''} />
      {found && job.data && (
        <div className="mt-5 border-t border-slate-100 pt-5">
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-mono text-base font-semibold">{job.data.jobNumber}</span>
            <JobStatusBadge status={job.data.status} />
            <Link to={`/jobs/${job.data.id}`} className="text-brand-600 hover:underline">Open full job (assign engineer, payments, history) →</Link>
          </div>
          {job.data.status === 'DELIVERED' || job.data.status === 'CANCELLED' ? (
            <p className="text-sm text-slate-600">This job is closed and can no longer be edited.</p>
          ) : (
            <EditJobForm key={job.data.id + job.dataUpdatedAt} job={job.data} onDone={() => toast.info('Changes saved — search another job number to continue')} />
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Delete / cancel ────────────────────────────────────────────────────────

function DeleteTab({ canDelete }: { canDelete: boolean }) {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [found, setFound] = useState<JobListItemDto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reason, setReason] = useState('');
  const [refundMode, setRefundMode] = useState<PaymentMode>('CASH');
  const [error, setError] = useState<string>();

  const done = (msg: string) => {
    toast.success(msg);
    setFound(null);
    setReason('');
    void queryClient.invalidateQueries();
  };
  const del = useMutation({
    mutationFn: () => api.delete(`/jobs/${found!.id}`),
    onSuccess: () => done(`Job ${found!.jobNumber} deleted`),
    onError: (e) => {
      setConfirmDelete(false);
      setError(e.message);
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/jobs/${found!.id}/cancel`, { reason, refundMode: found!.paid > 0 ? refundMode : null }),
    onSuccess: () => done(`Job ${found!.jobNumber} cancelled`),
    onError: (e) => setError(e instanceof ApiError ? Object.values((e.details as Record<string, string[]>) ?? {})[0]?.[0] ?? e.message : e.message),
  });

  const canCancel = found && CANCELLABLE_STATUSES.includes(found.status);
  return (
    <Card title={canDelete ? 'Delete or cancel a job' : 'Cancel a job'} subtitle="Search the job number and check the details first" icon={Trash2}>
      <JobLookup onFound={(j) => (setFound(j), setError(undefined))} initial={params.get('job') ?? ''} />
      {found && (
        <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-slate-500">Job</dt><dd className="font-mono font-semibold">{found.jobNumber}</dd></div>
            <div><dt className="text-xs text-slate-500">Customer</dt><dd>{found.customer.name} · {found.customer.phone}</dd></div>
            <div><dt className="text-xs text-slate-500">Product</dt><dd>{found.device}</dd></div>
            <div><dt className="text-xs text-slate-500">Status</dt><dd><JobStatusBadge status={found.status} /></dd></div>
            <div><dt className="text-xs text-slate-500">Engineer</dt><dd>{found.assignedEngineer?.name ?? '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Paid</dt><dd>{formatCurrency(found.paid)}</dd></div>
          </dl>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {canDelete && (
              <div className="rounded-lg border border-red-200 p-4">
                <div className="font-medium text-red-800">Delete permanently</div>
                <p className="mt-1 text-sm text-slate-600">Only for jobs entered by mistake with no payments, invoice, issued parts or L4 movements.</p>
                <Button variant="danger" className="mt-3" onClick={() => setConfirmDelete(true)}>Delete job</Button>
              </div>
            )}
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="font-medium">Cancel job</div>
              {canCancel ? (
                <div className="mt-2 space-y-3">
                  <Field label="Reason" required>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="e.g. Customer took the phone back" />
                  </Field>
                  {found.paid > 0 && (
                    <Field label={`Refund advance ${formatCurrency(found.paid)} by`}>
                      <select value={refundMode} onChange={(e) => setRefundMode(e.target.value as PaymentMode)} className={inputClass}>
                        {PAYMENT_MODES.map((m) => <option key={m} value={m}>{PAYMENT_MODE_LABELS[m]}</option>)}
                      </select>
                    </Field>
                  )}
                  <Button disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel job</Button>
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-600">This job can't be cancelled at its current stage (repaired, returned or closed).</p>
              )}
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${found?.jobNumber ?? ''}?`}
        message="The job, its photos and history are removed permanently. This cannot be undone."
        confirmLabel="Delete permanently"
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
    </Card>
  );
}
