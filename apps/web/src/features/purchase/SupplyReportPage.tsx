import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileText } from 'lucide-react';
import { ROLES, roundMoney, type BranchDto, type SupplyDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { inputClass } from '@/components/ui/Field';
import { FilterBar, FilterSelect } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { QuickDateRange } from '@/components/ui/QuickDateRange';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/lib/api-client';
import { toQueryString, useOptions } from '@/lib/crud';
import { formatCurrency, formatDateTime, todayIso } from '@/lib/format';
import { openPrintWindow, writeTable } from '@/lib/print-table';
import { downloadXlsx } from '@/lib/xlsx';
import { exportChallan, printChallan, SUPPLY_LINE_STATUS } from './challan';

type BranchTotal = { id: string; branch: string; challans: number; sent: number; sentValue: number; received: number; receivedValue: number; inTransit: number };

/** What each branch was supplied (and what it has counted in) over a period. Branches see only their own. */
export function SupplyReportPage() {
  const { user } = useAuth();
  const isSupplier = user?.role === ROLES.CENTRAL_STOREKEEPER || user?.role === ROLES.SUPER_ADMIN;
  const [from, setFrom] = useState(`${todayIso().slice(0, 8)}01`);
  const [to, setTo] = useState(todayIso());
  const [branchId, setBranchId] = useState('');
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: isSupplier });
  const q = useQuery({
    queryKey: ['central', 'supplies', from, to, branchId],
    queryFn: () => api.get<SupplyDto[]>(`/central/supplies?${toQueryString({ from, to, branchId })}`),
  });
  const challans = q.data ?? [];

  const totals = new Map<string, BranchTotal>();
  for (const c of challans) {
    const t = totals.get(c.branch.id) ?? { id: c.branch.id, branch: `${c.branch.name} (${c.branch.code})`, challans: 0, sent: 0, sentValue: 0, received: 0, receivedValue: 0, inTransit: 0 };
    t.challans += 1;
    for (const l of c.lines) {
      if (l.status === 'CANCELLED') continue;
      t.sent += l.quantity;
      t.sentValue = roundMoney(t.sentValue + l.amount);
      if (l.status === 'SENT') t.inTransit += l.quantity;
      else {
        const counted = l.receivedQuantity ?? l.quantity;
        t.received += counted;
        t.receivedValue = roundMoney(t.receivedValue + counted * l.rate);
      }
    }
    totals.set(c.branch.id, t);
  }
  const summary = [...totals.values()].sort((a, b) => a.branch.localeCompare(b.branch));

  const lineHeaders = ['Date', 'Challan', 'PO', 'Branch', 'Part code', 'Product', 'Quantity', 'Rate', 'Amount', 'Status', 'Received qty'];
  const lineRows = challans.flatMap((c) =>
    c.lines.map((l) => [formatDateTime(c.createdAt), c.challanNumber, c.poNumber ?? '', c.branch.code, l.partCode, l.product, l.quantity, l.rate, l.amount, SUPPLY_LINE_STATUS[l.status], l.status === 'RECEIVED' ? (l.receivedQuantity ?? l.quantity) : '']),
  );
  const pdf = () => {
    const win = openPrintWindow();
    if (!win) return toast.error('Allow pop-ups to download the PDF');
    writeTable(win, { title: 'Central Store supply report', subtitle: `${from} to ${to}`, headers: lineHeaders, rows: lineRows, landscape: true });
  };

  const summaryColumns: Column<BranchTotal>[] = [
    { header: 'Branch', cell: (r) => <span className="font-medium">{r.branch}</span> },
    { header: 'Challans', className: 'text-right', cell: (r) => r.challans },
    { header: 'Sent (pcs)', className: 'text-right', cell: (r) => r.sent },
    { header: 'Sent value', className: 'text-right', cell: (r) => formatCurrency(r.sentValue) },
    { header: 'Received (pcs)', className: 'text-right', cell: (r) => r.received },
    { header: 'Received value', className: 'text-right', cell: (r) => <span className="font-semibold">{formatCurrency(r.receivedValue)}</span> },
    { header: 'In transit (pcs)', className: 'text-right', cell: (r) => r.inTransit },
  ];
  const challanColumns: Column<SupplyDto>[] = [
    { header: 'Challan', cell: (c) => <span className="font-mono font-semibold">{c.challanNumber}</span> },
    { header: 'Date', cell: (c) => <span className="whitespace-nowrap">{formatDateTime(c.createdAt)}</span> },
    { header: 'Branch', cell: (c) => c.branch.code },
    { header: 'Purchase order', cell: (c) => (c.poNumber ? <span className="font-mono">{c.poNumber}</span> : <span className="text-slate-500">Direct supply</span>) },
    { header: 'Parts', cell: (c) => <span className="text-xs text-slate-600">{c.lines.map((l) => `${l.partCode} × ${l.quantity}${l.status === 'SENT' ? ' (in transit)' : l.status === 'CANCELLED' ? ' (cancelled)' : ''}`).join(', ')}</span> },
    { header: 'Qty', className: 'text-right', cell: (c) => c.totalQuantity },
    { header: 'Value', className: 'text-right', cell: (c) => formatCurrency(c.totalAmount) },
    {
      header: '',
      className: 'text-right',
      cell: (c) => (
        <span className="flex justify-end gap-3">
          <Button variant="link" onClick={() => exportChallan(c)}>Excel</Button>
          <Button variant="link" onClick={() => printChallan(c)}>PDF</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={isSupplier ? 'Supply Records' : 'Supplies Received'}
        description="Supply challans from the Central Store, with quantities and value"
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={!lineRows.length} onClick={() => void downloadXlsx(`supplies_${from}_${to}.xlsx`, lineHeaders, lineRows, 'Supplies')}><Download className="size-4" /> Excel</Button>
            <Button variant="secondary" size="sm" disabled={!lineRows.length} onClick={pdf}><FileText className="size-4" /> PDF</Button>
          </>
        }
      />
      <FilterBar>
        {isSupplier && <FilterSelect value={branchId} onChange={setBranchId} placeholder="All branches" options={branches.filter((b) => b.type !== 'CENTRAL_STORE').map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))} />}
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" className={`${inputClass} w-40!`} />
        <span className="text-slate-500">to</span>
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" className={`${inputClass} w-40!`} />
        <QuickDateRange onSelect={(f, t) => (setFrom(f), setTo(t))} allowAll={false} label={false} />
      </FilterBar>
      {q.error && <p className="text-sm text-red-600">{q.error.message}</p>}
      <Card title="By branch">
        <DataTable columns={summaryColumns} rows={summary} rowKey={(r) => r.id} isLoading={q.isLoading} emptyMessage="Nothing supplied in this period" />
      </Card>
      <Card title={`Challans (${challans.length})`}>
        <DataTable columns={challanColumns} rows={challans} rowKey={(c) => c.id} isLoading={q.isLoading} emptyMessage="No challans in this period" />
      </Card>
    </div>
  );
}
