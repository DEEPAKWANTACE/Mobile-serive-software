import { useId, useMemo, useRef, useState } from 'react';
import { inputClass } from './Field';
import { useFloatingList } from './floating';

export type Suggestion = { value: string; hint?: string };

type Props = {
  value: string;
  /** `picked` is true when a suggestion was chosen rather than typed. */
  onChange: (value: string, picked?: Suggestion) => void;
  options: Suggestion[];
  placeholder?: string;
  'aria-label'?: string;
};

// Enough to show a whole taluka at once.
const LIMIT = 300;

/**
 * Text box with a dropdown: opening it lists the options, typing narrows them. A name that is not in the
 * list can still be typed (a new hamlet, or an older record).
 */
export function SuggestInput({ value, onChange, options, placeholder, ...rest }: Props) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    // Until the user types, show the whole list even though a value is filled in.
    const q = typed ? value.trim().toLowerCase() : '';
    if (!q) return options.slice(0, LIMIT);
    const starts: Suggestion[] = [];
    const contains: Suggestion[] = [];
    for (const o of options) {
      const n = o.value.toLowerCase();
      if (n.startsWith(q)) starts.push(o);
      else if (n.includes(q)) contains.push(o);
    }
    return [...starts, ...contains].slice(0, LIMIT);
  }, [options, value, typed]);

  const show = open && matches.length > 0;
  const floating = useFloatingList<HTMLUListElement>(wrapRef, show, 240);
  const pick = (option: Suggestion) => {
    onChange(option.value, option);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        {...rest}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        maxLength={100}
        onFocus={() => (setOpen(true), setTyped(false), setActive(0))}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setOpen(true);
          setActive(0);
        }}
        // Let a click on a suggestion land first.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(i + 1, matches.length - 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(i - 1, 0)));
          else if (e.key === 'Enter') {
            e.preventDefault();
            const option = matches[active];
            if (option) pick(option);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        className={`${inputClass} pr-8`}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">▾</span>
      {show && (
        <ul ref={floating.listRef} {...floating.popoverProps} style={floating.style} id={listId} role="listbox" className="app-popover overflow-auto rounded-md py-1 text-sm shadow-lg ring-1 ring-slate-200">
          {matches.map((o, i) => (
            <li
              key={`${o.value}|${o.hint ?? ''}`}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer justify-between gap-2 px-3 py-1.5 ${i === active ? 'bg-brand-50 text-brand-700' : ''}`}
            >
              <span>{o.value}</span>
              {o.hint && <span className="text-xs text-slate-400">{o.hint}</span>}
            </li>
          ))}
          {matches.length === LIMIT && <li className="px-3 py-1.5 text-xs text-slate-400">Type to narrow the list</li>}
        </ul>
      )}
    </div>
  );
}
