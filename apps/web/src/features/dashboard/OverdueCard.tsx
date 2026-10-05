import { Link } from 'react-router';
import type { JobListItemDto } from '@msm/shared';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { useList } from '@/lib/crud';
import { formatDate } from '@/lib/format';

export const TAT_LIMIT_DAYS = 15;
export const TAT_WARN_DAYS = 10;

export const ageDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export function AgeBadge({ createdAt }: { createdAt: string }) {
  const d = ageDays(createdAt);
  const cls = d >= TAT_LIMIT_DAYS ? 'bg-red-600 text-white' : d >= TAT_WARN_DAYS ? 'bg-amber-100 text-amber-800' : d >= 1 ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-700';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${cls}`}>{d === 0 ? 'Today' : `${d} day${d === 1 ? '' : 's'}`}</span>;
}

/**
 * Jobs received yesterday or earlier and not yet delivered — the client's target is same-day service and
 * never more than 15 days. Highlights 10+ (amber) and 15+ (red).
 */
export function OverdueCard({ branchId }: { branchId?: string }) {
  const base = { open: true, sort: 'oldest' as const, here: true, branchId };
  const overdue = useList<JobListItemDto>('jobs', { ...base, minAgeDays: 1, pageSize: 15 });
  const warn = useList<JobListItemDto>('jobs', { ...base, minAgeDays: TAT_WARN_DAYS, pageSize: 1 });
  const breached = useList<JobListItemDto>('jobs', { ...base, minAgeDays: TAT_LIMIT_DAYS, pageSize: 1 });

  const columns: Column<JobListItemDto>[] = [
    {
      header: 'Job no.',
      cell: (j) => (
        <Link to={`/jobs/${j.id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">
          {j.jobNumber}
        </Link>
      ),
    },
    { header: 'Pending for', cell: (j) => <AgeBadge createdAt={j.createdAt} /> },
    { header: 'Due by', cell: (j) => <span className="text-slate-600">{formatDate(new Date(new Date(j.createdAt).getTime() + TAT_LIMIT_DAYS * 86_400_000).toISOString())}</span> },
    { header: 'Device', cell: (j) => j.device },
    { header: 'Status', cell: (j) => <JobStatusBadge status={j.status} /> },
    { header: 'With', cell: (j) => j.assignedEngineer?.name ?? <span className="text-amber-700">Not assigned</span> },
  ];

  return (
    <Card
      title={`Overdue — pending since yesterday or earlier (${overdue.data?.total ?? '…'})`}
      actions={
        <span className="flex gap-2 text-xs">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">{warn.data?.total ?? 0} at {TAT_WARN_DAYS}+ days</span>
          <span className="rounded-full bg-red-600 px-2 py-0.5 font-medium text-white">{breached.data?.total ?? 0} at {TAT_LIMIT_DAYS}+ days (limit crossed)</span>
        </span>
      }
    >
      <DataTable columns={columns} rows={overdue.data?.items} rowKey={(j) => j.id} isLoading={overdue.isLoading} emptyMessage="No overdue jobs — everything is within same-day service 🎉" />
    </Card>
  );
}
