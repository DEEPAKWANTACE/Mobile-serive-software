import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StockTransferDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api-client';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useStoreBranch } from './useStoreBranch';

type View = 'incoming' | 'outgoing' | 'all';
const STATUS: Record<StockTransferDto['status'], string> = { SENT: 'In transit', RECEIVED: 'Received', CANCELLED: 'Cancelled' };

export function StockTransfersPage() {
  const queryClient = useQueryClient();
  const { branchId, picker, needsBranch } = useStoreBranch();
  const [view, setView] = useState<View>('incoming');
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'transfers', view, branchId],
    queryFn: () => api.get<StockTransferDto[]>(`/inventory/transfers?view=${view}${branchId ? `&branchId=${branchId}` : ''}`),
    enabled: !needsBranch,
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'receive' | 'cancel' }) => api.post(`/inventory/transfers/${id}/${action}`),
    onSuccess: (_r, v) => {
      toast.success(v.action === 'receive' ? 'Received — added to stock' : 'Transfer cancelled — stock returned');
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const columns: Column<StockTransferDto>[] = [
    { header: 'Part', cell: (t) => <span><span className="font-mono font-semibold">{t.part.code}</span> · {t.part.name}</span> },
    { header: 'Qty', cell: (t) => <span className="font-semibold">{t.quantity}</span> },
    { header: 'Route', cell: (t) => `${t.from.code} → ${t.to.code}` },
    {
      header: 'Sent',
      cell: (t) => (
        <div className="text-sm">
          {formatDateTime(t.sentAt)} by {t.sentBy}
          {t.note && <div className="text-xs text-slate-500">“{t.note}”</div>}
        </div>
      ),
    },
    {
      header: 'Status',
      cell: (t) => (t.status === 'SENT' ? <span className="font-medium text-orange-700">In transit {timeAgo(t.sentAt)}</span> : `${STATUS[t.status]}${t.receivedAt ? ` ${formatDateTime(t.receivedAt)}` : ''}${t.receivedBy ? ` by ${t.receivedBy}` : ''}`),
    },
    {
      header: '',
      className: 'text-right',
      cell: (t) =>
        t.status === 'SENT' &&
        (view === 'incoming' ? (
          <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ id: t.id, action: 'receive' })}>Receive</Button>
        ) : view === 'outgoing' ? (
          <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => act.mutate({ id: t.id, action: 'cancel' })}>Cancel</Button>
        ) : null),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Stock Transfers" description="Parts sent between branch stores. Use “Send to branch” on the Stock page to send." />
      <FilterBar>
        {picker}
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {([['incoming', 'To receive'], ['outgoing', 'Sent, in transit'], ['all', 'History']] as [View, string][]).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`rounded px-3 py-1.5 ${view === v ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </FilterBar>
      {needsBranch ? <p className="text-sm text-slate-500">Select a branch.</p> : <DataTable columns={columns} rows={data} rowKey={(t) => t.id} isLoading={isLoading} emptyMessage="Nothing here" />}
    </div>
  );
}
