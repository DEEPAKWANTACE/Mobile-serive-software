import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LINE_WARRANTY_OPTIONS, roundMoney, type CostLineInput, type JobDto, type LineWarranty } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { PartStockPicker } from '@/features/inventory/PartStockPicker';
import { api, ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format';

export type CostRow = {
  key: string;
  description: string;
  partId: string | null;
  partCode: string | null;
  partName: string | null;
  warranty: LineWarranty | '';
  amount: string;
};

const asWarranty = (value: string | null | undefined): LineWarranty | '' =>
  (LINE_WARRANTY_OPTIONS as readonly string[]).includes(value ?? '') ? (value as LineWarranty) : '';

/** Rows for the editor from the job's current estimate lines. */
export function rowsFromJob(job: JobDto): CostRow[] {
  return job.estimateLines.map((l) => ({
    key: l.id,
    description: l.part ? (l.description ?? '') : [l.fault?.name, l.description, l.priceLabel && `(${l.priceLabel})`].filter(Boolean).join(' — '),
    partId: l.part?.id ?? null,
    partCode: l.part?.code ?? null,
    partName: l.part?.name ?? null,
    warranty: asWarranty(l.warranty),
    amount: String(l.amount),
  }));
}

export const rowsTotal = (rows: CostRow[]) => roundMoney(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));

/** Validate rows and convert them to the API shape; returns an error message instead when something is missing. */
export function rowsToLines(rows: CostRow[]): CostLineInput[] | string {
  if (!rows.length) return 'Add at least one item';
  for (const [i, r] of rows.entries()) {
    if (!r.partId && !r.description.trim()) return `Item ${i + 1}: describe the item`;
    if (r.amount.trim() === '' || !(Number(r.amount) >= 0)) return `Item ${i + 1}: enter the amount`;
  }
  return rows.map((r) => ({
    description: r.description.trim() || null,
    partId: r.partId,
    warranty: r.warranty || null,
    amount: Number(r.amount),
  }));
}

/** Editable bill: free-text items or parts from stock, each with warranty and amount. */
export function CostLinesEditor({ branchId, rows, onChange, defaultWarranty }: {
  branchId: string;
  rows: CostRow[];
  onChange: (rows: CostRow[]) => void;
  defaultWarranty?: string | null;
}) {
  const [picking, setPicking] = useState(false);
  const set = (key: string, patch: Partial<CostRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const warranty = asWarranty(defaultWarranty);

  return (
    <div className="space-y-2">
      <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[1fr_auto] gap-2 p-2 sm:grid-cols-[1fr_8.5rem_6.5rem_auto] sm:items-center">
            <div className="min-w-0">
              {r.partId ? (
                <div className="text-sm">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold">{r.partCode}</span>{' '}
                  <span className="font-medium">{r.partName}</span>
                  <input
                    value={r.description}
                    onChange={(e) => set(r.key, { description: e.target.value })}
                    placeholder="Note (optional)"
                    aria-label="Note"
                    className={`${inputClass} mt-1 py-1!`}
                  />
                </div>
              ) : (
                <input
                  value={r.description}
                  onChange={(e) => set(r.key, { description: e.target.value })}
                  placeholder="Item, e.g. Display replacement"
                  aria-label="Item"
                  className={inputClass}
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
              aria-label="Remove item"
              className="row-start-1 self-start rounded px-2 py-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 sm:col-start-4"
            >
              ✕
            </button>
            <select
              value={r.warranty}
              onChange={(e) => set(r.key, { warranty: e.target.value as LineWarranty | '' })}
              aria-label="Warranty"
              className={`${inputClass} sm:col-start-2 sm:row-start-1`}
            >
              <option value="">Warranty —</option>
              {LINE_WARRANTY_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <input
              value={r.amount}
              onChange={(e) => set(r.key, { amount: e.target.value })}
              inputMode="decimal"
              placeholder="₹ Amount"
              aria-label="Amount"
              className={`${inputClass} sm:col-start-3 sm:row-start-1`}
            />
          </div>
        ))}
        {!rows.length && <p className="p-3 text-sm text-slate-500">No items yet.</p>}
        <div className="flex justify-between bg-slate-50 px-3 py-2 text-sm font-semibold">
          <span>Total</span>
          <span>{formatCurrency(rowsTotal(rows))}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="link"
          onClick={() => onChange([...rows, { key: crypto.randomUUID(), description: '', partId: null, partCode: null, partName: null, warranty, amount: '' }])}
        >
          + Add item
        </Button>
        <Button variant="link" onClick={() => setPicking((v) => !v)}>
          {picking ? 'Close part list' : '+ Part from stock'}
        </Button>
      </div>
      {picking && (
        <div className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
          <PartStockPicker
            branchId={branchId}
            autoFocus
            onPick={(p) => {
              onChange([...rows, { key: crypto.randomUUID(), description: '', partId: p.id, partCode: p.code, partName: p.name, warranty, amount: String(p.sellingPrice) }]);
              setPicking(false);
            }}
          />
          <p className="mt-2 text-xs text-slate-500">Stock goes down when you save. Removing a part later puts it back in stock.</p>
        </div>
      )}
    </div>
  );
}

/** Popup body: CCO changes the costing after approval. */
export function EditCostingForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(() => rowsFromJob(job));
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: (lines: CostLineInput[]) => api.put(`/jobs/${job.id}/lines`, { lines }),
    onSuccess: () => {
      toast.success('Costing updated');
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => {
      const details = err instanceof ApiError ? (err.details as Record<string, string[]> | undefined) : undefined;
      setError(details ? Object.values(details)[0]?.[0] : err.message);
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const lines = rowsToLines(rows);
        if (typeof lines === 'string') return setError(lines);
        setError(undefined);
        save.mutate(lines);
      }}
      className="space-y-4"
    >
      <CostLinesEditor branchId={job.currentBranch.id} rows={rows} onChange={setRows} defaultWarranty={job.warrantyPeriod} />
      {job.approvedAt && <p className="text-xs text-slate-500">The customer-approved amount changes to the new total.</p>}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Save costing · {formatCurrency(rowsTotal(rows))}</Button>
      </div>
    </form>
  );
}
