import type React from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  Boxes,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  Clock,
  FilePlus2,
  HandCoins,
  Inbox,
  PackageCheck,
  PackageSearch,
  PhoneCall,
  Plus,
  Receipt,
  Search,
  ShieldAlert,
  Stethoscope,
  TestTube2,
  Truck,
  UserCheck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  ENGINEER_OPEN_STATUSES,
  JOB_STATUS_LABELS,
  ROLES,
  type JobStatus,
  type TransferDto,
  type DayBookDto,
  type PendingCollectionSummaryDto,
  type Paginated,
  type PartRequestDto,
  type StockRowDto,
  type AuthUser,
  type EngineerWorkloadDto,
  type JobListItemDto,
  type JobStatsDto,
  type JobTrendDto,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useAuth } from '@/features/auth/auth-context';
import { AssignEngineerDialog } from '@/features/jobs/AssignEngineerDialog';
import { api } from '@/lib/api-client';
import { useList } from '@/lib/crud';
import { formatCurrency, timeAgo } from '@/lib/format';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { StatCard } from './StatCard';
import { DashboardHero, HeroAction } from './DashboardHero';
import { TrendChart } from '@/components/charts/TrendChart';
import { BarList } from '@/components/charts/BarList';
import { FranchisePicker, type FranchiseSelection } from './FranchisePicker';
import { AgeBadge, OverdueCard } from './OverdueCard';
import { CancelTransferButton, TransferResponseButtons } from '@/features/jobs/TransferActions';

const useStats = () => useQuery({ queryKey: ['jobs', 'stats'], queryFn: () => api.get<JobStatsDto>('/jobs/stats') });

