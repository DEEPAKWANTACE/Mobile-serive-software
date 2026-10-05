import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { JOB_PART_STATUS_LABELS, type PartRequestDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { inputClass } from '@/components/ui/Field';
import { FilterBar } from '@/components/ui/Filters';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api-client';
import { timeAgo } from '@/lib/format';
import { useAuth } from '@/features/auth/auth-context';
import { ROLES } from '@msm/shared';
import { useStoreBranch } from './useStoreBranch';

type Tab = 'open' | 'ISSUED';
type Action = { kind: 'issue' | 'not-available' | 'return' | 'cancel'; row: PartRequestDto };

const ACTION_TEXT: Record<Action['kind'], { title: string; button: string; done: string; notePlaceholder: string }> = {
  issue: { title: 'Issue part', button: 'Issue', done: 'Part issued', notePlaceholder: 'Optional note' },
  'not-available': { title: 'Mark not available', button: 'Not available', done: 'Marked not available — job is waiting for the part', notePlaceholder: 'e.g. Ordered from supplier, 2 days' },
  return: { title: 'Return to stock', button: 'Return to stock', done: 'Part returned to stock', notePlaceholder: 'e.g. Not used, repair failed' },
  cancel: { title: 'Cancel request', button: 'Cancel request', done: 'Request cancelled', notePlaceholder: '' },
};

export function PartRequestsPage() {
  const { branchId, picker, needsBranch } = useStoreBranch();
  const { user } = useAuth();
  const canOpenJobs = user?.role !== ROLES.STOREKEEPER;
  const [tab, setTab] = useState<Tab>('open');
  const [action, setAction] = useState<Action | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'requests', branchId, tab],
    queryFn: () => api.get<PartRequestDto[]>(`/inventory/part-requests?status=${tab}${branchId ? `&branchId=${branchId}` : ''}`),
    enabled: !needsBranch,
  });

  const columns: Column<PartRequestDto>[] = [
    {
      header: 'Part',
      cell: (r) => (
        <div>
          <span className="font-mono font-semibold">{r.part.code}</span> · {r.part.name}
          {r.quantity > 1 && <span className="font-medium"> × {r.quantity}</span>}
        </div>
      ),
    },
    {
      header: 'In stock',
      cell: (r) => <span className={r.stock >= r.quantity ? 'font-medium text-emerald-700' : 'font-medium text-red-600'}>{r.stock}</span>,
    },
    {
      header: 'Job',
      cell: (r) => (
        <div>
          {canOpenJobs ? (
            <Link to={`/jobs/${r.job.id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">
              {r.job.jobNumber}
            </Link>
          ) : (
            <span className="font-mono text-sm font-semibold whitespace-nowrap">{r.job.jobNumber}</span>
          )}
          <div className="text-xs text-slate-500">{r.job.device}</div>
        </div>
      ),
    },
    { header: 'Engineer', cell: (r) => r.job.engineer ?? '—' },
    {
      header: 'Status',
      cell: (r) => (
        <span className={r.status === 'NOT_AVAILABLE' ? 'font-medium text-red-600' : ''}>
          {JOB_PART_STATUS_LABELS[r.status]}
          <span className="block text-xs text-slate-500">{timeAgo(tab === 'open' ? r.requestedAt : (r.handledAt ?? r.requestedAt))} ago</span>
        </span>
      ),
    },
    {
      header: '',
      className: 'text-right',
      cell: (r) =>
        tab === 'open' ? (
          <div className="flex justify-end gap-2 whitespace-nowrap">
            <Button size="sm" disabled={r.stock < r.quantity} onClick={() => setAction({ kind: 'issue', row: r })}>
              Issue
            </Button>
            {r.status === 'REQUESTED' && (
              <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'not-available', row: r })}>
                Not available
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'cancel', row: r })}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'return', row: r })}>
            Return to stock
          </Button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader title="Part Requests" description="Parts engineers asked for — issue them, or mark not available" />
      <FilterBar>
        {picker}
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {(['open', 'ISSUED'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 ${tab === t ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {t === 'open' ? 'Pending' : 'Issued (for returns)'}
            </button>
          ))}
        </div>
      </FilterBar>
      {needsBranch ? (
        <p className="text-sm text-slate-500">Select a branch.</p>
      ) : (
        <DataTable
          columns={columns}
          rows={data}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          emptyMessage={tab === 'open' ? 'No pending part requests' : 'No issued parts'}
        />
      )}
      <Modal open={!!action} onClose={() => setAction(null)} title={action ? ACTION_TEXT[action.kind].title : ''} size="sm">
        {action && <ActionForm action={action} onDone={() => setAction(null)} />}
      </Modal>
    </div>
  );
}

function ActionForm({ action, onDone }: { action: Action; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const text = ACTION_TEXT[action.kind];
  const run = useMutation({
    mutationFn: () =>
      api.post<{ jobResumedTo?: string | null }>(
        `/inventory/part-requests/${action.row.id}/${action.kind}`,
        action.kind === 'cancel' ? undefined : { note: note.trim() || null },
      ),
    onSuccess: (r) => {
      toast.success(r?.jobResumedTo ? `${text.done} — job ${action.row.job.jobNumber} resumed` : text.done);
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <form onSubmit={(e) => (e.preventDefault(), run.mutate())} className="space-y-4">
      <p className="text-sm text-slate-700">
        <span className="font-mono font-semibold">{action.row.part.code}</span> · {action.row.part.name} × {action.row.quantity} for{' '}
        <span className="font-mono">{action.row.job.jobNumber}</span> ({action.row.job.engineer ?? 'no engineer'})
      </p>
      {action.kind !== 'cancel' && (
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={text.notePlaceholder} className={inputClass} autoFocus />
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Back
        </Button>
        <Button type="submit" variant={action.kind === 'cancel' ? 'danger' : 'primary'} loading={run.isPending}>
          {text.button}
        </Button>
      </div>
    </form>
  );
}
