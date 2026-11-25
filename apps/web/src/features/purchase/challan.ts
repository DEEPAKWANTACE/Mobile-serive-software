import { toast } from 'sonner';
import type { SupplyDto } from '@msm/shared';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { openPrintWindow, writeTable } from '@/lib/print-table';
import { downloadXlsx } from '@/lib/xlsx';

export const SUPPLY_LINE_STATUS = { SENT: 'In transit', RECEIVED: 'Received', CANCELLED: 'Cancelled' } as const;

const HEADERS = ['Part code', 'Product', 'Quantity', 'Rate', 'Amount', 'Status', 'Received qty'];

const rows = (c: SupplyDto) =>
  c.lines.map((l) => [l.partCode, l.product, l.quantity, l.rate, l.amount, SUPPLY_LINE_STATUS[l.status], l.status === 'RECEIVED' ? (l.receivedQuantity ?? l.quantity) : '']);

export function printChallan(c: SupplyDto) {
  const win = openPrintWindow();
  if (!win) return toast.error('Allow pop-ups to download the PDF');
  writeTable(win, {
    title: `Supply challan ${c.challanNumber}`,
    subtitle: `To ${c.branch.name} (${c.branch.code}) · ${formatDateTime(c.createdAt)} · by ${c.createdBy}${c.poNumber ? ` · against ${c.poNumber}` : ''} · ${c.totalQuantity} pcs · ${formatCurrency(c.totalAmount)}`,
    headers: HEADERS,
    rows: rows(c),
  });
}

export const exportChallan = (c: SupplyDto) => void downloadXlsx(`${c.challanNumber}.xlsx`, HEADERS, rows(c), c.challanNumber);
