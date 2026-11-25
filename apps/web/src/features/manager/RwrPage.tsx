import { useState } from 'react';
import { Link } from 'react-router';
import type { JobListItemDto } from '@msm/shared';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { useList } from '@/lib/crud';
import { formatDateTime, formatJobNumber } from '@/lib/format';

type Tab = 'PENDING' | 'RWR';

const columns: Column<JobListItemDto>[] = [
  {
    header: 'Job no.',
    cell: (j) => (
      <Link to={`/jobs/${j.id}`} className="font-mono font-semibold text-brand-600 hover:underline">
        {formatJobNumber(j.jobNumber)}
      </Link>
    ),
  },
  { header: 'Customer', cell: (j) => `${j.customer.name} · ${j.customer.phone}` },
  { header: 'Device', cell: (j) => j.device },
  { header: 'Engineer', cell: (j) => j.assignedEngineer?.name ?? '—' },
  { header: 'Branch', cell: (j) => j.branch.code },
  { header: 'Received', cell: (j) => formatDateTime(j.createdAt) },
  { header: 'Status', cell: (j) => <JobStatusBadge status={j.status} /> },
];

/** The waiting list mixes both request types, so it shows which one each is and why. */
const pendingColumns: Column<JobListItemDto>[] = [
  columns[0]!,
  {
    header: 'Request',
    cell: (j) => (
      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${j.status === 'CANCEL_PENDING' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'}`}>
        {j.status === 'CANCEL_PENDING' ? 'Cancellation' : 'RWR'}
      </span>
    ),
  },
  { header: 'Reason', cell: (j) => <span className="block max-w-64">{j.approvalReason ?? '—'}</span> },
  ...columns.slice(1, -1),
];

/** Branch Manager: RWR and cancellation requests. Open a job to decide it; approved RWRs return to the CCO for delivery. */
export function RwrPage() {
  const [tab, setTab] = useState<Tab>('PENDING');
  const pending = useList<JobListItemDto>('jobs', { statuses: 'RWR_PENDING,CANCEL_PENDING', pageSize: 100, sort: 'oldest' });
  const approved = useList<JobListItemDto>('jobs', { statuses: 'RWR', pageSize: 100, sort: 'oldest' });
  const active = tab === 'PENDING' ? pending : approved;
  const pendingCount = pending.data?.total ?? 0;
  const approvedCount = approved.data?.total ?? 0;
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'PENDING', label: 'Awaiting my approval', count: pendingCount },
    { key: 'RWR', label: 'Approved RWR — with CCO for delivery', count: approvedCount },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title="RWR & Cancellation"
        description="Return Without Repair and cancellation requests wait here for the Branch Manager. Open a job to decide; after an approved RWR the CCO delivers the phone."
      />
      <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>
      <Card>
        <DataTable columns={tab === 'PENDING' ? pendingColumns : columns} rows={active.data?.items} rowKey={(j) => j.id} isLoading={active.isLoading} emptyMessage={tab === 'PENDING' ? 'Nothing is waiting for approval' : 'No approved RWR waiting for delivery'} />
      </Card>
    </div>
  );
}
