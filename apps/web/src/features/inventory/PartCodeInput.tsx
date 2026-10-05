import { useState } from 'react';
import type { PartLookupDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format';

type Props = {
  onFound: (part: PartLookupDto) => void;
  branchId?: string;
  actionLabel?: string;
  placeholder?: string;
};

/** Type a part code (e.g. 105) and press Enter — shows the part's name, price and branch stock. */
export function PartCodeInput({ onFound, branchId, actionLabel = 'Find', placeholder = 'Part code, e.g. 105' }: Props) {
  const [code, setCode] = useState('');
  const [part, setPart] = useState<PartLookupDto | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const find = async () => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setLoading(true);
    setError(undefined);
    try {
      const found = await api.get<PartLookupDto>(`/parts/lookup?code=${encodeURIComponent(c)}${branchId ? `&branchId=${branchId}` : ''}`);
      setPart(found);
      onFound(found);
    } catch (err) {
      setPart(null);
      setError(err instanceof ApiError ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setPart(null);
            setError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void find();
            }
          }}
          placeholder={placeholder}
          aria-label="Part code"
          className={`${inputClass} w-44! font-mono uppercase`}
        />
        <Button variant="secondary" loading={loading} onClick={() => void find()}>
          {actionLabel}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {part && (
        <p className="mt-1 text-sm text-slate-700">
          <span className="font-mono font-semibold">{part.code}</span> · {part.name} · {formatCurrency(part.sellingPrice)}
          {part.stock !== null && (
            <span className={part.stock > 0 ? ' text-emerald-700' : ' text-red-600'}> · {part.stock > 0 ? `${part.stock} in stock` : 'out of stock'}</span>
          )}
        </p>
      )}
    </div>
  );
}
