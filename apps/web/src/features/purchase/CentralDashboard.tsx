import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, Boxes, CircleDollarSign, Inbox, PackageCheck, Truck } from 'lucide-react';
import type { CentralOverviewDto } from '@msm/shared';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatCard } from '@/features/dashboard/StatCard';
import { api } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format';

type Branch = CentralOverviewDto['branches'][number];

/** The Central Storekeeper's home: orders waiting, stock on the road, own stock and every branch store. */
export function CentralDashboard() {
  const q = useQuery({ queryKey: ['central', 'overview'], queryFn: () => api.get<CentralOverviewDto>('/central/overview'), refetchInterval: 120_000 });
  const d = q.data;
  const columns: Column<Branch>[] = [
    { header: 'Branch store', cell: (b) => <span className="font-medium">{b.name} <span className="text-slate-500">({b.code})</span></span> },
    { header: 'Part items', className: 'text-right', cell: (b) => b.items },
    { header: 'Units', className: 'text-right', cell: (b) => b.units },
    { header: 'Stock value', className: 'text-right', cell: (b) => formatCurrency(b.value) },
    { header: 'Low stock', className: 'text-right', cell: (b) => <span className={b.low ? 'font-semibold text-red-600' : ''}>{b.low}</span> },
    { header: 'Open orders', className: 'text-right', cell: (b) => (b.openOrders ? <Link to={`/store/purchase-orders?tab=open&branchId=${b.id}`} className="font-semibold text-brand-600 hover:underline">{b.openOrders}</Link> : 0) },
    { header: 'On the way', className: 'text-right', cell: (b) => b.inTransit },
    {
      header: '',
      className: 'text-right',
      cell: (b) => (
        <span className="flex justify-end gap-3 text-sm font-medium whitespace-nowrap">
          <Link to={`/store/stock?branchId=${b.id}`} className="text-brand-600 hover:underline">View stock</Link>
          <Link to={`/store/ledger?branchId=${b.id}`} className="text-brand-600 hover:underline">Ledger</Link>
        </span>
      ),
    },
  ];

  if (q.error) return <p className="text-sm text-red-600">{q.error.message}</p>;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="New purchase orders" value={d?.newOrders} to="/store/purchase-orders?tab=new" tone={d?.newOrders ? 'warning' : 'default'} icon={Inbox} hint="Waiting to be accepted" />
        <StatCard label="Orders to supply" value={d?.ordersToSupply} to="/store/purchase-orders?tab=supply" tone="brand" icon={PackageCheck} hint="Accepted, quantity pending" />
        <StatCard label="Lines on the way" value={d?.linesInTransit} to="/central/supplies" icon={Truck} hint="Sent, not yet received" />
        <StatCard label="Recalls to receive" value={d?.recallsInTransit} to="/store/transfers" icon={ArrowDownToLine} hint="Coming back to Central" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Central stock units" value={d?.central.units} to="/store/stock" icon={Boxes} hint={d ? `${d.central.items} part items` : undefined} />
        <StatCard label="Central stock value" value={d ? formatCurrency(d.central.value) : undefined} to="/store/stock" tone="info" icon={CircleDollarSign} hint="At purchase cost" />
        <StatCard label="Central low stock" value={d?.central.low} to="/store/stock" tone={d?.central.low ? 'critical' : 'default'} icon={AlertTriangle} hint="Buy or recall more" />
      </div>
      <Card title="Branch stores" subtitle="Stock, low items and orders at every branch" icon={Boxes}>
        <DataTable columns={columns} rows={d?.branches} rowKey={(b) => b.id} isLoading={q.isLoading} emptyMessage="No branches yet" />
      </Card>
    </>
  );
}
