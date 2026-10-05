import type { ButtonHTMLAttributes } from 'react';

const variants = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-slate-600 hover:bg-slate-100',
  link: 'text-brand-600 hover:underline px-0! py-0!',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: 'sm' | 'md';
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'md', loading, disabled, className = '', children, ...rest }: Props) {
  const sizing = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm';
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizing} ${variants[variant]} ${className}`}
      {...rest}
    >
      {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}
