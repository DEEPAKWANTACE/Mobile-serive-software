import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Download, Pencil, Plus, Printer, SlidersHorizontal, Table2, Trash2, X } from 'lucide-react';
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
import { QuickDateRange } from '@/components/ui/QuickDateRange';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, inputClass } from '@/components/ui/Field';
import { FilterSelect, SearchInput } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/features/auth/auth-context';
import { api, ApiError } from '@/lib/api-client';
import { toQueryString, useList, useOptions } from '@/lib/crud';
import { downloadCsv } from '@/lib/csv';
import { formatCurrency, formatDate, formatJobNumber } from '@/lib/format';
import { BulkJobActions, bulkActionsFor } from './BulkJobActions';
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
    <div className={tab === 'show' ? 'flex h-full min-h-0 flex-col gap-2' : 'space-y-4'}>
      {tab !== 'show' && (
        <PageHeader
          title={isEngineer ? 'My Jobs' : 'Job Master'}
          description={isEngineer ? 'Jobs assigned to you' : canAdd ? 'Create and manage branch job sheets' : canEdit ? 'Find and manage branch job sheets' : 'View job sheets'}
        />
      )}
      {!isEngineer && tabs.length > 1 && (
        <div className="flex shrink-0 flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
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
  ['engineers', 'With engineers'],
  ['ready', 'Ready for collection'],
  ['out', 'Out (delivered)'],
  ['balance', 'Balance due'],
  ['over15', 'More than 15 days'],
] as const;

const viewParams = (v: string) =>
  v === 'pending' ? { open: true }
    : v === 'engineers' ? { statuses: 'ASSIGNED,IN_REPAIR,REPAIRED,TESTING' }
      : v === 'ready' ? { statuses: 'READY_FOR_DELIVERY,RWR' }
        : v === 'out' ? { delivered: true }
          : v === 'balance' ? { balanceDue: true }
            : v === 'over15' ? { open: true, minAgeDays: 15 }
              : {};

/** Keep exactly as many records as fit inside the visible Job Master area. */
function useFittedPageSize(viewport: React.RefObject<HTMLDivElement | null>) {
  const [pageSize, setPageSize] = useState(8);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const fit = () => {
      const desktop = element.clientWidth >= 768;
      const next = desktop
        // Payment uses two lines, so a desktop row is ~53px including its divider.
        // Keep a small safety margin so the final row is always fully visible.
        ? Math.max(4, Math.floor((element.clientHeight - 44) / 54))
        : Math.max(1, Math.floor((element.clientHeight - 8) / 92));
      setPageSize((current) => current === next ? current : next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport]);
  return pageSize;
}

function CompactPager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
      <span className="tabular-nums">{from}–{to} of {total}</span>
      <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)} className="grid size-8 place-items-center rounded-md border border-slate-300 bg-white disabled:opacity-40">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-12 text-center tabular-nums">{page}/{pages}</span>
      <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)} className="grid size-8 place-items-center rounded-md border border-slate-300 bg-white disabled:opacity-40">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export function ShowJobs() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const isEngineer = user?.role === ROLES.ENGINEER;
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [product, setProduct] = useState('');
  const [from, setFrom] = useState(searchParams.get('from') ?? '');
  const [to, setTo] = useState(searchParams.get('to') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  // Keep URL drill-downs and the API on the same canonical filter name. The legacy
  // `engineer` key is still accepted so old bookmarked dashboard links keep working.
  const [engineerId, setEngineerId] = useState(searchParams.get('engineerId') ?? searchParams.get('engineer') ?? '');
  const [branchId, setBranchId] = useState(searchParams.get('branchId') ?? '');
  const [view, setView] = useState(searchParams.get('view') ?? '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, JobListItemDto>>(new Map());
  const listViewportRef = useRef<HTMLDivElement>(null);
  const pageSize = useFittedPageSize(listViewportRef);
  const canBulk = bulkActionsFor(user?.role).length > 0;
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1));
  // Clear the selection only when a filter really changes (SearchInput re-sends its value after every render).
  useEffect(() => setSelected(new Map()), [search, product, from, to, status, engineerId, branchId, view]);

  const params = {
    page,
    pageSize,
    sort: 'newest',
    search,
    product,
    from,
    to,
    status,
    ...(searchParams.get('statuses') && { statuses: searchParams.get('statuses')! }),
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

  const payment = (j: JobListItemDto) => {
    if (j.balance > 0) return (
      <span className="block min-w-0">
        <span className="block truncate font-semibold text-orange-700">Due {formatCurrency(j.balance)}</span>
        <span className="block truncate text-[11px] text-slate-500">{formatCurrency(j.paid)} paid of {formatCurrency(j.totalAmount)}</span>
      </span>
    );
    if (j.balance < 0) return (
      <span className="block min-w-0">
        <span className="block truncate font-semibold text-blue-700">Credit {formatCurrency(Math.abs(j.balance))}</span>
        <span className="block truncate text-[11px] text-slate-500">{formatCurrency(j.paid)} received</span>
      </span>
    );
    if (j.paid > 0) return <span className="font-semibold text-emerald-700">Paid {formatCurrency(j.paid)}</span>;
    return <span className="text-slate-500">Not billed</span>;
  };
  const columns: Column<JobListItemDto>[] = [
    {
      header: 'Job Sheet ID',
      className: 'w-[16%]',
      cell: (j) => (
        <Link to={`/jobs/${j.id}`} className="block truncate font-mono text-sm font-semibold text-brand-600 hover:underline" title={formatJobNumber(j.jobNumber)}>
          {formatJobNumber(j.jobNumber)}
        </Link>
      ),
    },
    { header: 'Status', className: 'w-[17%]', cell: (j) => <JobStatusBadge status={j.status} /> },
    { header: 'Payment', className: 'w-[19%]', cell: payment },
    { header: 'Date', className: 'w-[12%]', cell: (j) => <span className="whitespace-nowrap text-slate-600">{formatDate(j.createdAt)}</span> },
    { header: 'Customer Mobile', className: 'w-[17%]', cell: (j) => <a href={`tel:${j.customer.phone}`} className="block truncate text-brand-600 hover:underline">{j.customer.phone}</a> },
    { header: 'Model Number', className: 'w-[19%]', cell: (j) => <span className="block truncate font-medium" title={j.device}>{j.device || '—'}</span> },
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

  const activeFilterCount = [search, product, from, to, status, engineerId, branchId, view].filter(Boolean).length;
  const changeSelection = (ids: Set<string>) => setSelected((previous) => {
    const next = new Map(previous);
    for (const job of data?.items ?? []) {
      if (ids.has(job.id)) next.set(job.id, job);
      else next.delete(job.id);
    }
    return next;
  });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="theme-panel hidden shrink-0 items-center gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-200 md:flex">
        <SearchInput
          onSearch={reset(setSearch)}
          initialValue={search}
          placeholder="Search job no, customer, phone, model, IMEI, problem…"
          className="w-72! xl:w-96!"
        />
        {!isEngineer && (
          <select value={view} onChange={(event) => reset(setView)(event.target.value)} className={`${inputClass} w-44!`} aria-label="Job view">
            {VIEWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        )}
        <FilterSelect value={status} onChange={reset(setStatus)} placeholder="All statuses" options={JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] }))} />
        <button type="button" onClick={() => setFiltersOpen((open) => !open)} className="relative inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" aria-expanded={filtersOpen}>
          <SlidersHorizontal className="size-4" /> Filters
          {activeFilterCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] leading-none text-white">{activeFilterCount}</span>}
        </button>
        <div className="ml-auto">
          {data && <CompactPager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
        </div>
      </div>

      {filtersOpen && (
        <div className="theme-panel absolute inset-x-0 bottom-14 z-30 max-h-[70dvh] overflow-y-auto rounded-xl bg-white p-3 shadow-xl ring-1 ring-slate-200 md:static md:z-auto md:flex md:max-h-none md:shrink-0 md:flex-wrap md:items-center md:gap-2 md:overflow-visible md:rounded-lg md:shadow-none">
          <div className="mb-3 flex items-center justify-between md:hidden">
            <span className="font-semibold">Search & filters</span>
            <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters" className="grid size-8 place-items-center rounded-md hover:bg-slate-100"><X className="size-4" /></button>
          </div>
          <div className="space-y-2 md:contents">
            <div className="md:hidden">
              <SearchInput onSearch={reset(setSearch)} initialValue={search} placeholder="Search jobs…" className="w-full!" />
            </div>
            {!isEngineer && (
              <select value={view} onChange={(event) => reset(setView)(event.target.value)} className={`${inputClass} w-full! md:hidden`} aria-label="Job view">
                {VIEWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}
            <div className="md:hidden">
              <FilterSelect value={status} onChange={reset(setStatus)} placeholder="All statuses" options={JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] }))} />
            </div>
            <SearchInput onSearch={reset(setProduct)} placeholder="Product (brand / model)" className="w-full! md:w-56!" />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <span className="w-10 md:w-auto">From</span><input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className={`${inputClass} min-w-0 flex-1 md:w-36! md:flex-none`} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <span className="w-10 md:w-auto">To</span><input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className={`${inputClass} min-w-0 flex-1 md:w-36! md:flex-none`} />
        </label>
            <div className="overflow-x-auto pb-1 md:overflow-visible md:pb-0"><QuickDateRange onSelect={(f, t) => (setFrom(f), setTo(t), setPage(1))} label={false} /></div>
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
              <Button variant="secondary" className="w-full md:w-auto" onClick={() => void exportCsv()}>
            <Download className="size-4" /> Excel
          </Button>
        )}
          </div>
        </div>
      )}

      {canBulk && user && (
        <div className="shrink-0"><BulkJobActions role={user.role} branchId={engineerBranch || undefined} selected={[...selected.values()]} onClear={() => setSelected(new Map())} /></div>
      )}

      <div ref={listViewportRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="hidden h-full md:block">
          <DataTable
            columns={columns}
            rows={data?.items}
            rowKey={(j) => j.id}
            isLoading={isLoading}
            emptyMessage="No jobs match these filters"
            containerClassName="min-h-full"
            tableClassName="table-fixed"
            fillHeight={!!data?.items.length && data.items.length === data.pageSize}
            headerCellClassName="px-3! py-2!"
            cellClassName="px-3! py-2!"
            rowClassName={(job) => job.dueAt ? (new Date(job.dueAt).getTime() <= Date.now() ? 'bg-red-50' : 'bg-amber-50') : ''}
            {...(canBulk && { selected: new Set(selected.keys()), onSelectedChange: changeSelection })}
          />
        </div>
        <div className="job-list-mobile grid min-h-full content-start gap-2 md:hidden">
          {isLoading && !data ? <p className="py-10 text-center text-sm text-slate-500">Loading…</p> : !data?.items.length ? <p className="py-10 text-center text-sm text-slate-500">No jobs match these filters</p> : data.items.map((job) => (
            <article key={job.id} className={`h-[84px] overflow-hidden rounded-lg bg-white px-3 py-2 ring-1 ${job.dueAt ? 'ring-amber-300' : 'ring-slate-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {canBulk && <input type="checkbox" aria-label={`Select ${formatJobNumber(job.jobNumber)}`} checked={selected.has(job.id)} onChange={() => { const ids = new Set(selected.keys()); if (ids.has(job.id)) ids.delete(job.id); else ids.add(job.id); changeSelection(ids); }} className="size-4 shrink-0 accent-brand-600" />}
                  <Link to={`/jobs/${job.id}`} className="truncate font-mono text-sm font-semibold text-brand-600">{formatJobNumber(job.jobNumber)}</Link>
                </div>
                <JobStatusBadge status={job.status} />
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium" title={job.device}>{job.device || '—'}</span>
                <span className="shrink-0">{payment(job)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>{formatDate(job.createdAt)}</span>
                <a href={`tel:${job.customer.phone}`} className="text-brand-600">{job.customer.phone}</a>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="job-mobile-footer theme-panel flex shrink-0 items-center justify-between rounded-lg bg-white px-2 ring-1 ring-slate-200 md:hidden">
        <button type="button" onClick={() => setFiltersOpen((open) => !open)} className="relative inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-slate-700" aria-expanded={filtersOpen}>
          {filtersOpen ? <X className="size-4" /> : <SlidersHorizontal className="size-4" />} Filters
          {activeFilterCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] leading-none text-white">{activeFilterCount}</span>}
        </button>
        {data && <CompactPager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </div>
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
