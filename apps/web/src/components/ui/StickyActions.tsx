import type { ReactNode } from 'react';

/** Floating action group that stays visible at the bottom of long forms and settles neatly at the end of the page. */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-4 z-20 mt-4 ml-auto flex w-fit max-w-full flex-wrap items-center justify-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg">
      {children}
    </div>
  );
}
