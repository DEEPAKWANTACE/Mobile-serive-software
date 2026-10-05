import { Link } from 'react-router';

export type BarItem = { key: string; label: string; value: number; to?: string; hint?: string };

/**
 * Horizontal bars for one series (single colour), ordered as given. Thin rounded bars, value as text ink beside the bar,
 * whole row is the hover/click target.
 */
export function BarList({ items, color = '#2a78d6', emptyText = 'Nothing to show' }: { items: BarItem[]; color?: string; emptyText?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return (
    <ul className="space-y-1">
      {items.map((it) => {
        const row = (
          <div className="group grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-3 rounded-md px-2 py-1.5 transition hover:bg-slate-50" title={it.hint ?? `${it.label}: ${it.value}`}>
            <span className="truncate text-sm text-slate-600 group-hover:text-slate-900">{it.label}</span>
            <span className="h-2.5 rounded-full bg-slate-100">
              <span
                className="block h-2.5 rounded-full transition-[width] duration-500"
                style={{ width: it.value ? `${Math.max(4, (it.value / max) * 100)}%` : 0, background: color }}
              />
            </span>
            <span className="text-right text-sm font-semibold text-slate-900 tabular-nums">{it.value}</span>
          </div>
        );
        return <li key={it.key}>{it.to ? <Link to={it.to}>{row}</Link> : row}</li>;
      })}
    </ul>
  );
}
