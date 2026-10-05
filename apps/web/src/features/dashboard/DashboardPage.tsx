import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ENGINEER_OPEN_STATUSES,
  JOB_STATUS_LABELS,
  ROLE_LABELS,
  ROLES,
  type JobStatus,
  type TransferDto,
  type Paginated,
  type PartRequestDto,
  type StockRowDto,
  type AuthUser,
  type EngineerWorkloadDto,
  type JobListItemDto,
  type JobStatsDto,
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
import { CancelTransferButton, TransferResponseButtons } from '@/features/jobs/TransferActions';

const useStats = () => useQuery({ queryKey: ['jobs', 'stats'], queryFn: () => api.get<JobStatsDto>('/jobs/stats') });

const jobLink = (j: JobListItemDto) => (
  <Link to={`/jobs/${j.id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">
    {j.jobNumber}
  </Link>
);

export function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
        <p className="mt-1 text-slate-600">
          {ROLE_LABELS[user.role]}
          {user.branch && ` · ${user.branch.name}`}
        </p>
      </div>
      {user.role === ROLES.ENGINEER && <EngineerDashboard />}
      {user.role === ROLES.STOREKEEPER && <StoreDashboard />}
      {([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO] as string[]).includes(user.role) && <BranchDashboard user={user} />}
    </div>
  );
}

// ─── Storekeeper ────────────────────────────────────────────────────────────

function StoreDashboard() {
  const requests = useQuery({ queryKey: ['inventory', 'requests', 'dash'], queryFn: () => api.get<PartRequestDto[]>('/inventory/part-requests?status=open') });
  const low = useQuery({
    queryKey: ['inventory', 'stock', 'low-dash'],
    queryFn: () => api.get<Paginated<StockRowDto>>('/inventory/stock?lowOnly=true&pageSize=200'),
  });
  const pending = requests.data?.filter((r) => r.status === 'REQUESTED').length;
  const waiting = requests.data?.filter((r) => r.status === 'NOT_AVAILABLE').length;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Part requests to handle" value={pending} to="/store/requests" tone="warning" />
        <StatCard label="Waiting for stock" value={waiting} to="/store/requests" />
        <StatCard label="Low-stock parts" value={low.data?.total} to="/store/stock" tone="warning" />
      </div>
      {!!low.data?.items.length && (
        <Card title="Low stock — reorder">
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
    { header: 'With you since', cell: (j) => <span className="text-slate-600">{j.assignedAt ? timeAgo(j.assignedAt) : '—'}</span> },
  ];

  const incoming = useQuery({ queryKey: ['jobs', 'transfers', 'incoming'], queryFn: () => api.get<TransferDto[]>('/jobs/transfers?direction=incoming') });
  const outgoing = useQuery({ queryKey: ['jobs', 'transfers', 'outgoing'], queryFn: () => api.get<TransferDto[]>('/jobs/transfers?direction=outgoing') });

  const card = (label: string, st: JobStatus, tone?: 'warning' | 'info') => (
    <button type="button" onClick={() => setStatus(status === st ? '' : st)} className={`text-left ${status === st ? 'ring-2 ring-brand-500 rounded-lg' : ''}`}>
      <StatCard label={label} value={by?.[st]} tone={tone} />
    </button>
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <button type="button" onClick={() => setStatus('')} className={`text-left ${status === '' ? 'ring-2 ring-brand-500 rounded-lg' : ''}`}>
          <StatCard label="My pending calls" value={open} tone="warning" />
        </button>
        {card('To diagnose', 'ASSIGNED', 'info')}
        {card('Awaiting approval', 'AWAITING_APPROVAL')}
        {card('To repair', 'IN_REPAIR', 'info')}
        {card('Repaired', 'REPAIRED')}
        {card('Testing', 'TESTING')}
        {card('Spare not available', 'SPARE_PENDING', 'warning')}
      </div>
      {!!incoming.data?.length && (
        <Card title={`Transfer requests for you (${incoming.data.length})`}>
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
        <Card title="Your transfer requests (waiting for acceptance)">
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
      <Card title={status ? JOB_STATUS_LABELS[status as JobStatus] : 'My pending calls (oldest first)'}>
        <DataTable columns={columns} rows={rows} rowKey={(j) => j.id} isLoading={isLoading} emptyMessage="Nothing here right now" />
      </Card>
    </>
  );
}

// ─── Branch manager / CCO / Super Admin ─────────────────────────────────────

function BranchDashboard({ user }: { user: AuthUser }) {
  const isSuperAdmin = user.role === ROLES.SUPER_ADMIN;
  const stats = useStats();
  const by = stats.data?.byStatus;
  const queue = useList<JobListItemDto>('jobs', { status: 'RECEIVED', sort: 'oldest', pageSize: 10 });
  const approvals = useList<JobListItemDto>('jobs', { status: 'AWAITING_APPROVAL', sort: 'oldest', pageSize: 20 });
  const spares = useList<JobListItemDto>('jobs', { status: 'SPARE_PENDING', sort: 'oldest', pageSize: 20 });
  const ready = useList<JobListItemDto>('jobs', { status: 'READY_FOR_DELIVERY', sort: 'oldest', pageSize: 50 });
  const rwr = useList<JobListItemDto>('jobs', { status: 'RWR', sort: 'oldest', pageSize: 50 });
  const collection = [...(ready.data?.items ?? []), ...(rwr.data?.items ?? [])];
  const toCollect = collection.reduce((s, j) => s + Math.max(0, (j.status === 'RWR' ? 0 : (j.quotedAmount ?? 0)) - j.paid), 0);
  const engineers = useQuery({
    queryKey: ['engineers', user.branch?.id],
    queryFn: () => api.get<EngineerWorkloadDto[]>('/jobs/engineers'),
    enabled: !isSuperAdmin,
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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Awaiting assignment" value={by?.RECEIVED} tone="warning" />
        <StatCard label="Approval needed" value={by?.AWAITING_APPROVAL} tone="warning" />
        <StatCard label="With engineers" value={withEngineer} tone="info" />
        <StatCard label="Spare not available" value={by?.SPARE_PENDING} tone="warning" />
        <StatCard label="Ready – returned OK" value={by?.READY_FOR_DELIVERY} />
        <StatCard label="RWR (unrepaired)" value={by?.RWR} />
        <StatCard label="Delivered" value={by?.DELIVERED} />
        <StatCard label="Customer rejected" value={by?.CUSTOMER_REJECTED} />
        <StatCard label="Total jobs" value={stats.data?.total} to="/jobs" />
      </div>

      <Card
        title={`Ready for collection — call customers (${collection.length})`}
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

      <Card title="Customer approval needed — call these customers">
        <DataTable
          columns={approvalColumns}
          rows={approvals.data?.items}
          rowKey={(j) => j.id}
          isLoading={approvals.isLoading}
          emptyMessage="No estimates waiting for customer approval"
        />
      </Card>

      {!!spares.data?.items.length && (
        <Card title="Waiting for spare parts">
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
          <Card title="Engineer workload" className="h-fit">
            {engineers.data?.length ? (
              <ul className="space-y-2">
                {engineers.data.map((e) => (
                  <li key={e.id} className="flex items-center justify-between text-sm">
                    <span>{e.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">{e.openJobs} open</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">{engineers.isLoading ? 'Loading…' : 'No active engineers'}</p>
            )}
          </Card>
        )}
      </div>

      <AssignEngineerDialog
        job={
          assigning
            ? { id: assigning.id, jobNumber: assigning.jobNumber, branchId: assigning.branch.id, assignedEngineerId: null }
            : null
        }
        onClose={() => setAssigning(null)}
      />
    </>
  );
}
