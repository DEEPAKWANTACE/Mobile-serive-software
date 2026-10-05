import type { ReactNode } from 'react';

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100 aria-invalid:border-red-400';

type Props = {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
};

/** Label + control + validation message. Pass a native input/select (e.g. with react-hook-form `register`). */
export function Field({ label, error, required, hint, className = '', children }: Props) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      )}
    </label>
  );
}
