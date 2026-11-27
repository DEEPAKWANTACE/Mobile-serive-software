import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Download, Loader2, Pencil, Plus, Printer, SlidersHorizontal, Table2, Trash2, X } from 'lucide-react';
import {
  CANCELLABLE_STATUSES,
  JOB_LIST_COLUMN_LABELS,
  JOB_STATUS_FILTER_OPTIONS,
  JOB_STATUS_LABELS,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  ROLES,
  type BranchDto,
  type EngineerWorkloadDto,
  type JobListColumn,
  type JobListItemDto,
  type Paginated,
  type PaymentMode,
} from '@msm/shared';
import { QuickDateRange } from '@/components/ui/QuickDateRange';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable } from '@/components/ui/DataTable';
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
import { ApprovalDecisionDialog } from './ApprovalDecisionDialog';
import { buildJobColumns, isBackHome, jobCellText, JobRowAction, phoneWhereabouts, useJobListColumns, useJobListMode } from './jobListColumns';
import { DeliverJobDialog } from './DeliverJobDialog';

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
      {/* Remounts when the link changes, so filters always match the box or menu item that was clicked. */}
      {tab === 'show' && <ShowJobs key={params.toString()} />}
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

/** Filters that only come from a dashboard link; shown as chips so they can be seen and removed. */
const LINK_FLAGS = {
  open: 'Open jobs only',
  repeat: 'Repeat repairs',
  today: 'Worked on today',
  completed: 'Repaired / delivered',
  current: 'At this branch',
  owned: 'This branch’s customers',
} as const;
type LinkFlag = keyof typeof LINK_FLAGS;

/** Short labels for the phone cards. */
const MOBILE_LABELS: Partial<Record<JobListColumn, string>> = {
  date: 'Date', customerName: 'Customer', customerMobile: 'Mobile', device: 'Model', problem: 'Problem', engineer: 'Engineer',
  pendingWith: 'Pending', estimate: 'Estimate', payment: 'Payment', imei: 'IMEI', city: 'City', village: 'Gaon', branch: 'Branch', inwardBy: 'Inward', ageDays: 'Age',
};
/** Columns that get a full line on the phone card. */
const MOBILE_WIDE: readonly JobListColumn[] = ['device', 'problem', 'pendingWith'];

/** Card body fields for the chosen columns and the card height they need (px). */
function mobileLayout(keys: JobListColumn[]) {
  const fields = keys.filter((k) => k !== 'status' && k !== 'approval');
  let lines = 0;
  let half = 0;
  for (const k of fields) {
    if (MOBILE_WIDE.includes(k)) lines += 1;
    else half += 1;
  }
  lines += Math.ceil(half / 2);
  return { fields, height: 50 + Math.max(1, lines) * 18 };
}

/** Keep exactly as many records as fit inside the visible Job Master area. */
function useFittedPageSize(viewport: React.RefObject<HTMLDivElement | null>, mobileCardHeight: number) {
  const [pageSize, setPageSize] = useState(8);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const fit = () => {
      const desktop = element.clientWidth >= 768;
      const next = desktop
        // Single-line cells: a desktop row is ~45px including its divider (status badge sets the height).
        // Keep a small safety margin so the final row is always fully visible.
        ? Math.max(4, Math.floor((element.clientHeight - 44) / 46))
        : Math.max(1, Math.floor((element.clientHeight - 8) / (mobileCardHeight + 8)));
      setPageSize((current) => current === next ? current : next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport, mobileCardHeight]);
  return pageSize;
}

/** Infinite mode fetches 1.5 screens per batch, so the next batch is already loading before the user reaches the end. */
const INFINITE_BATCH_FACTOR = 1.5;

/** Running count shown instead of the page buttons in infinite mode. */
function LoadedCount({ loaded, total, fetching }: { loaded: number; total: number; fetching: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums text-slate-600">
      {fetching && <Loader2 className="size-3.5 animate-spin text-brand-600" />}
      {loaded} of {total}
    </span>
  );
}

/**
 * Job list that loads LIMIT/OFFSET batches as the user scrolls. Only the first batch runs
 * COUNT(*); later batches send withTotal=false. Rows are de-duplicated by id in case a new
 * job arrives mid-scroll and shifts the offset.
 */
