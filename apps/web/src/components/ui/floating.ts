import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

const supportsPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

/**
 * Positions a dropdown list under (or above, when there is no room) its anchor and lifts it into the
 * browser top layer, so it is never hidden behind the next card, a sticky bar or an open dialog.
 */
export function useFloatingList<T extends HTMLElement>(anchorRef: RefObject<HTMLElement | null>, open: boolean, maxHeight = 256) {
  const listRef = useRef<T | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (supportsPopover && list && !list.matches(':popover-open')) {
      try {
        list.showPopover();
      } catch {
        /* not connected yet */
      }
    }
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      const gap = 4;
      const below = window.innerHeight - a.bottom - gap - 8;
      const above = a.top - gap - 8;
      const up = below < Math.min(maxHeight, 160) && above > below;
      const h = Math.max(120, Math.min(maxHeight, up ? above : below));
      // Each side is set explicitly (no `inset` shorthand): a shorthand after `left` would reset it.
      setStyle({
        position: 'fixed',
        margin: 0,
        left: a.left,
        right: 'auto',
        width: a.width,
        maxHeight: h,
        ...(up ? { top: 'auto', bottom: window.innerHeight - a.top + gap } : { top: a.bottom + gap, bottom: 'auto' }),
        zIndex: 1000,
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      if (supportsPopover && list?.matches(':popover-open')) list.hidePopover();
    };
  }, [open, anchorRef, maxHeight]);

  return { listRef, style, popoverProps: supportsPopover ? { popover: 'manual' as const } : {} };
}
