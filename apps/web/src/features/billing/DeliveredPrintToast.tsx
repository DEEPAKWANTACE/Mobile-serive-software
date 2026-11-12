import { toast } from 'sonner';
import { CheckCircle2, Printer, X } from 'lucide-react';
import { formatJobNumber } from '@/lib/format';

/**
 * Sticky top-right toast after delivery: print / download (Save as PDF) the invoice copies.
 * Stays until the user closes it, so the counter can print after returning to the dashboard.
 */
export function showDeliveredPrintToast(jobId: string, jobNumber: string, invoiceNumber: string) {
  const open = (copy: 'both' | 'office' | 'customer') => window.open(`/jobs/${jobId}/invoice?copy=${copy}&print=1`, '_blank', 'noopener');
  toast.custom(
    (id) => (
      <div className="theme-panel w-[356px] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-4 shadow-lg ring-1 ring-emerald-300">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-900">Delivered · {formatJobNumber(jobNumber)}</div>
            <div className="text-xs text-slate-500">Invoice {invoiceNumber} — print or save as PDF</div>
          </div>
          <button type="button" onClick={() => toast.dismiss(id)} aria-label="Close" className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => open('both')} className="inline-flex items-center justify-center gap-1 rounded-md bg-brand-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
            <Printer className="size-3.5" /> Both
          </button>
          <button type="button" onClick={() => open('office')} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Office only
          </button>
          <button type="button" onClick={() => open('customer')} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Customer only
          </button>
        </div>
      </div>
    ),
    { duration: Infinity, position: 'top-right' },
  );
}
