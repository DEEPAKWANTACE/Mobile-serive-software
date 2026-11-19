import { forwardRef, useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import { inputClass } from './Field';
import { useFloatingList } from './floating';

type City = [name: string, state: string];

let cache: Promise<City[]> | null = null;
/** Indian cities (name, state) bundled from public datasets; loaded once, on first use. */
export function loadIndianCities(): Promise<City[]> {
  cache ??= fetch('/data/india-cities.json')
    .then((r) => (r.ok ? (r.json() as Promise<City[]>) : []))
    .catch(() => {
      cache = null;
      return [];
    });
  return cache;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value?: string;
  onChange?: (e: { target: { value: string; name?: string } }) => void;
  invalid?: boolean;
};

/**
 * City text box with a suggestion list of Indian cities that narrows as letters are typed.
 * Any other name can still be typed (manual entry). Works with react-hook-form `register` or controlled.
 */
export const CityInput = forwardRef<HTMLInputElement, Props>(function CityInput({ onChange, onBlur, invalid, className, ...rest }, ref) {
  const [cities, setCities] = useState<City[]>([]);
  const [query, setQuery] = useState(String(rest.value ?? rest.defaultValue ?? ''));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (rest.value !== undefined) setQuery(String(rest.value));
  }, [rest.value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const starts: City[] = [];
    const contains: City[] = [];
    for (const c of cities) {
      const n = c[0].toLowerCase();
      if (n.startsWith(q)) starts.push(c);
      else if (contains.length < 20 && n.includes(q)) contains.push(c);
      if (starts.length >= 20) break;
    }
    return [...starts, ...contains].slice(0, 20);
  }, [cities, query]);

  const setValue = (v: string) => {
    const el = inputRef.current;
    if (el) {
      // Native setter + input event so a registered react-hook-form field updates too.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setQuery(v);
  };
  const pick = (c: City) => {
    setValue(c[0]);
    setOpen(false);
  };

  const exact = matches.some((c) => c[0].toLowerCase() === query.trim().toLowerCase());
  const showList = open && matches.length > 0 && !(matches.length === 1 && exact);
  const wrapRef = useRef<HTMLDivElement>(null);
  const floating = useFloatingList<HTMLUListElement>(wrapRef, showList, 240);

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={(el) => {
          inputRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        placeholder="Type city, e.g. Khamgaon"
        {...rest}
        onFocus={(e) => {
          void loadIndianCities().then(setCities);
          setOpen(true);
          rest.onFocus?.(e);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
          onChange?.(e);
        }}
        onBlur={(e) => {
          // Let a click on a suggestion land first.
          setTimeout(() => setOpen(false), 150);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]!); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        className={`${inputClass} ${className ?? ''}`}
      />
      {showList && (
        <ul
          ref={floating.listRef}
          {...floating.popoverProps}
          style={floating.style}
          id={listId}
          role="listbox"
          className="app-popover overflow-auto rounded-md py-1 text-sm shadow-lg ring-1 ring-slate-200"
        >
          {matches.map((c, i) => (
            <li
              key={`${c[0]}|${c[1]}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer justify-between gap-2 px-3 py-1.5 ${i === active ? 'bg-brand-50 text-brand-700' : ''}`}
            >
              <span>{c[0]}</span>
              <span className="text-xs text-slate-400">{c[1]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
