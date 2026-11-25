import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { roundMoney, type Paginated, type PurchaseOrderDto, type StockRowDto, type SupplyDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { useAuth } from '@/features/auth/auth-context';
import { api, ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format';
import { printChallan } from './challan';

export type SupplyLine = { partId: string; code: string; name: string; quantity: number; rate: number; pending?: number };

/** Central Store stock by part, to show what can actually be sent. */
function useCentralStock() {
  const centralId = useAuth().user?.branch?.id;
  return useQuery({
    // Super Admin has no branch of their own, so look the Central Store up first.
    queryKey: ['inventory', 'central-stock', centralId ?? 'lookup'],
    queryFn: async () => {
      const id = centralId ?? (await api.get<{ central: { id: string } }>('/central/overview')).central.id;
      const all: StockRowDto[] = [];
      for (let page = 1; ; page += 1) {
        const res = await api.get<Paginated<StockRowDto>>(`/inventory/stock?branchId=${id}&page=${page}&pageSize=200`);
        all.push(...res.items);
        if (all.length >= res.total || !res.items.length) break;
      }
      return new Map(all.map((r) => [r.part.id, r.quantity]));
    },
  });
}

/**
 * Create a supply challan: against a purchase order (part or full), or direct to a branch.
 * Quantities start at what can be sent now; leave a line at 0 to send it later.
 */
export function SupplyDialog({ po, branch, lines: initial, onDone }: { po?: PurchaseOrderDto; branch?: { id: string; name: string }; lines: SupplyLine[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const stock = useCentralStock();
  const [edits, setEdits] = useState<Record<string, { quantity?: string; rate?: string }>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();

  const available = (partId: string) => stock.data?.get(partId) ?? 0;
  const quantityOf = (l: SupplyLine) => edits[l.partId]?.quantity ?? String(Math.min(l.quantity, available(l.partId)));
  const rateOf = (l: SupplyLine) => edits[l.partId]?.rate ?? String(l.rate);
  const edit = (partId: string, patch: { quantity?: string; rate?: string }) => setEdits((e) => ({ ...e, [partId]: { ...e[partId], ...patch } }));

  const sending = initial.map((l) => ({ line: l, quantity: Number(quantityOf(l)), rate: Number(rateOf(l)) })).filter((x) => x.quantity > 0);
  const problem = sending.find((x) => !Number.isInteger(x.quantity) || x.quantity > available(x.line.partId) || (x.line.pending !== undefined && x.quantity > x.line.pending) || !(x.rate >= 0));
  const total = roundMoney(sending.reduce((s, x) => s + x.quantity * (x.rate || 0), 0));

  const save = useMutation({
    mutationFn: () =>
      api.post<SupplyDto>('/central/supplies', {
        purchaseOrderId: po?.id,
        toBranchId: po ? undefined : branch?.id,
        note: note.trim() || undefined,
        lines: sending.map((x) => ({ partId: x.line.partId, quantity: x.quantity, rate: x.rate })),
      }),
    onSuccess: (challan) => {
      toast.success(`${challan.challanNumber} dispatched — the branch must receive it`, { duration: 10000, action: { label: 'Print challan', onClick: () => printChallan(challan) } });
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? (Object.values((err.details as Record<string, string[]>) ?? {})[0]?.[0] ?? err.message) : err.message),
  });

  if (stock.isLoading) return <p className="text-sm text-slate-500">Loading Central Store stock…</p>;
  if (stock.error) return <p className="text-sm text-red-600">{stock.error.message}</p>;

  return (
    <form onSubmit={(e) => (e.preventDefault(), setError(undefined), save.mutate())} className="space-y-4">
      <p className="text-sm text-slate-600">
        To <b>{po ? `${po.branchName} (${po.branchCode})` : branch?.name}</b>
        {po && <> against <span className="font-mono">{po.poNumber}</span>. Anything not sent now stays pending.</>}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Part</th>
              {po && <th className="py-1.5 pr-3 text-right font-medium">Pending</th>}
              <th className="py-1.5 pr-3 text-right font-medium">In Central</th>
              <th className="py-1.5 pr-3 font-medium">Send qty</th>
              <th className="py-1.5 font-medium">Rate (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {initial.map((l) => {
              const qty = Number(quantityOf(l));
              const bad = qty > available(l.partId) || (l.pending !== undefined && qty > l.pending);
              return (
                <tr key={l.partId}>
                  <td className="py-1.5 pr-3">
                    <span className="font-mono font-semibold">{l.code}</span> · {l.name}
                  </td>
                  {po && <td className="py-1.5 pr-3 text-right tabular-nums">{l.pending}</td>}
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${available(l.partId) === 0 ? 'font-semibold text-red-600' : ''}`}>{available(l.partId)}</td>
                  <td className="py-1.5 pr-3">
                    <input value={quantityOf(l)} onChange={(e) => edit(l.partId, { quantity: e.target.value })} inputMode="numeric" aria-label={`Quantity of ${l.code}`} aria-invalid={bad || undefined} className={`${inputClass} w-20! py-1! ${bad ? 'border-red-500!' : ''}`} />
                  </td>
                  <td className="py-1.5">
                    <input value={rateOf(l)} onChange={(e) => edit(l.partId, { rate: e.target.value })} inputMode="decimal" aria-label={`Rate of ${l.code}`} className={`${inputClass} w-24! py-1!`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Field label="Note on challan">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputClass} placeholder="e.g. Sent by courier" />
      </Field>
      {problem && <p className="text-sm text-red-600">Check the quantities: whole numbers, within Central stock{po ? ' and the pending quantity' : ''}.</p>}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold">
          {sending.reduce((s, x) => s + x.quantity, 0)} pcs · {formatCurrency(total)}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
          <Button type="submit" loading={save.isPending} disabled={!sending.length || !!problem}>Dispatch &amp; create challan</Button>
        </div>
      </div>
    </form>
  );
}
