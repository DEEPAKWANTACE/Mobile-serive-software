import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  JOB_STATUS_LABELS,
  JOB_STATUSES,
  ROLES,
  type BranchDto,
  type EngineerWorkloadDto,
  type JobListItemDto,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FilterBar, FilterSelect, SearchInput } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/auth-context';
import { useListState } from '@/hooks/use-list-state';
import { api } from '@/lib/api-client';
import { useList, useOptions } from '@/lib/crud';
import { formatDateTime } from '@/lib/format';
import { JobStatusBadge } from './JobStatusBadge';

export function JobsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const isEngineer = user?.role === ROLES.ENGINEER;
  const canCreate = user?.role === ROLES.CCO || user?.role === ROLES.BRANCH_MANAGER;

  const list = useListState({ status: '', branchId: '', engineerId: '' });
  const { data, isLoading } = useList<JobListItemDto>('jobs', list.params);
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: isSuperAdmin });
  // Engineer filter needs a branch: own branch for staff, the selected one for Super Admin.
  const engineerBranch = isSuperAdmin ? list.filters.branchId : user?.branch?.id;
  const engineers = useQuery({
    queryKey: ['engineers', engineerBranch],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers?branchId=${engineerBranch}`),
    enabled: !isEngineer && !!engineerBranch,
  });

  const columns: Column<JobListItemDto>[] = [
    {
      header: 'Job no.',
      cell: (j) => (
        <Link to={`/jobs/${j.id}`} className="font-mono text-sm font-semibold text-brand-600 hover:underline">
          {j.jobNumber}
        </Link>
      ),
    },
    { header: 'Received', cell: (j) => <span className="whitespace-nowrap text-slate-600">{formatDateTime(j.createdAt)}</span> },
    {
      header: 'Customer',
      cell: (j) => (
        <div>
          <div className="font-medium">{j.customer.name}</div>
          <div className="text-xs text-slate-500">{j.customer.phone}</div>
        </div>
      ),
    },
    {
      header: 'Device',
      cell: (j) => (
        <div>
          <div>{j.device}</div>
          {isEngineer ? (
            <div className="text-xs text-slate-500">{j.faults.join(', ')}</div>
          ) : (
            j.imei && <div className="font-mono text-xs text-slate-500">{j.imei}</div>
          )}
        </div>
      ),
    },
    ...(isEngineer
      ? []
      : [
          {
            header: 'Engineer',
            cell: (j: JobListItemDto) => j.assignedEngineer?.name ?? <span className="text-slate-400">Unassigned</span>,
          },
        ]),
    ...(isSuperAdmin ? [{ header: 'Branch', cell: (j: JobListItemDto) => j.branch.code }] : []),
    { header: 'Status', cell: (j) => <JobStatusBadge status={j.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title={isEngineer ? 'My Jobs' : 'Job Sheets'}
        description={isEngineer ? 'Jobs assigned to you' : isSuperAdmin ? 'All branches' : user?.branch?.name}
        actions={
          canCreate && (
            <Link to="/jobs/new">
              <Button>New job sheet</Button>
            </Link>
          )
        }
      />
      <FilterBar>
        <SearchInput onSearch={list.setSearch} placeholder="Job no., customer, mobile, IMEI" />
        <FilterSelect
          value={list.filters.status}
          onChange={(v) => list.setFilter('status', v)}
          placeholder="All statuses"
          options={JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] }))}
        />
        {!isEngineer && (
          <FilterSelect
            value={list.filters.engineerId}
            onChange={(v) => list.setFilter('engineerId', v)}
            placeholder={engineerBranch ? 'All engineers' : 'Select branch for engineers'}
            disabled={!engineerBranch}
            options={[
              { value: 'none', label: 'Unassigned' },
              ...(engineers.data ?? []).map((e) => ({ value: e.id, label: e.name })),
            ]}
          />
        )}
        {isSuperAdmin && (
          <FilterSelect
            value={list.filters.branchId}
            onChange={(v) => list.setFilter('branchId', v, { engineerId: '' })}
            placeholder="All branches"
            options={branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
          />
        )}
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(j) => j.id} isLoading={isLoading} emptyMessage="No job sheets yet" />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}
    </div>
  );
}
