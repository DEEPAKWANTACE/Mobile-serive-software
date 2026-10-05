import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_MODE_LABELS, RWR_REASON_LABELS, type InvoiceDto, type RwrReason } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api-client';
import { formatCurrency, formatDateTime } from '@/lib/format';

/** Printable invoice (A5/A4). Sidebar and header are hidden when printing. */
export function InvoicePage() {
  const { id = '' } = useParams();
  const { data: inv, isLoading, error } = useQuery({ queryKey: ['jobs', id, 'invoice'], queryFn: () => api.get<InvoiceDto>(`/jobs/${id}/invoice`) });

  if (isLoading) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  if (error || !inv) return <div className="p-10 text-center text-slate-600">{error?.message ?? 'Invoice not found'}</div>;

  const received = inv.payments.filter((p) => p.kind !== 'REFUND');
  const refunds = inv.payments.filter((p) => p.kind === 'REFUND');

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to={`/jobs/${inv.job.id}`} className="text-sm text-slate-500 hover:underline">
          ← Back to job
        </Link>
        <Button onClick={() => window.print()}>🖨 Print invoice</Button>
      </div>

      <article className="rounded-lg bg-white p-8 text-sm ring-1 ring-slate-200 print:rounded-none print:p-0 print:ring-0">
        <header className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-lg font-bold">{inv.branch.name}</h1>
            {inv.branch.address && <p className="text-slate-600">{inv.branch.address}</p>}
            {inv.branch.phone && <p className="text-slate-600">Ph: {inv.branch.phone}</p>}
          </div>
          <div className="text-right">
            <div className="text-base font-semibold">INVOICE</div>
            <div className="font-mono">{inv.invoiceNumber}</div>
            <div className="text-slate-600">{formatDateTime(inv.createdAt)}</div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 border-b border-slate-200 py-4">
          <div>
            <div className="text-xs text-slate-500 uppercase">Customer</div>
            <div className="font-medium">{inv.customer.name}</div>
            <div>{inv.customer.phone}</div>
            {inv.customer.address && <div className="text-slate-600">{inv.customer.address}</div>}
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase">Device</div>
            <div className="font-medium">{inv.job.device}</div>
            {inv.job.imei && <div className="font-mono">IMEI {inv.job.imei}</div>}
            {inv.job.serialNumber && <div className="font-mono">S/N {inv.job.serialNumber}</div>}
            <div className="text-slate-600">
              Job <span className="font-mono">{inv.job.jobNumber}</span> · received {formatDateTime(inv.job.receivedAt)}
            </div>
          </div>
        </section>

        {inv.job.rwrReason && (
          <p className="border-b border-slate-200 py-3 text-slate-700">
            Returned without repair — {RWR_REASON_LABELS[inv.job.rwrReason as RwrReason] ?? inv.job.rwrReason}
          </p>
        )}

        <table className="my-4 w-full">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
              <th className="py-1.5">Description</th>
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.length ? (
              inv.lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5">{l.description}</td>
                  <td className="py-1.5 text-right">{formatCurrency(l.amount)}</td>
                </tr>
              ))
            ) : (
              <tr className="border-b border-slate-100">
                <td className="py-1.5 text-slate-500">No charge</td>
                <td className="py-1.5 text-right">{formatCurrency(0)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-2 text-right text-slate-600">Subtotal</td>
              <td className="pt-2 text-right">{formatCurrency(inv.subtotal)}</td>
            </tr>
            {inv.discount > 0 && (
              <tr>
                <td className="text-right text-slate-600">Discount{inv.discountReason && ` (${inv.discountReason})`}</td>
                <td className="text-right">− {formatCurrency(inv.discount)}</td>
              </tr>
            )}
            <tr className="text-base font-bold">
              <td className="pt-1 text-right">Total</td>
              <td className="pt-1 text-right">{formatCurrency(inv.total)}</td>
            </tr>
          </tfoot>
        </table>

        <section className="border-t border-slate-200 pt-3">
          <div className="text-xs text-slate-500 uppercase">Payments</div>
          <ul className="mt-1 space-y-0.5">
            {received.map((p, i) => (
              <li key={i} className="flex justify-between">
                <span>
                  {p.kind === 'ADVANCE' ? 'Advance' : 'Paid'} · {PAYMENT_MODE_LABELS[p.mode]}
                  {p.reference && ` (${p.reference})`} · {formatDateTime(p.createdAt)}
                </span>
                <span>{formatCurrency(p.amount)}</span>
              </li>
            ))}
            {refunds.map((p, i) => (
              <li key={`r${i}`} className="flex justify-between">
                <span>Refunded · {PAYMENT_MODE_LABELS[p.mode]}</span>
                <span>− {formatCurrency(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-8 flex justify-between text-xs text-slate-500">
          <span>
            Delivered to {inv.job.deliveredTo} · billed by {inv.createdBy.name}
          </span>
          <span>Customer signature: ____________________</span>
        </footer>
      </article>
    </div>
  );
}
