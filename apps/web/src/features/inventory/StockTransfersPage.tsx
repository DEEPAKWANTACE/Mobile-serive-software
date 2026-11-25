import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StockTransferDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api-client';
import { formatCurrency, formatDateTime, timeAgo } from '@/lib/format';
import { useStoreBranch } from './useStoreBranch';

type View = 'incoming' | 'outgoing' | 'all';
const STATUS: Record<StockTransferDto['status'], string> = { SENT: 'In transit', RECEIVED: 'Received', CANCELLED: 'Cancelled' };

export function StockTransfersPage() {
  const queryClient = useQueryClient();
  const { branchId, picker, needsBranch, viewingOther, ownBranchId } = useStoreBranch();
  const [view, setView] = useState<View>('incoming');
  const [counting, setCounting] = useState<StockTransferDto | null>(null);
  const [counted, setCounted] = useState('');
  const [countNote, setCountNote] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'transfers', view, branchId],
    queryFn: () => api.get<StockTransferDto[]>(`/inventory/transfers?view=${view}${branchId ? `&branchId=${branchId}` : ''}`),
    enabled: !needsBranch,
  });
  const act = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'receive' | 'cancel'; body?: { receivedQuantity?: number; note?: string } }) => api.post(`/inventory/transfers/${id}/${action}`, body ?? {}),
    onSuccess: (_r, v) => {
      setCounting(null);
      toast.success(v.action === 'receive' ? 'Received — added to stock' : 'Transfer cancelled — stock returned');
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const columns: Column<StockTransferDto>[] = [
    { header: 'Part', cell: (t) => <span><span className="font-mono font-semibold">{t.part.code}</span> · {t.part.name}</span> },
    { header: 'Colour / category', cell: (t) => [t.part.color, t.part.category].filter(Boolean).join(' · ') || '—' },
    {
      header: 'Qty',
      cell: (t) => (
        <span className="font-semibold">
          {t.quantity}
          {t.receivedQuantity != null && t.receivedQuantity !== t.quantity && <span className="ml-1 text-xs font-medium text-red-600">(counted {t.receivedQuantity})</span>}
        </span>
      ),
    },
    {
      header: 'Rates',
      cell: (t) => (
        <div className="text-xs text-slate-600">
          Buy {t.part.costPrice != null ? formatCurrency(t.part.costPrice) : '—'} · Sell {formatCurrency(t.part.sellingPrice)}
          {t.part.costPrice != null && <div>Value {formatCurrency(t.part.costPrice * t.quantity)}</div>}
        </div>
      ),
    },
    { header: 'Route', cell: (t) => `${t.from.code} → ${t.to.code}` },
    {
      header: 'Sent',
      cell: (t) => (
        <div className="text-sm">
          {formatDateTime(t.sentAt)} by {t.sentBy}
          {t.note && <div className="text-xs text-slate-500">“{t.note}”</div>}
          {t.discrepancyNote && <div className="text-xs font-medium text-red-600">Discrepancy: {t.discrepancyNote}</div>}
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
        // Central looking at another store can only withdraw a recall it started.
        (viewingOther ? (
          t.to.id === ownBranchId && <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => act.mutate({ id: t.id, action: 'cancel' })}>Cancel recall</Button>
        ) : view === 'incoming' ? (
          <Button size="sm" onClick={() => { setCounting(t); setCounted(String(t.quantity)); setCountNote(''); }}>Check &amp; receive</Button>
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
      <Modal open={!!counting} onClose={() => setCounting(null)} title="Check received stock" size="sm">
        {counting && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const qty = Number(counted);
              if (!Number.isInteger(qty) || qty < 0 || qty > counting.quantity) return toast.error(`Enter a quantity from 0 to ${counting.quantity}`);
              if (qty !== counting.quantity && countNote.trim().length < 3) return toast.error('Explain the difference');
              act.mutate({ id: counting.id, action: 'receive', body: { receivedQuantity: qty, note: countNote.trim() || undefined } });
            }}
          >
            <p className="text-sm"><span className="font-mono font-semibold">{counting.part.code}</span> · {counting.part.name} — sent <b>{counting.quantity}</b> from {counting.from.code}. Purchase and sale rates stay as set in the parts master.</p>
            <Field label="Quantity actually received">
              <input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="numeric" className={inputClass} autoFocus />
            </Field>
            {Number(counted) !== counting.quantity && (
              <Field label="Discrepancy note" required>
                <input value={countNote} onChange={(e) => setCountNote(e.target.value)} className={inputClass} placeholder="e.g. 1 piece broken in transit" />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCounting(null)}>Cancel</Button>
              <Button type="submit" loading={act.isPending}>{Number(counted) === counting.quantity ? 'Accept stock' : 'Accept with discrepancy'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
