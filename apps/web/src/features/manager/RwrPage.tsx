import { useState } from 'react';
import { Link } from 'react-router';
import type { JobListItemDto } from '@msm/shared';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { useList } from '@/lib/crud';
import { formatDateTime, formatJobNumber } from '@/lib/format';

type Tab = 'RWR_PENDING' | 'RWR';

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

/** Branch Manager: every RWR call. Open a job to approve it; approved calls return to the CCO for delivery. */
export function RwrPage() {
  const [tab, setTab] = useState<Tab>('RWR_PENDING');
  const pending = useList<JobListItemDto>('jobs', { statuses: 'RWR_PENDING', pageSize: 100, sort: 'oldest' });
  const approved = useList<JobListItemDto>('jobs', { statuses: 'RWR', pageSize: 100, sort: 'oldest' });
  const active = tab === 'RWR_PENDING' ? pending : approved;
  const pendingCount = pending.data?.total ?? 0;
  const approvedCount = approved.data?.total ?? 0;
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'RWR_PENDING', label: 'Awaiting my approval', count: pendingCount },
    { key: 'RWR', label: 'Approved — with CCO for delivery', count: approvedCount },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title="RWR (Return Without Repair)"
        description={`Total RWR calls: ${pendingCount + approvedCount}. The Branch Manager approves; the CCO delivers the phone to the customer.`}
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
        <DataTable columns={columns} rows={active.data?.items} rowKey={(j) => j.id} isLoading={active.isLoading} emptyMessage="No RWR calls" />
      </Card>
    </div>
  );
}
