import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PartStockOptionDto } from '@msm/shared';
import { inputClass } from '@/components/ui/Field';
import { api } from '@/lib/api-client';
import { toQueryString } from '@/lib/crud';
import { formatCurrency } from '@/lib/format';

type Props = {
  branchId: string;
  onPick: (part: PartStockOptionDto) => void;
  /** Allow choosing parts with no stock (e.g. to raise a "spare not available" request). */
  allowOutOfStock?: boolean;
  autoFocus?: boolean;
};

/** Search the parts master by code or name and pick one; shows the branch's stock and selling price. */
export function PartStockPicker({ branchId, onPick, allowOutOfStock = false, autoFocus = false }: Props) {
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const parts = useQuery({
    queryKey: ['parts', 'in-stock', branchId, search],
    queryFn: () => api.get<PartStockOptionDto[]>(`/parts/in-stock?${toQueryString({ branchId, search })}`),
  });

  return (
    <div className="space-y-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search part code or name, e.g. 105 or display"
        aria-label="Search parts"
        autoFocus={autoFocus}
        className={inputClass}
      />
      <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
        {parts.isLoading && <li className="px-3 py-2 text-sm text-slate-500">Loading…</li>}
        {parts.data?.map((p) => {
          const disabled = !allowOutOfStock && p.stock <= 0;
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(p)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="font-mono font-semibold">{p.code}</span> · <span className="truncate">{p.name}</span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  <span className="block font-semibold text-slate-900">{formatCurrency(p.sellingPrice)}</span>
                  <span className={p.stock > 0 ? 'text-emerald-700' : 'text-red-600'}>{p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</span>
                </span>
              </button>
            </li>
          );
        })}
        {parts.data && !parts.data.length && <li className="px-3 py-2 text-sm text-slate-500">No parts found</li>}
      </ul>
    </div>
  );
}
