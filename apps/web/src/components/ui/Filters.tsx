import { useEffect, useRef, useState, type ReactNode } from 'react';
import { inputClass } from './Field';

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-3">{children}</div>;
}

/** Search box that reports its value after the user stops typing. */
export function SearchInput({
  onSearch,
  placeholder = 'Search…',
  className = '',
  initialValue = '',
}: {
  onSearch: (v: string) => void;
  placeholder?: string;
  className?: string;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;
  useEffect(() => {
    const t = setTimeout(() => onSearchRef.current(value.trim()), 180);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      className={`${inputClass} w-64! ${className}`}
    />
  );
}

export type StatusFilterValue = '' | 'true' | 'false';

export function StatusFilter({ value, onChange }: { value: StatusFilterValue; onChange: (v: StatusFilterValue) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as StatusFilterValue)} className={`${inputClass} w-36!`}>
      <option value="">All statuses</option>
      <option value="true">Active</option>
      <option value="false">Inactive</option>
    </select>
  );
}

export function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={`${inputClass} w-48!`}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
