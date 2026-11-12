import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { JobDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { api, ApiError } from '@/lib/api-client';
import { formatCurrency, formatJobNumber } from '@/lib/format';
import { useJob } from './api';
import { RwrForm } from './HoldAndRwrForms';

type Mode = 'approve' | 'negotiate' | 'reject';

/** CCO / Branch Manager records the customer's answer to an estimate: pick an option, negotiate a price, or reject (RWR). */
export function ApprovalDecisionDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const job = useJob(jobId ?? '', !!jobId);
  return (
    <Modal open={!!jobId} onClose={onClose} title={job.data ? `Customer approval · ${formatJobNumber(job.data.jobNumber)}` : 'Customer approval'} size="md">
      {jobId && (job.data ? <ApprovalDecisionForm key={job.data.id} job={job.data} onDone={onClose} /> : <p className="text-sm text-slate-500">Loading…</p>)}
    </Modal>
  );
}

export function ApprovalDecisionForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const options = job.estimateOptions ?? [];
  const [mode, setMode] = useState<Mode>('approve');
  const [optionId, setOptionId] = useState<string | null>(() => options.find((o) => o.isApproved)?.id ?? options[0]?.id ?? null);
  const baseAmount = optionId ? options.find((o) => o.id === optionId)?.amount ?? job.quotedAmount ?? 0 : job.quotedAmount ?? 0;
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [rwrStep, setRwrStep] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      if (mode === 'reject') return api.post(`/jobs/${job.id}/approval`, { decision: 'REJECTED', note, selectedOptionId: null, amount: null });
      const finalAmount = mode === 'negotiate' ? Number(amount) : baseAmount;
      return api.post(`/jobs/${job.id}/approval`, { decision: 'APPROVED', note, selectedOptionId: optionId, amount: finalAmount });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      if (mode === 'reject') {
        toast.success('Marked as rejected — now record the return without repair');
        setRwrStep(true);
        return;
      }
      toast.success('Approved — sent to engineer for repair');
      onDone();
    },
    onError: (err) => {
      const details = err instanceof ApiError ? (err.details as Record<string, string[]> | undefined) : undefined;
      setError(details ? Object.values(details)[0]?.[0] : err.message);
    },
  });

  if (rwrStep) {
    return (
      <div className="space-y-3">
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">Customer rejected the estimate. Record the RWR now, or close and let the engineer do it.</p>
        <RwrForm job={{ ...job, status: 'CUSTOMER_REJECTED' }} onDone={onDone} />
      </div>
    );
  }

  const submit = () => {
    setError(undefined);
    if (mode === 'negotiate' && !(Number(amount) > 0)) return setError('Enter the negotiated amount');
    if (mode === 'reject' && note.trim().length < 3) return setError("Enter the customer's reason");
    save.mutate();
  };

  const choice = (value: string | null, title: string, sub: string | null, price: number) => (
    <label
      key={value ?? 'default'}
      className={`flex cursor-pointer items-start justify-between gap-3 rounded-md border p-2.5 ${optionId === value ? 'border-brand-600 bg-brand-50/80 ring-1 ring-brand-500' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
    >
      <span className="flex items-start gap-2.5">
        <input type="radio" name="approvalOption" checked={optionId === value} onChange={() => setOptionId(value)} className="mt-0.5 size-4 accent-brand-600" />
        <span>
          <span className="block text-sm font-semibold text-slate-900">{title}</span>
          {sub && <span className="block text-xs text-slate-600">{sub}</span>}
        </span>
      </span>
      <span className="text-sm font-bold">{formatCurrency(price)}</span>
    </label>
  );

  return (
    <form onSubmit={(e) => (e.preventDefault(), submit())} className="space-y-4">
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200 sm:grid-cols-2">
        <div><span className="text-slate-500">Customer:</span> <strong>{job.customer.name}</strong></div>
        <div><span className="text-slate-500">Mobile:</span> <a href={`tel:${job.customer.phone}`} className="font-medium text-brand-600">{job.customer.phone}</a></div>
        <div className="sm:col-span-2"><span className="text-slate-500">Engineer found:</span> {[...job.diagnosisFindings.map((f) => f.label), job.diagnosisNotes].filter(Boolean).join(' · ') || '—'}</div>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
        {([['approve', '✓ Approve'], ['negotiate', '₹ Negotiate'], ['reject', '✕ Reject / RWR']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => (setMode(key), setError(undefined))}
            className={`rounded-md px-2 py-1.5 text-sm font-medium ${mode === key ? (key === 'reject' ? 'bg-red-600 text-white' : 'bg-white text-slate-900 shadow-sm') : 'text-slate-600 hover:text-slate-900'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode !== 'reject' && (
        <div className="space-y-2">
          <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Option the customer chose</div>
          {options.map((o) => choice(o.id, o.title, o.description, o.amount))}
          {choice(null, options.length ? 'Default estimate' : 'Engineer estimate', job.estimateLines.map((l) => l.part?.name ?? l.fault?.name ?? l.description).filter(Boolean).join(', ') || null, job.quotedAmount ?? 0)}
        </div>
      )}

      {mode === 'negotiate' && (
        <Field label="Final negotiated amount (₹)" required hint={`Selected option: ${formatCurrency(baseAmount)}`}>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus className={inputClass} placeholder={String(baseAmount)} />
        </Field>
      )}

      <Field label={mode === 'reject' ? "Customer's reason" : 'Note (optional)'} required={mode === 'reject'}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputClass} placeholder={mode === 'reject' ? 'e.g. Too costly, will buy a new phone' : 'e.g. Approved on call'} />
      </Field>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant={mode === 'reject' ? 'danger' : 'primary'} loading={save.isPending}>
          {mode === 'reject' ? 'Confirm rejection' : `Approve ${formatCurrency(mode === 'negotiate' && Number(amount) > 0 ? Number(amount) : baseAmount)}`}
        </Button>
      </div>
    </form>
  );
}
