import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { L4_APPROVER_ROLES, type JobMovementDto, type L4RequestDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { BranchScopePicker } from '@/features/accounts/BranchScopePicker';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/lib/api-client';
import { formatDateTime, timeAgo } from '@/lib/format';

type View = 'requests' | 'incoming' | 'outgoing' | 'all';

const REQUEST_BADGE: Record<L4RequestDto['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-800',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
};

export function L4TransfersPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canApprove = !!user && L4_APPROVER_ROLES.includes(user.role);
  const [view, setView] = useState<View>(canApprove ? 'requests' : 'incoming');
  const [branchId, setBranchId] = useState('');
  const requests = useQuery({
    queryKey: ['l4', 'requests', branchId],
    queryFn: () => api.get<L4RequestDto[]>(`/jobs/l4/requests${branchId ? `?branchId=${branchId}` : ''}`),
    enabled: view === 'requests',
  });
  const decide = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'approve' | 'reject'; note: string | null }) => api.post(`/jobs/l4/requests/${id}/${action}`, { note }),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'approve' ? 'Approved — phone sent to L4' : 'Request rejected');
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e.message),
  });
  const { data, isLoading } = useQuery({
    enabled: view !== 'requests',
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

  const requestColumns: Column<L4RequestDto>[] = [
    {
      header: 'Job',
      cell: (r) => (
        <div>
          <Link to={`/jobs/${r.job.id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">{r.job.jobNumber}</Link>
          <div className="text-xs text-slate-500">{r.job.device} · {r.job.customer}</div>
          {r.job.imei && <div className="text-xs text-slate-400">IMEI {r.job.imei}</div>}
        </div>
      ),
    },
    { header: 'Engineer', cell: (r) => r.job.engineer ?? r.requestedBy },
    { header: 'Job status', cell: (r) => <JobStatusBadge status={r.job.status} /> },
    {
      header: 'Reason / diagnosis',
      cell: (r) => (
        <div className="max-w-72 text-sm">
          <div>{r.reason ?? '—'}</div>
          {r.job.diagnosis && <div className="mt-0.5 text-xs text-slate-500">Diagnosis: {r.job.diagnosis}</div>}
        </div>
      ),
    },
    { header: 'Requested', cell: (r) => <span className="text-sm">{formatDateTime(r.requestedAt)}<div className="text-xs text-slate-500">to {r.to.code}</div></span> },
    {
      header: 'Decision',
      cell: (r) => (
        <div className="text-sm">
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${REQUEST_BADGE[r.status]}`}>{r.status === 'PENDING' ? 'Awaiting approval' : r.status === 'APPROVED' ? 'Approved' : 'Rejected'}</span>
          {r.decidedAt && <div className="mt-0.5 text-xs text-slate-500">{formatDateTime(r.decidedAt)} by {r.decidedBy}{r.decisionNote ? ` — “${r.decisionNote}”` : ''}</div>}
        </div>
      ),
    },
    {
      header: '',
      className: 'text-right',
      cell: (r) =>
        canApprove && r.status === 'PENDING' && (
          <span className="flex justify-end gap-2">
            <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ id: r.id, action: 'approve', note: null })}>Approve</Button>
            <Button size="sm" variant="secondary" loading={decide.isPending} onClick={() => { const note = window.prompt('Reason for rejecting (optional)'); if (note !== null) decide.mutate({ id: r.id, action: 'reject', note: note.trim() || null }); }}>Reject</Button>
          </span>
        ),
    },
  ];

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
          {([['requests', 'Approval requests'], ['incoming', 'To receive'], ['outgoing', 'Sent, not yet received'], ['all', 'History']] as [View, string][]).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`rounded px-3 py-1.5 ${view === v ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </FilterBar>
      {view === 'requests' ? (
        <DataTable columns={requestColumns} rows={requests.data} rowKey={(r) => r.id} isLoading={requests.isLoading} emptyMessage="No L4 requests" />
      ) : (
        <DataTable columns={columns} rows={data} rowKey={(m) => m.id} isLoading={isLoading} emptyMessage="Nothing here" />
      )}
    </div>
  );
}
