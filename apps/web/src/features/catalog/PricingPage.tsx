import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { priceOptionSchema, type BrandDto, type FaultDto, type ModelDto, type ModelPriceDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { Combobox } from '@/components/ui/Combobox';
import { FilterBar } from '@/components/ui/Filters';
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
        <div className="w-56">
          <Combobox
            value={brandId}
            onChange={(v) => select({ brandId: v, modelId: '' })}
            placeholder="Select brand"
            options={brands.map((b) => ({ value: b.id, label: b.name }))}
          />
        </div>
        <div className="w-64">
          <Combobox
            value={modelId}
            onChange={(v) => select({ modelId: v })}
            placeholder={brandId ? 'Type to search model' : 'Select brand first'}
            disabled={!brandId}
            options={models.map((m) => ({ value: m.id, label: m.name }))}
          />
        </div>
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

type DraftOption = { label: string; price: string };

const DEFAULT_LABEL = 'Standard';
const norm = (opts: DraftOption[]) => JSON.stringify(opts.map((o) => [o.label.trim(), o.price.trim()]));

function PriceGrid({ modelId, modelLabel, faults, prices, onDirtyChange }: GridProps) {
  const queryClient = useQueryClient();
  const saved = useMemo(() => {
    const map = new Map<string, DraftOption[]>();
    for (const p of prices) map.set(p.faultId, [...(map.get(p.faultId) ?? []), { label: p.label, price: String(p.price) }]);
    return map;
  }, [prices]);
  const [draft, setDraft] = useState<Record<string, DraftOption[]>>(() => Object.fromEntries(saved));
  const [filter, setFilter] = useState('');

  const optionsOf = (faultId: string) => draft[faultId] ?? [];
  const visible = faults.filter((f) => (f.isActive || saved.has(f.id)) && f.name.toLowerCase().includes(filter.toLowerCase()));

  // Group rows by category (uncategorised last).
  const groups = useMemo(() => {
    const m = new Map<string, FaultDto[]>();
    for (const f of visible) {
      const key = f.category?.name ?? 'Other';
      m.set(key, [...(m.get(key) ?? []), f]);
    }
    return [...m.entries()];
  }, [visible]);

  // Validate only the faults the user changed.
  const changes = faults.flatMap((f) => {
    const opts = optionsOf(f.id).filter((o) => o.label.trim() || o.price.trim());
    if (norm(opts) === norm(saved.get(f.id) ?? [])) return [];
    const labels = opts.map((o) => o.label.trim().toLowerCase());
    let error: string | undefined;
    const parsed = opts.map((o) => {
      const r = priceOptionSchema.safeParse({ label: o.label, price: o.price });
      if (!r.success) error ??= r.error.issues[0]?.message;
      return r.success ? r.data : null;
    });
    if (new Set(labels).size !== labels.length) error ??= 'Option names must be different';
    return [{ faultId: f.id, options: parsed.filter((x) => x !== null), error }];
  });
  const errors = new Map(changes.filter((c) => c.error).map((c) => [c.faultId, c.error]));
  const changed = new Set(changes.map((c) => c.faultId));

  const save = useMutation({
    mutationFn: () =>
      api.put<ModelPriceDto[]>(`/models/${modelId}/prices`, {
        prices: changes.map(({ faultId, options }) => ({ faultId, options })),
      }),
    onSuccess: () => {
      toast.success(`Saved prices for ${changes.length} fault${changes.length === 1 ? '' : 's'}`);
      onDirtyChange(false);
      void queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  const setOptions = (faultId: string, opts: DraftOption[]) => {
    setDraft((d) => ({ ...d, [faultId]: opts }));
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
            {saved.size} of {faults.filter((f) => f.isActive).length} faults priced · add several options for quality tiers (e.g. Copy / OG / Original)
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

      {groups.map(([category, rows]) => (
        <div key={category}>
          <div className="bg-slate-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{category}</div>
          <ul className="divide-y divide-slate-100">
            {rows.map((f) => {
              const opts = optionsOf(f.id);
              const error = errors.get(f.id);
              return (
                <li key={f.id} className={`flex flex-wrap items-start gap-4 px-4 py-3 ${changed.has(f.id) ? 'bg-amber-50' : ''}`}>
                  <div className="w-56 pt-1.5 text-sm">
                    {f.name}
                    {!f.isActive && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">inactive</span>}
                  </div>
                  <div className="flex-1 space-y-2">
                    {opts.length === 0 && <div className="pt-1.5 text-sm text-slate-400">Not offered</div>}
                    {opts.map((o, i) => {
                      const was = saved.get(f.id)?.find((x) => x.label === o.label);
                      return (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          value={o.label}
                          onChange={(e) => setOptions(f.id, opts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                          placeholder="Option (e.g. OG)"
                          aria-label={`Option name for ${f.name}`}
                          className={`${inputClass} w-40! py-1.5!`}
                        />
                        <span className="text-sm text-slate-500">₹</span>
                        <input
                          value={o.price}
                          onChange={(e) => setOptions(f.id, opts.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                          inputMode="decimal"
                          placeholder="Price"
                          aria-label={`Price for ${f.name} ${o.label}`}
                          className={`${inputClass} w-32! py-1.5!`}
                        />
                        {was && was.price !== o.price && (
                          <span className="text-xs text-slate-400">was {formatCurrency(Number(was.price))}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setOptions(f.id, opts.filter((_, j) => j !== i))}
                          aria-label="Remove option"
                          className="rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                        >
                          ✕
                        </button>
                      </div>
                      );
                    })}
                    {error && <div className="text-xs text-red-600">{error}</div>}
                    {opts.length < 10 && (
                      <Button
                        variant="link"
                        onClick={() => setOptions(f.id, [...opts, { label: opts.length ? '' : DEFAULT_LABEL, price: '' }])}
                      >
                        + {opts.length ? 'Add option' : 'Add price'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {visible.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-500">No faults match "{filter}"</div>}

      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-b-lg border-t border-slate-200 bg-white px-4 py-3">
        <span className="text-sm text-slate-600">
          {changes.length ? `${changes.length} fault${changes.length === 1 ? '' : 's'} changed` : 'No changes'}
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
