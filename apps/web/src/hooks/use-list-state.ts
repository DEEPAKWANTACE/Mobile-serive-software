import { useCallback, useState } from 'react';
import type { StatusFilterValue } from '@/components/ui/Filters';

/** Common list-page state: search, status filter, page, plus arbitrary extra filters. Resets to page 1 on change. */
export function useListState<F extends Record<string, string>>(initialFilters: F) {
  const [page, setPage] = useState(1);
  const [search, setSearchRaw] = useState('');
  const [status, setStatusRaw] = useState<StatusFilterValue>('');
  const [filters, setFiltersRaw] = useState<F>(initialFilters);

  const setSearch = useCallback((v: string) => {
    setSearchRaw(v);
    setPage(1);
  }, []);
  const setStatus = useCallback((v: StatusFilterValue) => {
    setStatusRaw(v);
    setPage(1);
  }, []);
  const setFilter = useCallback(<K extends keyof F>(key: K, value: F[K], reset: Partial<F> = {}) => {
    setFiltersRaw((f) => ({ ...f, ...reset, [key]: value }));
    setPage(1);
  }, []);

  return {
    page,
    setPage,
    setSearch,
    status,
    setStatus,
    filters,
    setFilter,
    params: { page, pageSize: 20, search, isActive: status, ...filters },
  };
}
