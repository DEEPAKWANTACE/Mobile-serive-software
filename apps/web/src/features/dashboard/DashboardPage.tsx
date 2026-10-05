import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ROLE_LABELS,
  ROLES,
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
import { timeAgo } from '@/lib/format';
import { StatCard } from './StatCard';

const useStats = () => useQuery({ queryKey: ['jobs', 'stats'], queryFn: () => api.get<JobStatsDto>('/jobs/stats') });

const jobLink = (j: JobListItemDto) => (
  <Link to={`/jobs/${j.id}`} className="font-mono text-sm font-semibold text-brand-600 hover:underline">
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
      {([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO] as string[]).includes(user.role) && <BranchDashboard user={user} />}
    </div>
  );
}

// ─── Engineer ───────────────────────────────────────────────────────────────

function EngineerDashboard() {
  const stats = useStats();
  const { data, isLoading } = useList<JobListItemDto>('jobs', { status: 'ASSIGNED', sort: 'oldest', pageSize: 50 });

  const columns: Column<JobListItemDto>[] = [
    { header: 'Job no.', cell: jobLink },
    { header: 'Device', cell: (j) => <span className="font-medium">{j.device}</span> },
    { header: 'Faults', cell: (j) => <span className="text-slate-600">{j.faults.join(', ')}</span> },
    { header: 'Waiting', cell: (j) => <span className="text-slate-600">{timeAgo(j.createdAt)}</span> },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Assigned to me" value={stats.data?.byStatus.ASSIGNED} to="/jobs" tone="info" />
        <StatCard label="All my jobs" value={stats.data?.total} to="/jobs" />
      </div>
      <Card title="My queue (oldest first)">
        <DataTable columns={columns} rows={data?.items} rowKey={(j) => j.id} isLoading={isLoading} emptyMessage="No jobs assigned to you right now" />
      </Card>
    </>
  );
}

// ─── Branch manager / CCO / Super Admin ─────────────────────────────────────

function BranchDashboard({ user }: { user: AuthUser }) {
  const isSuperAdmin = user.role === ROLES.SUPER_ADMIN;
  const stats = useStats();
  const queue = useList<JobListItemDto>('jobs', { status: 'RECEIVED', sort: 'oldest', pageSize: 10 });
  const engineers = useQuery({
    queryKey: ['engineers', user.branch?.id],
    queryFn: () => api.get<EngineerWorkloadDto[]>('/jobs/engineers'),
    enabled: !isSuperAdmin,
  });
  const [assigning, setAssigning] = useState<JobListItemDto | null>(null);

  const columns: Column<JobListItemDto>[] = [
    { header: 'Job no.', cell: jobLink },
    { header: 'Waiting', cell: (j) => <span className="text-slate-600">{timeAgo(j.createdAt)}</span> },
    { header: 'Device', cell: (j) => j.device },
    { header: 'Faults', cell: (j) => <span className="text-slate-600">{j.faults.join(', ')}</span> },
    ...(isSuperAdmin ? [{ header: 'Branch', cell: (j: JobListItemDto) => j.branch.code }] : []),
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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Awaiting assignment" value={stats.data?.byStatus.RECEIVED} tone="warning" />
        <StatCard label="Assigned" value={stats.data?.byStatus.ASSIGNED} tone="info" />
        <StatCard label="Total jobs" value={stats.data?.total} to="/jobs" />
      </div>

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
          <DataTable columns={columns} rows={queue.data?.items} rowKey={(j) => j.id} isLoading={queue.isLoading} emptyMessage="All jobs are assigned 🎉" />
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
