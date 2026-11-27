import type { CSSProperties, ReactNode } from 'react';

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Header-cell style, e.g. a width for fixed-layout tables. */
  style?: CSSProperties;
};

const SELECT_HEADER = '__select__';

type Props<T> = {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Row selection (checkbox column) — pass both to enable. */
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  rowClassName?: (row: T) => string;
  containerClassName?: string;
  tableClassName?: string;
  headerCellClassName?: string;
  cellClassName?: string;
  /** Let natural-height rows share any unused vertical space. */
  fillHeight?: boolean;
  /** Minimum table width (e.g. '1100px') — wider tables scroll horizontally. */
  minTableWidth?: string;
  /** Keep the header row visible while the surrounding scroll box scrolls down (the container must not scroll itself). */
  stickyHeader?: boolean;
  /** Pin this many leading columns (plus the checkbox column) on the left while scrolling sideways; they need a `style.width`. */
  stickyColumns?: number;
};

export function DataTable<T>({
  columns: baseColumns,
  rows,
  rowKey,
  isLoading,
  emptyMessage = 'No records found',
  selected,
  onSelectedChange,
  rowClassName,
  containerClassName = '',
  tableClassName = '',
  headerCellClassName = '',
  cellClassName = '',
  fillHeight = false,
  minTableWidth,
  stickyHeader = false,
  stickyColumns = 0,
}: Props<T>) {
  const keys = rows?.map(rowKey) ?? [];
  const allChecked = keys.length > 0 && keys.every((k) => selected?.has(k));
  const toggle = (k: string) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onSelectedChange?.(next);
  };
  const toggleAll = () => {
    const next = new Set(selected);
    for (const k of keys) {
      if (allChecked) next.delete(k);
      else next.add(k);
    }
    onSelectedChange?.(next);
  };
  const checkbox = 'size-4 cursor-pointer rounded border-slate-300 accent-brand-600';
  const columns: Column<T>[] =
    selected && onSelectedChange
      ? [
          {
            header: SELECT_HEADER,
            className: 'w-8',
            style: { width: '2.5rem' },
            cell: (row) => <input type="checkbox" aria-label="Select row" className={checkbox} checked={selected.has(rowKey(row))} onChange={() => toggle(rowKey(row))} />,
          },
          ...baseColumns,
        ]
      : baseColumns;
  const pinned = stickyColumns > 0 ? stickyColumns + (columns[0]?.header === SELECT_HEADER ? 1 : 0) : 0;
  // Each pinned column starts where the widths of the pinned columns before it end.
  const pinStyle = (i: number): CSSProperties | undefined =>
    i < pinned ? { left: i === 0 ? 0 : `calc(${columns.slice(0, i).map((c) => c.style?.width ?? '0px').join(' + ')})` } : undefined;
  const pinClass = (i: number) => (i < pinned ? `sticky-cell sticky ${i === pinned - 1 ? 'sticky-cell-edge' : ''}` : '');

  return (
    <div style={fillHeight ? { height: '100%' } : undefined} className={`theme-panel overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200 ${containerClassName}`}>
      <table style={{ ...(fillHeight && { height: '100%' }), ...(minTableWidth && { minWidth: minTableWidth }) }} className={`min-w-full divide-y divide-slate-200 text-sm ${tableClassName}`}>
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c, i) => (
              <th
                key={c.header}
                style={{ ...c.style, ...pinStyle(i) }}
                className={`px-4 py-2.5 text-left font-medium whitespace-nowrap text-slate-600 ${stickyHeader || i < pinned ? 'sticky bg-slate-50' : ''} ${stickyHeader ? 'top-0' : ''} ${i < pinned ? `${stickyHeader ? 'z-30' : 'z-10'} ${i === pinned - 1 ? 'sticky-cell-edge' : ''}` : stickyHeader ? 'z-20' : ''} ${headerCellClassName} ${c.className ?? ''}`}
              >
                {c.header === SELECT_HEADER ? <input type="checkbox" aria-label="Select all on this page" className={checkbox} checked={allChecked} onChange={toggleAll} /> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {isLoading && !rows ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">
                Loading…
              </td>
            </tr>
          ) : !rows?.length ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className={`${rowClassName?.(row) ?? ''} hover:bg-slate-50`}>
                {columns.map((c, i) => (
                  <td key={c.header} style={pinStyle(i)} className={`px-4 py-2.5 ${pinClass(i) && `${pinClass(i)} z-10`} ${cellClassName} ${c.className ?? ''}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
