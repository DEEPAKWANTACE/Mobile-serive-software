import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Paginated, PartLookupDto, StockRowDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, inputClass } from '@/components/ui/Field';
import { FilterBar, SearchInput } from '@/components/ui/Filters';
import { FormActions } from '@/components/ui/FormActions';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { api, ApiError } from '@/lib/api-client';
import { toQueryString } from '@/lib/crud';
import { formatCurrency } from '@/lib/format';
import { PartCodeInput } from './PartCodeInput';
import { useStoreBranch } from './useStoreBranch';

type Dialog = { kind: 'receive' | 'adjust'; part?: StockRowDto['part'] } | null;

export function StockPage() {
  const { branchId, picker, needsBranch } = useStoreBranch();
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);

  const params = { branchId, search, lowOnly: lowOnly || undefined, page, pageSize: 50 };
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'stock', params],
    queryFn: () => api.get<Paginated<StockRowDto>>(`/inventory/stock?${toQueryString(params)}`),
    enabled: !needsBranch,
  });

  const columns: Column<StockRowDto>[] = [
    { header: 'Code', cell: (r) => <span className="font-mono font-semibold">{r.part.code}</span> },
    { header: 'Part', cell: (r) => r.part.name },
    { header: 'Selling price', cell: (r) => formatCurrency(r.part.sellingPrice) },
    {
      header: 'In stock',
      cell: (r) => (
        <span className={`font-semibold ${r.low ? 'text-red-600' : ''}`}>
          {r.quantity}
          {r.low && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-normal">Low (≤ {r.part.reorderLevel})</span>}
        </span>
      ),
    },
    {
      header: '',
      className: 'text-right',
      cell: (r) => (
        <div className="flex justify-end gap-3">
          <Button variant="link" onClick={() => setDialog({ kind: 'receive', part: r.part })}>
            Stock in
          </Button>
          <Button variant="link" onClick={() => setDialog({ kind: 'adjust', part: r.part })}>
            Adjust
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Stock"
        description="Spare parts in this branch"
        actions={
          !needsBranch && (
            <Button onClick={() => setDialog({ kind: 'receive' })}>Stock in</Button>
          )
        }
      />
      <FilterBar>
        {picker}
        <SearchInput onSearch={(v) => (setSearch(v), setPage(1))} placeholder="Search code or name" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={lowOnly} onChange={(e) => (setLowOnly(e.target.checked), setPage(1))} className="size-4 accent-brand-600" />
          Low stock only
        </label>
      </FilterBar>
      {needsBranch ? (
        <p className="text-sm text-slate-500">Select a branch.</p>
      ) : (
        <>
          <DataTable columns={columns} rows={data?.items} rowKey={(r) => r.part.id} isLoading={isLoading} emptyMessage="No parts in the master yet" />
          {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
        </>
      )}
      <Modal open={!!dialog} onClose={() => setDialog(null)} title={dialog?.kind === 'adjust' ? 'Adjust stock' : 'Stock in'} size="sm">
        {dialog && <StockForm kind={dialog.kind} part={dialog.part} branchId={branchId} onDone={() => setDialog(null)} />}
      </Modal>
    </div>
  );
}

function StockForm({ kind, part: initial, branchId, onDone }: { kind: 'receive' | 'adjust'; part?: StockRowDto['part']; branchId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [part, setPart] = useState<{ id: string; code: string; name: string } | null>(initial ?? null);
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const save = useMutation({
    mutationFn: () =>
      kind === 'receive'
        ? api.post<{ balance: number }>('/inventory/receipts', { branchId, partId: part!.id, quantity, unitCost, reference, note })
        : api.post<{ balance: number }>('/inventory/adjustments', { branchId, partId: part!.id, quantity, note }),
    onSuccess: (r) => {
      toast.success(`${part!.code} — stock now ${r.balance}`);
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => {
      const d = err instanceof ApiError ? (err.details as Record<string, string[]> | undefined) : undefined;
      if (d) setErrors(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v?.[0]])));
      else toast.error(err.message);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!part) return setErrors({ partId: 'Find the part by its code' });
        save.mutate();
      }}
      className="space-y-4"
    >
      {initial ? (
        <p className="text-sm">
          <span className="font-mono font-semibold">{initial.code}</span> · {initial.name}
        </p>
      ) : (
        <Field label="Part" required error={errors.partId}>
          <PartCodeInput branchId={branchId} onFound={(p: PartLookupDto) => setPart(p)} />
        </Field>
      )}
      <Field
        label={kind === 'adjust' ? 'Change (+ / −)' : 'Quantity received'}
        required
        error={errors.quantity}
        hint={kind === 'adjust' ? 'e.g. -1 for a damaged part, +2 after a recount' : undefined}
      >
        <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" className={inputClass} />
      </Field>
      {kind === 'receive' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit cost (₹)" error={errors.unitCost}>
            <input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} inputMode="decimal" className={inputClass} />
          </Field>
          <Field label="Invoice / ref." error={errors.reference}>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
          </Field>
        </div>
      )}
      <Field label={kind === 'adjust' ? 'Reason' : 'Note'} required={kind === 'adjust'} error={errors.note}>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel={kind === 'adjust' ? 'Save adjustment' : 'Add to stock'} />
    </form>
  );
}
