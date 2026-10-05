import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { STOCK_MOVEMENT_LABELS, STOCK_MOVEMENT_TYPES, type Paginated, type StockMovementDto } from '@msm/shared';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FilterBar, FilterSelect, SearchInput } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { api } from '@/lib/api-client';
import { toQueryString } from '@/lib/crud';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { ROLES } from '@msm/shared';
import { useAuth } from '@/features/auth/auth-context';
import { useStoreBranch } from './useStoreBranch';

export function StockLedgerPage() {
  const { branchId, picker, needsBranch } = useStoreBranch();
  const canOpenJobs = useAuth().user?.role !== ROLES.STOREKEEPER;
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const params = { branchId, search, type, page, pageSize: 50 };
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'movements', params],
    queryFn: () => api.get<Paginated<StockMovementDto>>(`/inventory/movements?${toQueryString(params)}`),
    enabled: !needsBranch,
  });

  const columns: Column<StockMovementDto>[] = [
    { header: 'When', cell: (m) => <span className="whitespace-nowrap text-slate-600">{formatDateTime(m.createdAt)}</span> },
    {
      header: 'Part',
      cell: (m) => (
        <span>
          <span className="font-mono font-semibold">{m.part.code}</span> · {m.part.name}
        </span>
      ),
    },
    { header: 'Type', cell: (m) => STOCK_MOVEMENT_LABELS[m.type] },
    {
      header: 'Qty',
      cell: (m) => <span className={`font-semibold ${m.quantity > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>,
    },
    { header: 'Balance', cell: (m) => m.balanceAfter },
    {
      header: 'Details',
      cell: (m) => (
        <span className="text-sm text-slate-600">
          {m.job &&
            (canOpenJobs ? (
              <Link to={`/jobs/${m.job.id}`} className="font-mono text-brand-600 hover:underline">
                {m.job.jobNumber}
              </Link>
            ) : (
              <span className="font-mono">{m.job.jobNumber}</span>
            ))}
          {m.reference && ` Ref ${m.reference}`}
          {m.unitCost !== null && ` @ ${formatCurrency(m.unitCost)}`}
          {m.note && ` — ${m.note}`}
        </span>
      ),
    },
    { header: 'By', cell: (m) => m.createdBy.name },
  ];

  return (
    <div>
      <PageHeader title="Stock Ledger" description="Every stock in, issue, return and adjustment" />
      <FilterBar>
        {picker}
        <SearchInput onSearch={(v) => (setSearch(v), setPage(1))} placeholder="Search part code or name" />
        <FilterSelect
          value={type}
          onChange={(v) => (setType(v), setPage(1))}
          placeholder="All types"
          options={STOCK_MOVEMENT_TYPES.map((t) => ({ value: t, label: STOCK_MOVEMENT_LABELS[t] }))}
        />
      </FilterBar>
      {needsBranch ? (
        <p className="text-sm text-slate-500">Select a branch.</p>
      ) : (
        <>
          <DataTable columns={columns} rows={data?.items} rowKey={(m) => m.id} isLoading={isLoading} emptyMessage="No stock movements yet" />
          {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
        </>
      )}
    </div>
  );
}
