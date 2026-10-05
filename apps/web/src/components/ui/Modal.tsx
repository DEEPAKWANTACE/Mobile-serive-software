import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
};

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

/** Accessible modal built on the native <dialog> (focus trap + Esc handled by the browser). */
export function Modal({ open, onClose, title, children, size = 'md' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto w-[calc(100%-2rem)] ${widths[size]} rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40`}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="font-semibold">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">
              ✕
            </button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
