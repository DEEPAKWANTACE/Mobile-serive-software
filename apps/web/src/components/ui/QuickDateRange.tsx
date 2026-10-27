import { Button } from '@/components/ui/Button';
import { todayIso } from '@/lib/format';

/** Preset date ranges (business timezone). "All time" passes empty strings and is shown only when `allowAll`. */
export function quickRanges(allowAll: boolean) {
  const today = todayIso();
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = new Date(`${monthStart}T00:00:00Z`);
  lastMonthEnd.setUTCDate(0);
  const lastMonthEndIso = lastMonthEnd.toISOString().slice(0, 10);
  const ranges: { label: string; from: string; to: string }[] = [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: todayIso(-1), to: todayIso(-1) },
    { label: 'This Month', from: monthStart, to: today },
    { label: 'Last Month', from: `${lastMonthEndIso.slice(0, 8)}01`, to: lastMonthEndIso },
  ];
  if (allowAll) ranges.push({ label: 'All Time', from: '', to: '' });
  return ranges;
}

export function QuickDateRange({ onSelect, allowAll = true, label = true }: { onSelect: (from: string, to: string) => void; allowAll?: boolean; label?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && <span className="mr-1 text-xs font-semibold text-slate-500 uppercase">Quick date:</span>}
      {quickRanges(allowAll).map((r) => (
        <Button key={r.label} type="button" variant="secondary" size="sm" onClick={() => onSelect(r.from, r.to)}>
          {r.label}
        </Button>
      ))}
    </div>
  );
}
