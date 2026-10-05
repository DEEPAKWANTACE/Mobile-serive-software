import type { ReactNode } from 'react';

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isLoading?: boolean;
  emptyMessage?: string;
};

export function DataTable<T>({ columns, rows, rowKey, isLoading, emptyMessage = 'No records found' }: Props<T>) {
  return (
    <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={`px-4 py-2.5 text-left font-medium whitespace-nowrap text-slate-600 ${c.className ?? ''}`}>
                {c.header}
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
              <tr key={rowKey(row)} className="hover:bg-slate-50">
                {columns.map((c) => (
                  <td key={c.header} className={`px-4 py-2.5 ${c.className ?? ''}`}>
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
