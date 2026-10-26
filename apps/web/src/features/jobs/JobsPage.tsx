import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Pencil, Plus, Printer, SlidersHorizontal, Table2, Trash2, X } from 'lucide-react';
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
import { formatCurrency, formatDate, formatDateTime, formatJobNumber } from '@/lib/format';
import { BulkJobActions, bulkActionsFor } from './BulkJobActions';
import { EditJobForm } from './EditJobForm';
import { JobLookup } from './JobLookup';
import { JobStatusBadge } from './JobStatusBadge';
import { InlineJobStatus } from './InlineJobStatus';
import { NewJobPage } from './NewJobPage';
import { useJob } from './api';

type Tab = 'show' | 'add' | 'edit' | 'delete';

/** Job Master: Show / Add / Edit / Delete. Engineers get "My Jobs" (show only, their own jobs). */
export function JobsPage() {
  const { user } = useAuth();
  const isEngineer = user?.role === ROLES.ENGINEER;
  const canAdd = user?.role === ROLES.CCO;
  const canEdit = user?.role === ROLES.CCO || user?.role === ROLES.BRANCH_MANAGER;
  const canCancel = canEdit;
  const canDelete = user?.role === ROLES.BRANCH_MANAGER;
  const [params, setParams] = useSearchParams();
  const allowedTabs: Tab[] = ['show', ...(canAdd ? ['add' as const] : []), ...(canEdit ? ['edit' as const] : []), ...(canCancel ? ['delete' as const] : [])];
  const requestedTab = params.get('tab') as Tab | null;
  const tab: Tab = !isEngineer && requestedTab && allowedTabs.includes(requestedTab) ? requestedTab : 'show';
  const setTab = (t: Tab) => setParams(t === 'show' ? {} : { tab: t }, { replace: true });

  const tabs: { key: Tab; label: string; icon: typeof Table2 }[] = [
    { key: 'show', label: 'Show', icon: Table2 },
    ...(canAdd ? [{ key: 'add' as const, label: 'Add', icon: Plus }] : []),
    ...(canEdit ? [{ key: 'edit' as const, label: 'Edit', icon: Pencil }] : []),
    ...(canCancel ? [{ key: 'delete' as const, label: canDelete ? 'Delete / Cancel' : 'Cancel', icon: Trash2 }] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={isEngineer ? 'My Jobs' : 'Job Master'}
        description={isEngineer ? 'Jobs assigned to you' : canAdd ? 'Create and manage branch job sheets' : canEdit ? 'Find and manage branch job sheets' : 'View job sheets'}
      />
      {!isEngineer && tabs.length > 1 && (
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
          <Link
            to="/jobs/test/print?copy=customer"
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <Printer className="size-4" />
            Test Print
          </Link>
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, JobListItemDto>>(new Map());
  const canBulk = bulkActionsFor(user?.role).length > 0;
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1));
  // Clear the selection only when a filter really changes (SearchInput re-sends its value after every render).
  useEffect(() => setSelected(new Map()), [search, product, from, to, status, engineerId, branchId, view]);

  const params = {
    page,
    pageSize: 25,
    sort: 'newest',
    search,
    product,
    from,
    to,
    status,
    engineerId,
    branchId,
    ...(searchParams.get('open') === 'true' && { open: true }),
    ...(searchParams.get('today') === 'true' && { today: true }),
    ...(searchParams.get('completed') === 'true' && { completed: true }),
    ...viewParams(view),
  };
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
  const allColumns: Column<JobListItemDto>[] = [
    {
      header: 'Job No',
      cell: (j) => (
        <Link to={`/jobs/${j.id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">
          {formatJobNumber(j.jobNumber)}
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
          { header: 'Status', cell: (j: JobListItemDto) => <InlineJobStatus job={j} /> },
          { header: 'Pending with', cell: (j: JobListItemDto) => <span className={j.status === 'AWAITING_APPROVAL' ? 'font-semibold text-orange-700' : 'text-slate-600'}>{j.pendingWith}</span> },
          { header: 'Problem', cell: (j: JobListItemDto) => <span className="block max-w-56 truncate" title={j.faults.join(', ')}>{j.faults.join(', ') || j.remark || '—'}</span> },
          { header: 'Model', cell: (j: JobListItemDto) => nowrap(j.device) },
          { header: 'Customer', cell: (j: JobListItemDto) => nowrap(j.customer.name) },
          { header: 'Mobile', cell: (j: JobListItemDto) => <a href={`tel:${j.customer.phone}`} className="whitespace-nowrap text-brand-600 hover:underline">{j.customer.phone}</a> },
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
  const columns: Column<JobListItemDto>[] = isEngineer
    ? [
        allColumns[0]!,
        { header: 'Status', cell: (j) => <InlineJobStatus job={j} /> },
        { header: 'Pending with', cell: (j) => <span className={j.status === 'AWAITING_APPROVAL' ? 'font-semibold text-orange-700' : 'text-slate-600'}>{j.pendingWith}</span> },
        { header: 'Problem', cell: (j) => <span className="block max-w-56 truncate" title={j.faults.join(', ')}>{j.faults.join(', ') || j.remark || '—'}</span> },
        { header: 'Model', cell: (j) => nowrap(j.device) },
        { header: 'Customer', cell: (j) => nowrap(j.customer.name) },
        { header: 'Mobile', cell: (j) => <a href={`tel:${j.customer.phone}`} className="whitespace-nowrap text-brand-600 hover:underline">{j.customer.phone}</a> },
        { header: 'Assigned', cell: (j) => nowrap(j.assignedAt ? formatDateTime(j.assignedAt) : null) },
      ]
    : allColumns;

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
        <SearchInput onSearch={reset(setSearch)} placeholder="Search job no, customer, phone, model, IMEI, problem…" className="w-full! sm:w-96!" />
        <div className={`${filtersOpen ? 'flex' : 'hidden'} w-full flex-wrap items-center gap-3 sm:flex sm:w-auto`}>
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
        </div>
      </FilterBar>
      {canBulk && user && (
        <BulkJobActions role={user.role} branchId={engineerBranch || undefined} selected={[...selected.values()]} onClear={() => setSelected(new Map())} />
      )}
      {isEngineer ? (
        <>
          <div className="hidden md:block">
            <DataTable columns={columns} rows={data?.items} rowKey={(j) => j.id} isLoading={isLoading} emptyMessage="No jobs match these filters" />
          </div>
          <div className="space-y-3 md:hidden">
            {isLoading && !data ? <p className="py-10 text-center text-sm text-slate-500">Loading…</p> : !data?.items.length ? <p className="py-10 text-center text-sm text-slate-500">No jobs match these filters</p> : data.items.map((job) => (
              <article key={job.id} className="rounded-xl bg-white p-4 ring-1 ring-slate-200 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/jobs/${job.id}`} className="font-mono font-semibold text-brand-600">{formatJobNumber(job.jobNumber)}</Link>
                    <div className="mt-1 truncate font-semibold">{job.device}</div>
                  </div>
                  <InlineJobStatus job={job} />
                </div>
                <p className="mt-2 text-sm text-slate-600">{job.faults.join(', ') || job.remark || 'No problem noted'}</p>
                <p className={`mt-2 text-xs ${job.status === 'AWAITING_APPROVAL' ? 'font-semibold text-orange-700' : 'text-slate-500'}`}>Pending with: {job.pendingWith}</p>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <a href={`tel:${job.customer.phone}`} className="font-medium text-slate-700">{job.customer.name} · {job.customer.phone}</a>
                  <span>{job.assignedAt ? formatDate(job.assignedAt) : ''}</span>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items}
          rowKey={(j) => j.id}
          isLoading={isLoading}
          emptyMessage="No jobs match these filters"
          {...(canBulk && {
            selected: new Set(selected.keys()),
            onSelectedChange: (ids: Set<string>) =>
              setSelected((prev) => {
                const next = new Map(prev);
                for (const j of data?.items ?? []) {
                  if (ids.has(j.id)) next.set(j.id, j);
                  else next.delete(j.id);
                }
                return next;
              }),
          })}
        />
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      <button
        type="button"
        onClick={() => setFiltersOpen((open) => !open)}
        className="fixed right-4 bottom-5 z-30 grid size-12 place-items-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white sm:hidden"
        aria-label={filtersOpen ? 'Close filters' : 'Open filters'}
      >
        {filtersOpen ? <X className="size-5" /> : <SlidersHorizontal className="size-5" />}
      </button>
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