function useJobFeed(filters: Record<string, unknown>, batchSize: number, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ['jobs', 'feed', filters, batchSize],
    enabled,
    refetchInterval: 60_000, // keep an open list current even without live updates
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<Paginated<JobListItemDto>>(`/jobs?${toQueryString({ ...filters, page: pageParam, pageSize: batchSize, ...(pageParam > 1 && { withTotal: false }) })}`),
    getNextPageParam: (last, all) => {
      const total = all[0]!.total;
      const loaded = all.reduce((n, p) => n + p.items.length, 0);
      return last.items.length < batchSize || loaded >= total ? undefined : all.length + 1;
    },
  });
  const seen = new Set<string>();
  const items = (query.data?.pages ?? []).flatMap((p) => p.items).filter((j) => !seen.has(j.id) && (seen.add(j.id), true));
  return { ...query, items, total: query.data?.pages[0]?.total ?? 0 };
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
  const [flags, setFlags] = useState<LinkFlag[]>(() => (Object.keys(LINK_FLAGS) as LinkFlag[]).filter((f) => searchParams.get(f) === 'true'));
  const [statuses, setStatuses] = useState(searchParams.get('statuses') ?? '');
  // Search boxes keep their own text, so they are rebuilt when filters are cleared.
  const [clearCount, setClearCount] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, JobListItemDto>>(new Map());
  const listViewportRef = useRef<HTMLDivElement>(null);
  const columnKeys = useJobListColumns(user?.role);
  const mobile = mobileLayout(columnKeys);
  const canBulk = bulkActionsFor(user?.role).length > 0;
  // The Branch Manager's Repeat Repair list also shows whether each phone is back at its home branch.
  const repeatColumns = user?.role === ROLES.BRANCH_MANAGER && flags.includes('repeat');
  // Phone cards get two more lines for it.
  const cardHeight = mobile.height + (repeatColumns ? 36 : 0);
  const pageSize = useFittedPageSize(listViewportRef, cardHeight);
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1));
  // Clear the selection only when a filter really changes (SearchInput re-sends its value after every render).
  useEffect(() => setSelected(new Map()), [search, product, from, to, status, engineerId, branchId, view, flags, statuses]);

  const params = {
    page,
    pageSize,
    sort: 'newest',
    search,
    product,
    from,
    to,
    status,
    ...(statuses && { statuses }),
    engineerId,
    branchId,
    ...Object.fromEntries(flags.map((f) => [f, true])),
    ...viewParams(view),
  };
  const infinite = useJobListMode() === 'INFINITE';
  const { page: _page, pageSize: _pageSize, ...filterParams } = params;
  const paged = useList<JobListItemDto>('jobs', params, { enabled: !infinite });
  const feed = useJobFeed(filterParams, Math.ceil(pageSize * INFINITE_BATCH_FACTOR), infinite);
  const data = infinite ? (feed.data ? { items: feed.items } : undefined) : paged.data;
  const isLoading = infinite ? feed.isLoading : paged.isLoading;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Start the next batch while the end of the list is still ~400px below the visible area.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!infinite || !sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry?.isIntersecting && !isFetchingNextPage) void fetchNextPage(); },
      { root: listViewportRef.current, rootMargin: '0px 0px 400px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [infinite, hasNextPage, isFetchingNextPage, fetchNextPage, feed.items.length]);
  const counter = infinite
    ? (feed.data && <LoadedCount loaded={feed.items.length} total={feed.total} fetching={feed.isFetching} />)
    : (paged.data && <CompactPager page={paged.data.page} pageSize={paged.data.pageSize} total={paged.data.total} onChange={setPage} />);
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: isSuperAdmin });
  const engineerBranch = isSuperAdmin ? branchId : user?.branch?.id;
  const engineers = useQuery({
    queryKey: ['engineers', engineerBranch],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers?branchId=${engineerBranch}`),
    enabled: !isEngineer && !!engineerBranch,
  });

  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [deliveringId, setDeliveringId] = useState<string | null>(null);
  const actionHandlers = { role: user?.role, onApprove: (j: JobListItemDto) => setApprovingId(j.id), onDeliver: (j: JobListItemDto) => setDeliveringId(j.id) };
  const columns = buildJobColumns(columnKeys, actionHandlers, repeatColumns);
  const minTableWidth = columns.length > 9 ? `${columns.length * 115}px` : undefined;
  const showCol = (key: JobListColumn) => columnKeys.includes(key);

  const exportCsv = async () => {
    const all = await api.get<{ items: JobListItemDto[] }>(`/jobs?${toQueryString({ ...params, page: 1, pageSize: 200 })}`);
    downloadCsv(
      `jobs_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Job No', 'Date', 'Customer', 'Contact', 'City', 'Gaon', 'Product', 'Serial/IMEI', 'Problem', 'Remark', 'Inward', 'Engineer', 'Status', 'Repaired Date', 'Out Date', 'Out Narration', 'Total', 'Paid', 'Balance'],
      all.items.map((j) => [
        j.jobNumber, formatDate(j.createdAt), j.customer.name, j.customer.phone, j.city, j.village, j.device, j.imei ?? j.serialNumber, j.faults.join('; '), j.remark,
        j.inwardBy, j.assignedEngineer?.name, JOB_STATUS_LABELS[j.status], j.readyAt ?? j.repairedAt ? formatDate((j.readyAt ?? j.repairedAt)!) : '',
        j.deliveredAt ? formatDate(j.deliveredAt) : '', j.deliveryNote, j.totalAmount, j.paid, j.balance,
      ]),
    );
  };

  const clearAll = () => {
    for (const set of [setSearch, setProduct, setFrom, setTo, setStatus, setEngineerId, setBranchId, setView, setStatuses]) set('');
    setFlags([]);
    setClearCount((n) => n + 1);
    setPage(1);
  };
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...(view ? [{ key: 'view', label: VIEWS.find(([v]) => v === view)?.[1] ?? view, remove: () => reset(setView)('') }] : []),
    ...(status ? [{ key: 'status', label: `Status: ${JOB_STATUS_LABELS[status as keyof typeof JOB_STATUS_LABELS] ?? status}`, remove: () => reset(setStatus)('') }] : []),
    ...(statuses ? [{ key: 'statuses', label: `Status: ${statuses.split(',').map((s) => JOB_STATUS_LABELS[s as keyof typeof JOB_STATUS_LABELS] ?? s).join(', ')}`, remove: () => reset(setStatuses)('') }] : []),
    ...(from || to ? [{ key: 'dates', label: `Date: ${from ? formatDate(from) : 'start'} – ${to ? formatDate(to) : 'today'}`, remove: () => (setFrom(''), setTo(''), setPage(1)) }] : []),
    ...(engineerId ? [{ key: 'engineer', label: `Engineer: ${engineerId === 'none' ? 'Unassigned' : (engineers.data?.find((e) => e.id === engineerId)?.name ?? 'selected')}`, remove: () => reset(setEngineerId)('') }] : []),
    ...(branchId ? [{ key: 'branch', label: `Branch: ${branches.find((b) => b.id === branchId)?.code ?? 'selected'}`, remove: () => (setBranchId(''), setEngineerId(''), setPage(1)) }] : []),
    ...flags.map((f) => ({ key: f, label: LINK_FLAGS[f], remove: () => (setFlags((list) => list.filter((x) => x !== f)), setPage(1)) })),
  ];
  const activeFilterCount = chips.length + [search, product].filter(Boolean).length;
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
          key={clearCount}
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
        <FilterSelect value={status} onChange={reset(setStatus)} placeholder="All statuses" options={JOB_STATUS_FILTER_OPTIONS.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] }))} />
        <button type="button" onClick={() => setFiltersOpen((open) => !open)} className="relative inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" aria-expanded={filtersOpen}>
          <SlidersHorizontal className="size-4" /> Filters
          {activeFilterCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] leading-none text-white">{activeFilterCount}</span>}
        </button>
        <div className="ml-auto">{counter}</div>
      </div>

      {filtersOpen && (
        <div className="theme-panel absolute inset-x-0 bottom-14 z-30 max-h-[70dvh] overflow-y-auto rounded-xl bg-white p-3 shadow-xl ring-1 ring-slate-200 md:static md:z-auto md:flex md:max-h-none md:shrink-0 md:flex-wrap md:items-center md:gap-2 md:overflow-visible md:rounded-lg md:shadow-none">
          <div className="mb-3 flex items-center justify-between md:hidden">
            <span className="font-semibold">Search & filters</span>
            <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters" className="grid size-8 place-items-center rounded-md hover:bg-slate-100"><X className="size-4" /></button>
          </div>
          <div className="space-y-2 md:contents">
            <div className="md:hidden">
              <SearchInput key={clearCount} onSearch={reset(setSearch)} initialValue={search} placeholder="Search jobs…" className="w-full!" />
            </div>
            {!isEngineer && (
              <select value={view} onChange={(event) => reset(setView)(event.target.value)} className={`${inputClass} w-full! md:hidden`} aria-label="Job view">
                {VIEWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}
            <div className="md:hidden">
              <FilterSelect value={status} onChange={reset(setStatus)} placeholder="All statuses" options={JOB_STATUS_FILTER_OPTIONS.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] }))} />
            </div>
            <SearchInput key={`product-${clearCount}`} onSearch={reset(setProduct)} placeholder="Product (brand / model)" className="w-full! md:w-56!" />
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

      {chips.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs" aria-label="Applied filters">
          <span className="font-semibold text-slate-500">Filtered by</span>
          {chips.map((chip) => (
            <button key={chip.key} type="button" onClick={chip.remove} title="Remove this filter" className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100">
              {chip.label} <X className="size-3" />
            </button>
          ))}
          <button type="button" onClick={clearAll} className="font-medium text-slate-600 underline hover:text-slate-900">Clear all</button>
        </div>
      )}

      {canBulk && user && (
        <div className="shrink-0"><BulkJobActions role={user.role} branchId={engineerBranch || undefined} selected={[...selected.values()]} onClear={() => setSelected(new Map())} /></div>
      )}

      {/* One screen-height box scrolls both ways, so the sideways scrollbar stays at the bottom of the screen
          however many rows are loaded; the header row and Job ID stay pinned. */}
      <div ref={listViewportRef} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <div style={{ minWidth: minTableWidth }} className={`hidden md:block ${infinite ? 'min-h-full' : 'h-full'}`}>
          <DataTable
            columns={columns}
            rows={data?.items}
            rowKey={(j) => j.id}
            isLoading={isLoading}
            emptyMessage="No jobs match these filters"
            containerClassName="min-h-full overflow-visible!"
            tableClassName="table-fixed"
            minTableWidth={minTableWidth}
            stickyHeader
            stickyColumns={1}
            fillHeight={!infinite && !!paged.data?.items.length && paged.data.items.length === paged.data.pageSize}
            headerCellClassName="px-3! py-2!"
            cellClassName="px-3! py-2!"
            rowClassName={(job) => job.dueAt ? (new Date(job.dueAt).getTime() <= Date.now() ? 'bg-red-50 [--row-tint:var(--color-red-50)]' : 'bg-amber-50 [--row-tint:var(--color-amber-50)]') : ''}
            {...(canBulk && { selected: new Set(selected.keys()), onSelectedChange: changeSelection })}
          />
        </div>
        <div className={`job-list-mobile grid content-start gap-2 md:hidden ${infinite ? '' : 'min-h-full'}`}>
          {isLoading && !data ? <p className="py-10 text-center text-sm text-slate-500">Loading…</p> : !data?.items.length ? <p className="py-10 text-center text-sm text-slate-500">No jobs match these filters</p> : data.items.map((job) => (
            <article key={job.id} style={{ height: cardHeight }} className={`overflow-hidden rounded-lg bg-white px-3 py-2 ring-1 ${job.dueAt ? 'ring-amber-300' : 'ring-slate-200'}`}>
              <div className="flex h-7 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {canBulk && <input type="checkbox" aria-label={`Select ${formatJobNumber(job.jobNumber)}`} checked={selected.has(job.id)} onChange={() => { const ids = new Set(selected.keys()); if (ids.has(job.id)) ids.delete(job.id); else ids.add(job.id); changeSelection(ids); }} className="size-4 shrink-0 accent-brand-600" />}
                  <Link to={`/jobs/${job.id}`} className="shrink-0 font-mono text-sm font-semibold text-brand-600">{formatJobNumber(job.jobNumber)}{job.repeatOf && <span className="ml-1 text-violet-600">↻</span>}</Link>
                  {showCol('status') && <span className="min-w-0 truncate"><JobStatusBadge status={job.status} /></span>}
                </div>
                {showCol('approval') && <span className="shrink-0"><JobRowAction job={job} {...actionHandlers} fallback={null} /></span>}
              </div>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs leading-4">
                {mobile.fields.map((k) => (
                  <div key={k} className={`flex min-w-0 gap-1 ${MOBILE_WIDE.includes(k) ? 'col-span-2' : ''}`}>
                    <dt className="shrink-0 text-slate-400">{MOBILE_LABELS[k] ?? JOB_LIST_COLUMN_LABELS[k]}:</dt>
                    <dd className="min-w-0 truncate font-medium text-slate-700">
                      {k === 'customerMobile'
                        ? <a href={`tel:${job.customer.phone}`} className="text-brand-600">{job.customer.phone}</a>
                        : jobCellText(k, job) || '—'}
                    </dd>
                  </div>
                ))}
                {repeatColumns && (
                  <>
                    <div className="col-span-2 truncate text-slate-400">Repeat of: <span className="font-medium text-slate-700">{job.repeatOf ? formatJobNumber(job.repeatOf) : '—'}</span></div>
                    <div className="col-span-2 truncate text-slate-400">Back at home: <span className="font-medium text-slate-700">{isBackHome(job) ? 'Yes' : 'No'} · {phoneWhereabouts(job)}</span></div>
                  </>
                )}
              </dl>
            </article>
          ))}
        </div>
        {infinite && !!feed.items.length && (
          <div ref={sentinelRef} className="sticky left-0 flex items-center justify-center gap-2 py-3 text-xs text-slate-500">
            {hasNextPage || isFetchingNextPage ? (
              <>
                <Loader2 className="size-4 animate-spin text-brand-600" />
                Loading more… <span className="tabular-nums">{feed.items.length} of {feed.total}</span>
              </>
            ) : (
              <span className="tabular-nums">All {feed.items.length} of {feed.total} jobs loaded</span>
            )}
          </div>
        )}
      </div>

      <div className="job-mobile-footer theme-panel flex shrink-0 items-center justify-between rounded-lg bg-white px-2 ring-1 ring-slate-200 md:hidden">
        <button type="button" onClick={() => setFiltersOpen((open) => !open)} className="relative inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-slate-700" aria-expanded={filtersOpen}>
          {filtersOpen ? <X className="size-4" /> : <SlidersHorizontal className="size-4" />} Filters
          {activeFilterCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] leading-none text-white">{activeFilterCount}</span>}
        </button>
        {counter}
      </div>
      <ApprovalDecisionDialog jobId={approvingId} onClose={() => setApprovingId(null)} />
      <DeliverJobDialog jobId={deliveringId} onClose={() => setDeliveringId(null)} />
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
  const { user } = useAuth();
  // A CCO's cancellation is only a request until the Branch Manager approves it.
  const needsApproval = user?.role === ROLES.CCO;
  const [found, setFound] = useState<JobListItemDto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reason, setReason] = useState('');
  const [loanerReturned, setLoanerReturned] = useState(false);
  const detail = useJob(found?.id ?? '', !!found);
  const loanerOut = detail.data?.loaner && !detail.data.loaner.returnedAt ? detail.data.loaner : null;
  const [refundMode, setRefundMode] = useState<PaymentMode>('CASH');
  const [error, setError] = useState<string>();

  const done = (msg: string) => {
    toast.success(msg);
    setFound(null);
    setReason('');
    setLoanerReturned(false);
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
    mutationFn: () => api.post(`/jobs/${found!.id}/cancel`, { reason, refundMode: found!.paid > 0 ? refundMode : null, loanerReturned }),
    onSuccess: () => done(needsApproval ? `Cancellation of ${found!.jobNumber} sent to the Branch Manager for approval` : `Job ${found!.jobNumber} cancelled`),
    onError: (e) => setError(e instanceof ApiError ? Object.values((e.details as Record<string, string[]>) ?? {})[0]?.[0] ?? e.message : e.message),
  });

  const canCancel = found && CANCELLABLE_STATUSES.includes(found.status);
  return (
    <Card title={canDelete ? 'Delete or cancel a job' : 'Cancel a job'} subtitle="Search the job number and check the details first" icon={Trash2}>
      <JobLookup onFound={(j) => (setFound(j), setError(undefined), setLoanerReturned(false))} initial={params.get('job') ?? ''} />
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
                  {loanerOut && (
                    <label className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                      <input type="checkbox" checked={loanerReturned} onChange={(e) => setLoanerReturned(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
                      <span>Loaner phone <b>{loanerOut.brand} {loanerOut.model}</b> has been received back. The job cannot be cancelled without it.</span>
                    </label>
                  )}
                  <Button disabled={reason.trim().length < 3 || !detail.data || (!!loanerOut && !loanerReturned)} loading={cancel.isPending} onClick={() => cancel.mutate()}>{needsApproval ? 'Send for approval' : 'Cancel job'}</Button>
                  {needsApproval && <p className="text-xs text-slate-500">The job is cancelled only after the Branch Manager approves. Any advance is refunded then.</p>}
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-600">{found.status === 'CANCEL_PENDING' ? "This job's cancellation is already waiting for the Branch Manager." : "This job can't be cancelled at its current stage (repaired, returned or closed)."}</p>
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
