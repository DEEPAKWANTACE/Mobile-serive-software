import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { JobMovementDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { BranchScopePicker } from '@/features/accounts/BranchScopePicker';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { api } from '@/lib/api-client';
import { formatDateTime, timeAgo } from '@/lib/format';

type View = 'incoming' | 'outgoing' | 'all';

export function L4TransfersPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('incoming');
  const [branchId, setBranchId] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['l4', view, branchId],
    queryFn: () => api.get<JobMovementDto[]>(`/jobs/l4/movements?view=${view}${branchId ? `&branchId=${branchId}` : ''}`),
  });
  const receive = useMutation({
    mutationFn: (jobId: string) => api.post(`/jobs/${jobId}/l4/receive`, {}),
    onSuccess: () => {
      toast.success('Phone received');
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e.message),
  });

  const columns: Column<JobMovementDto>[] = [
    {
      header: 'Job',
      cell: (m) => (
        <div>
          <Link to={`/jobs/${m.job!.id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">{m.job!.jobNumber}</Link>
          <div className="text-xs text-slate-500">{m.job!.device} · {m.job!.customer}</div>
        </div>
      ),
    },
    { header: 'Route', cell: (m) => <span className="font-medium">{m.from.code} → {m.to.code}</span> },
    { header: 'Job status', cell: (m) => <JobStatusBadge status={m.job!.status} /> },
    {
      header: 'Sent',
      cell: (m) => (
        <div className="text-sm">
          {formatDateTime(m.sentAt)} by {m.sentBy}
          {m.reason && <div className="text-xs text-slate-500">“{m.reason}”</div>}
        </div>
      ),
    },
    {
      header: view === 'all' ? 'Received' : 'In transit',
      cell: (m) => (m.receivedAt ? `${formatDateTime(m.receivedAt)} by ${m.receivedBy}` : <span className="font-medium text-orange-700">{timeAgo(m.sentAt)}</span>),
    },
    {
      header: '',
      className: 'text-right',
      cell: (m) =>
        view === 'incoming' && (
          <Button size="sm" loading={receive.isPending} onClick={() => receive.mutate(m.job!.id)}>
            Receive
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="L4 Transfers" description="Phones moving between branches and the main office" />
      <FilterBar>
        <BranchScopePicker value={branchId} onChange={setBranchId} />
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {([['incoming', 'To receive'], ['outgoing', 'Sent, not yet received'], ['all', 'History']] as [View, string][]).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`rounded px-3 py-1.5 ${view === v ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </FilterBar>
      <DataTable columns={columns} rows={data} rowKey={(m) => m.id} isLoading={isLoading} emptyMessage="Nothing here" />
    </div>
  );
}