const jobLink = (j: JobListItemDto) => (
  <Link to={`/jobs/${j.id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">
    {j.jobNumber}
  </Link>
);

const link = (to: string, label: string, Icon: React.ComponentType<{ className?: string }>) => (
  <Link to={to}>
    <HeroAction>
      <Icon className="size-4" />
      {label}
    </HeroAction>
  </Link>
);

function heroActions(role: string) {
  switch (role) {
    case ROLES.CCO:
    case ROLES.BRANCH_MANAGER:
      return (
        <>
          {link('/jobs/new', 'New job sheet', Plus)}
          {link('/calling', 'Customer calling', PhoneCall)}
          {link('/jobs', 'Find a job', Search)}
        </>
      );
    case ROLES.ENGINEER:
      return link('/jobs', 'My jobs', ClipboardList);
    case ROLES.STOREKEEPER:
      return (
        <>
          {link('/store/requests', 'Part requests', Inbox)}
          {link('/store/stock', 'Stock', Boxes)}
        </>
      );
    case ROLES.ACCOUNTS:
      return (
        <>
          {link('/accounts/day-book', 'Day book', Wallet)}
          {link('/reports', 'Reports', ClipboardList)}
        </>
      );
    case ROLES.SUPER_ADMIN:
      return (
        <>
          {link('/reports', 'Reports', ClipboardList)}
          {link('/accounts/day-book', 'Day book', Wallet)}
          {link('/jobs', 'All jobs', Search)}
        </>
      );
    default:
      return null;
  }
}

export function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <DashboardHero user={user} actions={heroActions(user.role)} />
      {user.role === ROLES.ENGINEER && <EngineerDashboard />}
      {user.role === ROLES.STOREKEEPER && <StoreDashboard />}
      {user.role === ROLES.ACCOUNTS && <AccountsDashboard />}
      {user.role === ROLES.SUPER_ADMIN && <AdminDashboard user={user} />}
      {(user.role === ROLES.BRANCH_MANAGER || user.role === ROLES.CCO) && <BranchDashboard user={user} />}
    </div>
  );
}

/** Section heading between dashboard blocks. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{children}</h2>;
}

// ─── Accounts ───────────────────────────────────────────────────────────────

function AccountsDashboard() {
  const book = useQuery({ queryKey: ['accounts', 'day-book', 'today'], queryFn: () => api.get<DayBookDto>('/accounts/day-book') });
  const pending = useQuery({ queryKey: ['calling', 'summary', 'dash'], queryFn: () => api.get<PendingCollectionSummaryDto>('/calling/summary') });
  const money = (v?: number) => (v === undefined ? undefined : formatCurrency(v));
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Received today" value={money(book.data?.received.total)} to="/accounts/day-book" tone="brand" icon={Banknote} />
        <StatCard label="Expenses today" value={money(book.data?.expenses.total)} to="/accounts/day-book" icon={Receipt} />
        <StatCard label="Net today" value={money(book.data?.net)} to="/accounts/day-book" tone="brand" icon={CircleDollarSign} />
        <StatCard label="Cash in hand" value={money(book.data?.cashInHand)} to="/accounts/day-book" icon={Wallet} />
        <StatCard label="Pending collection" value={money(pending.data?.ready.amount)} to="/calling" tone="warning" icon={HandCoins} />
      </div>
      <TrendCard />
    </>
  );
}

// ─── Storekeeper ────────────────────────────────────────────────────────────

function StoreDashboard() {
  const requests = useQuery({ queryKey: ['inventory', 'requests', 'dash'], queryFn: () => api.get<PartRequestDto[]>('/inventory/part-requests?status=open') });
  const low = useQuery({
    queryKey: ['inventory', 'stock', 'low-dash'],
    queryFn: () => api.get<Paginated<StockRowDto>>('/inventory/stock?lowOnly=true&pageSize=200'),
  });
  const incoming = useQuery({ queryKey: ['inventory', 'transfers', 'incoming', 'dash'], queryFn: () => api.get<unknown[]>('/inventory/transfers?view=incoming') });
  const pending = requests.data?.filter((r) => r.status === 'REQUESTED').length;
  const waiting = requests.data?.filter((r) => r.status === 'NOT_AVAILABLE').length;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Part requests to handle" value={pending} to="/store/requests" tone={pending ? 'warning' : 'default'} icon={Inbox} />
        <StatCard label="Waiting for stock" value={waiting} to="/store/requests" icon={PackageSearch} />
        <StatCard label="Low-stock parts" value={low.data?.total} to="/store/stock" tone={low.data?.total ? 'critical' : 'default'} icon={AlertTriangle} />
        <StatCard label="Parts to receive" value={incoming.data?.length} to="/store/transfers" tone="brand" icon={ArrowLeftRight} hint="From other branches" />
      </div>
      {!!low.data?.items.length && (
        <Card title="Low stock — reorder" icon={AlertTriangle} subtitle="At or below the reorder level">
          <ul className="divide-y divide-slate-100 text-sm">
            {low.data.items.map((r) => (
              <li key={r.part.id} className="flex justify-between py-2">
                <span>
                  <span className="font-mono font-semibold">{r.part.code}</span> · {r.part.name}
                </span>
                <span className="font-semibold text-red-600">{r.quantity} left</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

// ─── Engineer ───────────────────────────────────────────────────────────────

function EngineerDashboard() {
  const stats = useStats();
  const by = stats.data?.byStatus;
  const open = by ? ENGINEER_OPEN_STATUSES.reduce((sum, st) => sum + by[st], 0) : undefined;
  const [status, setStatus] = useState<string>('');
  const { data, isLoading } = useList<JobListItemDto>('jobs', { status, sort: 'oldest', pageSize: 50 });
  const rows = status ? data?.items : data?.items.filter((j) => ENGINEER_OPEN_STATUSES.includes(j.status));

  const columns: Column<JobListItemDto>[] = [
    { header: 'Job no.', cell: jobLink },
    { header: 'Device', cell: (j) => <span className="font-medium">{j.device}</span> },
    { header: 'Faults', cell: (j) => <span className="text-slate-600">{j.faults.join(', ')}</span> },
    {
      header: 'Status',
      cell: (j) => (
        <span className="flex items-center gap-1.5">
          <JobStatusBadge status={j.status} />
          {j.hasPendingTransfer && <span title="Transfer requested">🔁</span>}
        </span>
      ),
    },
    { header: 'Pending for', cell: (j) => <AgeBadge createdAt={j.createdAt} /> },
    { header: 'With you since', cell: (j) => <span className="text-slate-600">{j.assignedAt ? timeAgo(j.assignedAt) : '—'}</span> },
  ];

  const incoming = useQuery({ queryKey: ['jobs', 'transfers', 'incoming'], queryFn: () => api.get<TransferDto[]>('/jobs/transfers?direction=incoming') });
  const outgoing = useQuery({ queryKey: ['jobs', 'transfers', 'outgoing'], queryFn: () => api.get<TransferDto[]>('/jobs/transfers?direction=outgoing') });

  const card = (label: string, st: JobStatus, icon: React.ComponentType<{ className?: string }>, tone?: 'warning' | 'brand') => (
    <button type="button" onClick={() => setStatus(status === st ? '' : st)} className={`rounded-xl text-left ${status === st ? 'ring-2 ring-brand-500' : ''}`}>
      <StatCard label={label} value={by?.[st]} tone={tone} icon={icon} />
    </button>
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <button type="button" onClick={() => setStatus('')} className={`rounded-xl text-left ${status === '' ? 'ring-2 ring-brand-500' : ''}`}>
          <StatCard label="My pending calls" value={open} tone="brand" icon={ClipboardList} />
        </button>
        {card('To diagnose', 'ASSIGNED', Stethoscope, 'brand')}
        {card('Awaiting approval', 'AWAITING_APPROVAL', Clock)}
        {card('To repair', 'IN_REPAIR', Wrench, 'brand')}
        {card('Repaired', 'REPAIRED', BadgeCheck)}
        {card('Testing', 'TESTING', TestTube2)}
        {card('Spare not available', 'SPARE_PENDING', PackageSearch, 'warning')}
      </div>
      {!!incoming.data?.length && (
        <Card title={`Transfer requests for you (${incoming.data.length})`} icon={ArrowLeftRight} subtitle="Accept to take over the job">
          <ul className="divide-y divide-slate-100">
            {incoming.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="text-sm">
                  <Link to={`/jobs/${t.job.id}`} className="font-mono font-semibold text-brand-600 hover:underline">
                    {t.job.jobNumber}
                  </Link>{' '}
                  · {t.job.device} · from <span className="font-medium">{t.from.name}</span>
                  <div className="text-xs text-slate-500">
                    “{t.reason}” · {timeAgo(t.createdAt)} ago
                  </div>
                </div>
                <TransferResponseButtons transferId={t.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!!outgoing.data?.length && (
        <Card title="Your transfer requests" icon={ArrowLeftRight} subtitle="Waiting for the other engineer to accept">
          <ul className="divide-y divide-slate-100">
            {outgoing.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <span>
                  <span className="font-mono font-semibold">{t.job.jobNumber}</span> → {t.to.name} · {timeAgo(t.createdAt)} ago
                </span>
                <CancelTransferButton transferId={t.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={status ? JOB_STATUS_LABELS[status as JobStatus] : 'My queue'} subtitle="Oldest first" icon={ClipboardList}>
        <DataTable columns={columns} rows={rows} rowKey={(j) => j.id} isLoading={isLoading} emptyMessage="Nothing here right now" />
      </Card>
    </>
  );
}

// ─── Super Admin: franchise view ────────────────────────────────────────────

function AdminDashboard({ user }: { user: AuthUser }) {
  const [view, setView] = useState<FranchiseSelection>({ stateId: '', cityId: '', branchId: '' });
  return (
    <>
      <FranchisePicker value={view} onChange={setView} />
      <BranchDashboard key={view.branchId} user={user} branchId={view.branchId || undefined} />
    </>
  );
}

// ─── Branch manager / CCO / Super Admin ─────────────────────────────────────

function BranchDashboard({ user, branchId }: { user: AuthUser; branchId?: string }) {
  // Super Admin looking at one branch behaves like that branch's dashboard.
  const isSuperAdmin = user.role === ROLES.SUPER_ADMIN && !branchId;
  const stats = useQuery({
    queryKey: ['jobs', 'stats', branchId],
    queryFn: () => api.get<JobStatsDto>(`/jobs/stats${branchId ? `?branchId=${branchId}` : ''}`),
  });
  const by = stats.data?.byStatus;
  const queue = useList<JobListItemDto>('jobs', { status: 'RECEIVED', sort: 'oldest', pageSize: 10, here: true, branchId });
  const approvals = useList<JobListItemDto>('jobs', { status: 'AWAITING_APPROVAL', sort: 'oldest', pageSize: 20, owned: true, branchId });
  const spares = useList<JobListItemDto>('jobs', { status: 'SPARE_PENDING', sort: 'oldest', pageSize: 20, here: true, branchId });
  const ready = useList<JobListItemDto>('jobs', { status: 'READY_FOR_DELIVERY', sort: 'oldest', pageSize: 50, owned: true, branchId });
  const followUps = useQuery({
    queryKey: ['calling', 'summary', 'dash', branchId],
    queryFn: () => api.get<PendingCollectionSummaryDto>(`/calling/summary${branchId ? `?branchId=${branchId}` : ''}`),
  });
  const rwr = useList<JobListItemDto>('jobs', { status: 'RWR', sort: 'oldest', pageSize: 50, owned: true, branchId });
  const collection = [...(ready.data?.items ?? []), ...(rwr.data?.items ?? [])];
  const toCollect = collection.reduce((s, j) => s + Math.max(0, (j.status === 'RWR' ? 0 : (j.quotedAmount ?? 0)) - j.paid), 0);
  const engineerBranch = user.branch?.id ?? branchId;
  const engineers = useQuery({
    queryKey: ['engineers', engineerBranch],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers?branchId=${engineerBranch}`),
    enabled: !!engineerBranch,
  });
  const [assigning, setAssigning] = useState<JobListItemDto | null>(null);
  const withEngineer = by ? (['ASSIGNED', 'IN_REPAIR', 'REPAIRED', 'TESTING'] as const).reduce((s, st) => s + by[st], 0) : undefined;

  const branchCol = isSuperAdmin ? [{ header: 'Branch', cell: (j: JobListItemDto) => j.branch.code }] : [];

  const approvalColumns: Column<JobListItemDto>[] = [
    { header: 'Job no.', cell: jobLink },
    {
      header: 'Customer',
      cell: (j) => (
        <div>
          <div className="font-medium">{j.customer.name}</div>
          <a href={`tel:${j.customer.phone}`} className="text-xs text-brand-600 hover:underline">
            📞 {j.customer.phone}
          </a>
        </div>
      ),
    },
    { header: 'Device', cell: (j) => j.device },
    { header: 'Estimate', cell: (j) => <span className="font-semibold">{j.quotedAmount !== null ? formatCurrency(j.quotedAmount) : '—'}</span> },
    { header: 'Engineer', cell: (j) => j.assignedEngineer?.name ?? '—' },
    ...branchCol,
    {
      header: '',
      className: 'text-right',
      cell: (j) => (
        <Link to={`/jobs/${j.id}`}>
          <Button size="sm">Record answer</Button>
        </Link>
      ),
    },
  ];

  const queueColumns: Column<JobListItemDto>[] = [
    { header: 'Job no.', cell: jobLink },
    { header: 'Waiting', cell: (j) => <span className="text-slate-600">{timeAgo(j.createdAt)}</span> },
    { header: 'Device', cell: (j) => j.device },
    { header: 'Faults', cell: (j) => <span className="text-slate-600">{j.faults.join(', ')}</span> },
    ...branchCol,
    {
      header: '',
      className: 'text-right',
      cell: (j) => (
        <Button size="sm" onClick={() => setAssigning(j)}>
          Assign
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Awaiting assignment" value={by?.RECEIVED} tone={by?.RECEIVED ? 'warning' : 'default'} icon={UserCheck} hint="Phones here without an engineer" />
        <StatCard label="With engineers" value={withEngineer} tone="brand" icon={Wrench} hint="Diagnosis, repair & testing" />
        <StatCard label="Ready for collection" value={by ? by.READY_FOR_DELIVERY + by.RWR : undefined} tone="good" icon={PackageCheck} hint={toCollect > 0 ? `${formatCurrency(toCollect)} to collect` : undefined} />
        <StatCard label="Approval needed" value={by?.AWAITING_APPROVAL} tone={by?.AWAITING_APPROVAL ? 'warning' : 'default'} icon={PhoneCall} hint="Call these customers" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat label="Spare not available" value={by?.SPARE_PENDING} icon={PackageSearch} />
        <MiniStat label="Follow-ups due" value={followUps.data?.followUpsDue} icon={CalendarClock} to="/calling" />
        <MiniStat label="At L4 / in transit" value={stats.data?.atL4} icon={Truck} to="/l4" />
        <MiniStat label="Customer rejected" value={by?.CUSTOMER_REJECTED} icon={ShieldAlert} />
        <MiniStat label="Delivered" value={by?.DELIVERED} icon={FilePlus2} />
        <MiniStat label="Total jobs" value={stats.data?.total} icon={Users} to="/jobs" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrendCard branchId={branchId} />
        </div>
        <Card title="Where jobs are now" subtitle="Phones at this branch, by stage" icon={ClipboardList} className="h-full">
          <BarList
            items={by ? PIPELINE.map(([st, label]) => ({ key: st, label, value: by[st], to: `/jobs?status=${st}` })) : []}
            emptyText="Loading…"
          />
        </Card>
      </div>

      <OverdueCard branchId={branchId} />

      <Card
        title={`Ready for collection (${collection.length})`}
        subtitle="Call the customer, then deliver & bill"
        icon={PackageCheck}
        actions={toCollect > 0 && <span className="text-sm font-medium text-slate-700">To collect: {formatCurrency(toCollect)}</span>}
      >
        <DataTable
          columns={[
            { header: 'Job no.', cell: jobLink },
            {
              header: 'Customer',
              cell: (j) => (
                <div>
                  <div className="font-medium">{j.customer.name}</div>
                  <a href={`tel:${j.customer.phone}`} className="text-xs text-brand-600 hover:underline">
                    📞 {j.customer.phone}
                  </a>
                </div>
              ),
            },
            { header: 'Device', cell: (j) => j.device },
            { header: 'Status', cell: (j) => <JobStatusBadge status={j.status} /> },
            {
              header: 'Balance',
              cell: (j) => {
                const bal = (j.status === 'RWR' ? 0 : (j.quotedAmount ?? 0)) - j.paid;
                return <span className={`font-semibold ${bal < 0 ? 'text-orange-700' : ''}`}>{bal < 0 ? `Refund ${formatCurrency(-bal)}` : formatCurrency(bal)}</span>;
              },
            },
            { header: 'Waiting', cell: (j) => <span className="text-slate-600">{timeAgo(j.createdAt)}</span> },
            ...branchCol,
            {
              header: '',
              className: 'text-right',
              cell: (j) => (
                <Link to={`/jobs/${j.id}`}>
                  <Button size="sm">Deliver</Button>
                </Link>
              ),
            },
          ]}
          rows={collection}
          rowKey={(j) => j.id}
          isLoading={ready.isLoading || rwr.isLoading}
          emptyMessage="No phones waiting for collection"
        />
      </Card>

      <Card title="Customer approval needed" subtitle="Call and record the customer's answer" icon={PhoneCall}>
        <DataTable
          columns={approvalColumns}
          rows={approvals.data?.items}
          rowKey={(j) => j.id}
          isLoading={approvals.isLoading}
          emptyMessage="No estimates waiting for customer approval"
        />
      </Card>

      {!!spares.data?.items.length && (
        <Card title="Waiting for spare parts" icon={PackageSearch}>
          <DataTable
            columns={[
              { header: 'Job no.', cell: jobLink },
              { header: 'Part needed', cell: (j) => <span className="font-medium">{j.sparePart}</span> },
              { header: 'Device', cell: (j) => j.device },
              { header: 'Engineer', cell: (j) => j.assignedEngineer?.name ?? '—' },
              ...branchCol,
            ]}
            rows={spares.data.items}
            rowKey={(j) => j.id}
          />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card
          title="Waiting for an engineer"
          subtitle="Oldest first"
          icon={UserCheck}
          className={isSuperAdmin ? 'lg:col-span-3' : 'lg:col-span-2'}
          actions={
            (queue.data?.total ?? 0) > 10 && (
              <Link to="/jobs" className="text-sm text-brand-600 hover:underline">
                View all {queue.data?.total}
              </Link>
            )
          }
        >
          <DataTable columns={queueColumns} rows={queue.data?.items} rowKey={(j) => j.id} isLoading={queue.isLoading} emptyMessage="All jobs are assigned 🎉" />
        </Card>

        {!isSuperAdmin && (
          <Card title="Engineer workload" subtitle="Open jobs per engineer" icon={Users} className="h-fit">
            <BarList
              items={(engineers.data ?? []).map((e) => ({ key: e.id, label: e.name, value: e.openJobs }))}
              emptyText={engineers.isLoading ? 'Loading…' : 'No active engineers'}
            />
          </Card>
        )}
      </div>

      <AssignEngineerDialog
        job={
          assigning
            ? { id: assigning.id, jobNumber: assigning.jobNumber, branchId: assigning.currentBranch.id, assignedEngineerId: null }
            : null
        }
        onClose={() => setAssigning(null)}
      />
    </>
  );
}

// ─── Shared dashboard pieces ────────────────────────────────────────────────

/** Workflow stages shown in the "where jobs are now" bars, in workflow order. */
const PIPELINE: [JobStatus, string][] = [
  ['RECEIVED', 'Awaiting engineer'],
  ['ASSIGNED', 'Diagnosis'],
  ['AWAITING_APPROVAL', 'Customer approval'],
  ['IN_REPAIR', 'In repair'],
  ['SPARE_PENDING', 'Spare not available'],
  ['REPAIRED', 'Repaired'],
  ['TESTING', 'Testing'],
  ['READY_FOR_DELIVERY', 'Ready (OK)'],
  ['RWR', 'Ready (RWR)'],
];

// Validated categorical slots 1 & 2 (blue / orange) — see the dataviz palette.
const SERIES = [
  { key: 'received', label: 'Received', color: '#2a78d6' },
  { key: 'delivered', label: 'Delivered', color: '#eb6834' },
];

function TrendCard({ branchId }: { branchId?: string }) {
  const [days, setDays] = useState(14);
  const trend = useQuery({
    queryKey: ['jobs', 'trend', days, branchId],
    queryFn: () => api.get<JobTrendDto>(`/jobs/trend?days=${days}${branchId ? `&branchId=${branchId}` : ''}`),
  });
  const totals = (trend.data ?? []).reduce((t, d) => ({ in: t.in + d.received, out: t.out + d.delivered }), { in: 0, out: 0 });
  return (
    <Card
      title="Jobs in & out"
      subtitle={`Last ${days} days · ${totals.in} received · ${totals.out} delivered`}
      icon={CalendarClock}
      className="h-full"
      actions={
        <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs">
          {[7, 14, 30].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className={`rounded px-2 py-1 ${days === d ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {d}d
            </button>
          ))}
        </div>
      }
    >
      {trend.data ? (
        <TrendChart data={trend.data} series={SERIES} height={300} ariaLabel={`Jobs received and delivered per day, last ${days} days`} />
      ) : (
        <div className="h-[324px] animate-pulse rounded-lg bg-slate-50" />
      )}
    </Card>
  );
}

function MiniStat({ label, value, icon: Icon, to }: { label: string; value: number | undefined; icon: React.ComponentType<{ className?: string }>; to?: string }) {
  const body = (
    <div className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-3 ring-1 ring-slate-200/80 transition hover:shadow-sm">
      <Icon className="size-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <div className="truncate text-xs text-slate-500">{label}</div>
        <div className="text-lg leading-tight font-semibold text-slate-900 tabular-nums">{value ?? '–'}</div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}
