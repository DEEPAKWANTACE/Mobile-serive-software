import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { inputClass } from './Field';

export type ComboOption = { value: string; label: string; hint?: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  emptyText?: string;
  onSearchChange?: (text: string) => void;
};

/** Rank: label starts with the query first, then word-start matches, then anywhere. */
function rank(label: string, q: string) {
  const l = label.toLowerCase();
  if (l.startsWith(q)) return 0;
  if (l.split(/[\s-]+/).some((w) => w.startsWith(q))) return 1;
  return l.includes(q) ? 2 : -1;
}

/** Type-to-search select (e.g. type "Y" → Vivo Y-series models first). Keyboard: ↑ ↓ Enter Esc. */
export function Combobox({ value, onChange, options, placeholder, disabled, invalid, emptyText = 'No matches', onSearchChange }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options
      .map((o) => ({ o, r: rank(o.label, q) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.o.label.localeCompare(b.o.label, undefined, { numeric: true }))
      .map((x) => x.o);
  }, [options, query]);

  useEffect(() => {
    const close = (e: MouseEvent) => !wrapRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (o: ComboOption) => {
    onChange(o.value);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid}
        disabled={disabled}
        value={open ? query : (selected?.label ?? '')}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          onSearchChange?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && filtered[active]) {
            e.preventDefault();
            pick(filtered[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={`${inputClass} pr-8`}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">▾</span>
      {open && !disabled && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
          {filtered.length === 0 && <li className="px-3 py-2 text-slate-500">{emptyText}</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer justify-between gap-2 px-3 py-2 ${i === active ? 'bg-brand-50 text-brand-700' : ''} ${o.value === value ? 'font-medium' : ''}`}
            >
              <span>{o.label}</span>
              {o.hint && <span className="text-xs text-slate-500">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
