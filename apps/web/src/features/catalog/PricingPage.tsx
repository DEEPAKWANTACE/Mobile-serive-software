import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { priceAmount, type BrandDto, type FaultDto, type ModelDto, type ModelPriceDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { FilterBar, FilterSelect } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api-client';
import { useList, useOptions } from '@/lib/crud';
import { formatCurrency } from '@/lib/format';

export function PricingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const brandId = searchParams.get('brandId') ?? '';
  const modelId = searchParams.get('modelId') ?? '';
  const [dirty, setDirty] = useState(false);

  const { items: brands } = useOptions<BrandDto>('brands');
  const { items: models } = useOptions<ModelDto>('models', { brandId }, { enabled: !!brandId });
  // All faults (incl. inactive) so an inactive fault that still has a price is not hidden.
  const { data: faultPage } = useList<FaultDto>('faults', { pageSize: 200 });
  const prices = useQuery({
    queryKey: ['models', modelId, 'prices'],
    queryFn: () => api.get<ModelPriceDto[]>(`/models/${modelId}/prices`),
    enabled: !!modelId,
  });

  const select = (next: { brandId?: string; modelId?: string }) => {
    if (dirty && !window.confirm('You have unsaved price changes. Discard them?')) return;
    setDirty(false);
    const b = next.brandId ?? brandId;
    setSearchParams(next.modelId !== undefined ? { brandId: b, modelId: next.modelId } : { brandId: b }, { replace: true });
  };

  const model = models.find((m) => m.id === modelId);

  return (
    <div>
      <PageHeader title="Repair Pricing" description="Standard price for each fault, per model. Leave blank if the repair is not offered." />
      <FilterBar>
        <FilterSelect
          value={brandId}
          onChange={(v) => select({ brandId: v, modelId: '' })}
          placeholder="Select brand"
          options={brands.map((b) => ({ value: b.id, label: b.name }))}
        />
        <FilterSelect
          value={modelId}
          onChange={(v) => select({ modelId: v })}
          placeholder={brandId ? 'Select model' : 'Select brand first'}
          disabled={!brandId}
          options={models.map((m) => ({ value: m.id, label: m.name }))}
        />
      </FilterBar>

      {!modelId ? (
        <div className="rounded-lg bg-white p-10 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          Select a brand and model to view and edit its repair prices.
        </div>
      ) : !prices.data || !faultPage ? (
        <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
      ) : faultPage.items.length === 0 ? (
        <div className="rounded-lg bg-white p-10 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          No faults defined yet.{' '}
          <Link to="/catalog/faults" className="text-brand-600 hover:underline">
            Add faults
          </Link>{' '}
          first.
        </div>
      ) : (
        <PriceGrid
          // Remount (fresh draft) whenever the model or its saved prices change.
          key={`${modelId}:${prices.dataUpdatedAt}`}
          modelId={modelId}
          modelLabel={model ? `${model.brand.name} ${model.name}` : ''}
          faults={faultPage.items}
          prices={prices.data}
          onDirtyChange={setDirty}
        />
      )}
    </div>
  );
}

type GridProps = {
  modelId: string;
  modelLabel: string;
  faults: FaultDto[];
  prices: ModelPriceDto[];
  onDirtyChange: (dirty: boolean) => void;
};

function PriceGrid({ modelId, modelLabel, faults, prices, onDirtyChange }: GridProps) {
  const queryClient = useQueryClient();
  const saved = useMemo(() => new Map(prices.map((p) => [p.faultId, String(p.price)])), [prices]);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(saved));
  const [filter, setFilter] = useState('');

  const rows = faults.filter((f) => (f.isActive || saved.has(f.id)) && f.name.toLowerCase().includes(filter.toLowerCase()));

  // Validate only the rows the user changed.
  const changes = faults.flatMap((f) => {
    const value = (draft[f.id] ?? '').trim();
    if (value === (saved.get(f.id) ?? '')) return [];
    if (value === '') return [{ faultId: f.id, price: null, error: undefined }];
    const parsed = priceAmount.safeParse(value);
    return [{ faultId: f.id, price: parsed.success ? parsed.data : null, error: parsed.error?.issues[0]?.message }];
  });
  const errors = new Map(changes.filter((c) => c.error).map((c) => [c.faultId, c.error]));
  const changed = new Set(changes.map((c) => c.faultId));

  const save = useMutation({
    mutationFn: () =>
      api.put<ModelPriceDto[]>(`/models/${modelId}/prices`, {
        prices: changes.map(({ faultId, price }) => ({ faultId, price })),
      }),
    onSuccess: () => {
      toast.success(`Saved ${changes.length} price change${changes.length === 1 ? '' : 's'}`);
      onDirtyChange(false);
      void queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  const update = (faultId: string, value: string) => {
    setDraft((d) => ({ ...d, [faultId]: value }));
    onDirtyChange(true);
  };

  const discard = () => {
    setDraft(Object.fromEntries(saved));
    onDirtyChange(false);
  };

  return (
    <div className="rounded-lg bg-white ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <div className="font-medium">{modelLabel}</div>
          <div className="text-xs text-slate-500">
            {saved.size} of {faults.filter((f) => f.isActive).length} faults priced
          </div>
        </div>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter faults"
          className={`${inputClass} w-56!`}
        />
      </div>

      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Fault / problem</th>
            <th className="px-4 py-2.5 text-left font-medium">Current price</th>
            <th className="w-56 px-4 py-2.5 text-left font-medium">New price (₹)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((f) => {
            const current = saved.get(f.id);
            const error = errors.get(f.id);
            return (
              <tr key={f.id} className={changed.has(f.id) ? 'bg-amber-50' : ''}>
                <td className="px-4 py-2">
                  {f.name}
                  {!f.isActive && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">inactive</span>}
                </td>
                <td className="px-4 py-2 text-slate-600">{current ? formatCurrency(Number(current)) : <span className="text-slate-400">Not offered</span>}</td>
                <td className="px-4 py-2">
                  <input
                    value={draft[f.id] ?? ''}
                    onChange={(e) => update(f.id, e.target.value)}
                    inputMode="decimal"
                    placeholder="—"
                    aria-label={`Price for ${f.name}`}
                    aria-invalid={!!error}
                    className={`${inputClass} py-1.5!`}
                  />
                  {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                No faults match "{filter}"
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-b-lg border-t border-slate-200 bg-white px-4 py-3">
        <span className="text-sm text-slate-600">
          {changes.length ? `${changes.length} unsaved change${changes.length === 1 ? '' : 's'}` : 'No changes'}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!changes.length || save.isPending} onClick={discard}>
            Discard
          </Button>
          <Button disabled={!changes.length || errors.size > 0} loading={save.isPending} onClick={() => save.mutate()}>
            Save prices
          </Button>
        </div>
      </div>
    </div>
  );
}
