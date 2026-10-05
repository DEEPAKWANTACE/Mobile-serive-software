import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PAYMENT_MODE_LABELS, PAYMENT_MODES, roundMoney, type BillPreviewDto, type JobDto, type PaymentMode } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format';

type PayRow = { mode: PaymentMode; amount: string; reference: string };

/** Counter hands the phone back: bill (from approved estimate), discount, payments / refund, accessories, collector. */
export function DeliveryForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const preview = useQuery({ queryKey: ['jobs', job.id, 'bill'], queryFn: () => api.get<BillPreviewDto>(`/jobs/${job.id}/bill-preview`) });
  if (preview.isLoading) return <p className="text-sm text-slate-500">Loading bill…</p>;
  if (!preview.data) return <p className="text-sm text-red-600">{preview.error?.message ?? 'Could not load the bill'}</p>;
  return <DeliveryFormInner job={job} bill={preview.data} onDone={onDone} />;
}

function DeliveryFormInner({ job, bill, onDone }: { job: JobDto; bill: BillPreviewDto; onDone: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [discount, setDiscount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [inspection, setInspection] = useState('');
  const [deliveredTo, setDeliveredTo] = useState(job.customer.name);
  const [accessoriesReturned, setAccessoriesReturned] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const subtotal = bill.kind === 'RWR' ? Number(inspection) || 0 : bill.subtotal;
  const total = roundMoney(subtotal - (Number(discount) || 0));
  const due = roundMoney(total - bill.paid);

  const [payments, setPayments] = useState<PayRow[]>(() => [{ mode: 'CASH', amount: due > 0 ? String(due) : '', reference: '' }]);
  const [refundMode, setRefundMode] = useState<PaymentMode>('CASH');
  const [touched, setTouched] = useState(false);
  // Until the user edits it, a single payment row follows the balance (e.g. after a discount is typed).
  useEffect(() => {
    if (!touched) setPayments((rows) => (rows.length === 1 ? [{ ...rows[0]!, amount: due > 0 ? String(due) : '' }] : rows));
  }, [due, touched]);
  const collected = roundMoney(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const missingImei = bill.imeiRequired && !job.imei && !job.serialNumber;

  const deliver = useMutation({
    mutationFn: () =>
      api.post<{ invoiceNumber: string }>(`/jobs/${job.id}/deliver`, {
        discount: Number(discount) || 0,
        discountReason: discountReason || null,
        inspectionCharge: bill.kind === 'RWR' ? Number(inspection) || 0 : 0,
        payments: due > 0 ? payments.filter((p) => Number(p.amount) > 0).map((p) => ({ ...p, reference: p.reference || null })) : [],
        refund: due < 0 ? { mode: refundMode, amount: -due } : null,
        deliveredTo,
        accessoriesReturned,
        note: note || null,
      }),
    onSuccess: (r) => {
      toast.success(`Delivered — invoice ${r.invoiceNumber}`);
      // The bill preview no longer applies to a delivered job; drop it instead of refetching it.
      queryClient.removeQueries({ queryKey: ['jobs', job.id, 'bill'] });
      void queryClient.invalidateQueries({ predicate: (q) => !(q.queryKey[0] === 'jobs' && q.queryKey[2] === 'bill') });
      onDone();
      navigate(`/jobs/${job.id}/invoice`);
    },
    onError: (err) => {
      const d = err instanceof ApiError ? (err.details as Record<string, string[]> | undefined) : undefined;
      if (d) setErrors(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v?.[0]])));
      else toast.error(err.message);
    },
  });

  const setPay = (i: number, patch: Partial<PayRow>) => {
    if ('amount' in patch) setTouched(true);
    setPayments((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErrors({});
        deliver.mutate();
      }}
      className="space-y-5"
    >
      {missingImei && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          IMEI / serial number is missing. Add it on the job (“Add IMEI / serial”) before delivering a repaired phone.
        </div>
      )}

      {/* Bill */}
      <div className="rounded-md border border-slate-200">
        <ul className="divide-y divide-slate-100 text-sm">
          {bill.kind === 'REPAIR' ? (
            bill.lines.map((l, i) => (
              <li key={i} className="flex justify-between px-3 py-1.5">
                <span>{l.description}</span>
                <span>{formatCurrency(l.amount)}</span>
              </li>
            ))
          ) : (
            <li className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                Returned without repair — inspection / diagnosis charge
                <span className="block text-xs text-slate-500">Leave blank if no charge</span>
              </span>
              <input value={inspection} onChange={(e) => setInspection(e.target.value)} inputMode="decimal" placeholder="₹ 0" className={`${inputClass} w-28!`} />
            </li>
          )}
          <li className="flex items-center justify-between gap-3 px-3 py-2">
            <span>Discount</span>
            <span className="flex items-center gap-2">
              <input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="Reason" className={`${inputClass} w-44! py-1!`} />
              <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="₹ 0" className={`${inputClass} w-28! py-1!`} />
            </span>
          </li>
          <li className="flex justify-between bg-slate-50 px-3 py-2 font-semibold">
            <span>Total</span>
            <span>{formatCurrency(total)}</span>
          </li>
          <li className="flex justify-between px-3 py-1.5 text-slate-600">
            <span>Already paid (advance)</span>
            <span>− {formatCurrency(bill.paid)}</span>
          </li>
          <li className={`flex justify-between px-3 py-2 text-base font-semibold ${due < 0 ? 'text-orange-700' : ''}`}>
            <span>{due < 0 ? 'Refund to customer' : 'Balance to collect'}</span>
            <span>{formatCurrency(Math.abs(due))}</span>
          </li>
        </ul>
        {(errors.discount || errors.discountReason) && <p className="px-3 pb-2 text-xs text-red-600">{errors.discount ?? errors.discountReason}</p>}
      </div>

      {/* Payment / refund */}
      {due > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-700">
            <span>Payment received</span>
            <span className={collected === due ? 'text-emerald-700' : 'text-orange-700'}>
              {formatCurrency(collected)} of {formatCurrency(due)}
            </span>
          </div>
          <div className="space-y-2">
            {payments.map((p, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <select value={p.mode} onChange={(e) => setPay(i, { mode: e.target.value as PaymentMode })} aria-label="Payment mode" className={`${inputClass} w-28!`}>
                  {PAYMENT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
                <input value={p.amount} onChange={(e) => setPay(i, { amount: e.target.value })} inputMode="decimal" placeholder="₹ Amount" aria-label="Amount" className={`${inputClass} w-32!`} />
                {p.mode !== 'CASH' && (
                  <input value={p.reference} onChange={(e) => setPay(i, { reference: e.target.value })} placeholder="Txn ref." aria-label="Reference" className={`${inputClass} w-40!`} />
                )}
                {payments.length > 1 && (
                  <button type="button" onClick={() => setPayments((rows) => rows.filter((_, j) => j !== i))} aria-label="Remove payment" className="px-2 text-slate-400 hover:text-red-600">
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          {payments.length < 3 && (
            <Button
              variant="link"
              className="mt-2"
              onClick={() => {
                setTouched(true);
                setPayments((rows) => [...rows, { mode: 'UPI', amount: collected < due ? String(roundMoney(due - collected)) : '', reference: '' }]);
              }}
            >
              + Split payment
            </Button>
          )}
          {errors.payments && <p className="mt-1 text-xs text-red-600">{errors.payments}</p>}
        </div>
      )}
      {due < 0 && (
        <Field label={`Refund ${formatCurrency(-due)} by`} error={errors.refund}>
          <select value={refundMode} onChange={(e) => setRefundMode(e.target.value as PaymentMode)} className={`${inputClass} w-40!`}>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* Hand-over */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Collected by" required error={errors.deliveredTo} hint="Customer, or the person collecting for them">
          <input value={deliveredTo} onChange={(e) => setDeliveredTo(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Note">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="e.g. Checked working in front of customer" />
        </Field>
      </div>
      {bill.accessories.length > 0 && (
        <label className="flex items-start gap-2 rounded-md bg-slate-50 p-3 text-sm">
          <input type="checkbox" checked={accessoriesReturned} onChange={(e) => setAccessoriesReturned(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
          <span>
            Accessories returned: <span className="font-medium">{bill.accessories.join(', ')}</span>
            {errors.accessoriesReturned && <span className="block text-xs text-red-600">{errors.accessoriesReturned}</span>}
          </span>
        </label>
      )}
      {errors.imei && <p className="text-sm text-red-600">{errors.imei}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={deliver.isPending} disabled={missingImei}>
          Deliver & create invoice
        </Button>
      </div>
    </form>
  );
}
