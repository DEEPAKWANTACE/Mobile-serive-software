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
import { CostLinesEditor, rowsFromJob, rowsToLines, rowsTotal, type CostRow } from './CostLinesEditor';

type Mode = 'approve' | 'reject';

/** CCO / Branch Manager records the customer's answer to an estimate: approve with the final costing, or reject (RWR). */
export function ApprovalDecisionDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const job = useJob(jobId ?? '', !!jobId);
  return (
    <Modal open={!!jobId} onClose={onClose} title={job.data ? `Customer approval · ${formatJobNumber(job.data.jobNumber)}` : 'Customer approval'} size="lg">
      {jobId && (job.data ? <ApprovalDecisionForm key={job.data.id + job.dataUpdatedAt} job={job.data} onDone={onClose} /> : <p className="text-sm text-slate-500">Loading…</p>)}
    </Modal>
  );
}

export function ApprovalDecisionForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const options = job.estimateOptions ?? [];
  const [mode, setMode] = useState<Mode>('approve');
  const [rows, setRows] = useState<CostRow[]>(() => rowsFromJob(job));
  const [optionId, setOptionId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const needsDeadRisk = job.deadRiskRequested && !job.deadRiskApprovedAt;
  const [deadRiskOk, setDeadRiskOk] = useState(false);
  const [error, setError] = useState<string>();
  const [rwrStep, setRwrStep] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'reject') return api.post(`/jobs/${job.id}/approval`, { decision: 'REJECTED', note, selectedOptionId: null, amount: null });
      const lines = rowsToLines(rows);
      if (typeof lines === 'string') throw new Error(lines);
      return api.post(`/jobs/${job.id}/approval`, {
        decision: 'APPROVED',
        note,
        selectedOptionId: optionId,
        amount: null,
        lines,
        deadRiskApproved: needsDeadRisk ? deadRiskOk : undefined,
      });
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
    if (mode === 'reject' && note.trim().length < 3) return setError("Enter the customer's reason");
    if (mode === 'approve') {
      const lines = rowsToLines(rows);
      if (typeof lines === 'string') return setError(lines);
      if (needsDeadRisk && !deadRiskOk) return setError('Confirm that the customer accepted the dead-device risk');
    }
    save.mutate();
  };

  const total = rowsTotal(rows);
  const engineerFound = [...job.diagnosisFindings.map((f) => f.label), job.diagnosisNotes].filter(Boolean).join(' · ');

  return (
    <form onSubmit={(e) => (e.preventDefault(), submit())} className="space-y-4">
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200 sm:grid-cols-2">
        <div><span className="text-slate-500">Customer:</span> <strong>{job.customer.name}</strong></div>
        <div><span className="text-slate-500">Mobile:</span> <a href={`tel:${job.customer.phone}`} className="font-medium text-brand-600">{job.customer.phone}</a></div>
        <div className="sm:col-span-2"><span className="text-slate-500">Engineer found:</span> {engineerFound || '—'}</div>
        <div className="sm:col-span-2"><span className="text-slate-500">Engineer estimate:</span> <strong>{formatCurrency(job.quotedAmount ?? 0)}</strong></div>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
        {([['approve', '✓ Approve'], ['reject', '✕ Reject / RWR']] as const).map(([key, label]) => (
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

      {mode === 'approve' && (
        <>
          {options.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Option the customer chose</div>
              {options.map((o) => (
                <label key={o.id} className={`flex cursor-pointer items-start justify-between gap-3 rounded-md border p-2 text-sm ${optionId === o.id ? 'border-brand-600 bg-brand-50/80' : 'border-slate-200 bg-white'}`}>
                  <span className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="approvalOption"
                      checked={optionId === o.id}
                      onChange={() => {
                        setOptionId(o.id);
                        setRows([{ key: o.id, description: o.title, partId: null, partCode: null, partName: null, warranty: '', amount: String(o.amount) }]);
                      }}
                      className="mt-0.5 size-4 accent-brand-600"
                    />
                    <span><span className="font-semibold">{o.title}</span>{o.description && <span className="block text-xs text-slate-600">{o.description}</span>}</span>
                  </span>
                  <span className="font-bold">{formatCurrency(o.amount)}</span>
                </label>
              ))}
            </div>
          )}
          <div>
            <div className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">Final costing agreed with the customer</div>
            <CostLinesEditor branchId={job.currentBranch.id} rows={rows} onChange={setRows} defaultWarranty={job.warrantyPeriod} />
          </div>
          {needsDeadRisk && (
            <label className="flex items-start gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-950 ring-1 ring-red-200">
              <input type="checkbox" checked={deadRiskOk} onChange={(e) => setDeadRiskOk(e.target.checked)} className="mt-0.5 size-4 accent-red-600" />
              <span>
                <strong>Dead-device risk:</strong> {job.deadRiskNote || 'Working on this device could worsen its condition.'}
                <span className="block text-xs">I explained this risk and the customer accepted it.</span>
              </span>
            </label>
          )}
        </>
      )}

      <Field label={mode === 'reject' ? "Customer's reason" : 'Note (optional)'} required={mode === 'reject'}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputClass} placeholder={mode === 'reject' ? 'e.g. Too costly, will buy a new phone' : 'e.g. Approved on call'} />
      </Field>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant={mode === 'reject' ? 'danger' : 'primary'} loading={save.isPending}>
          {mode === 'reject' ? 'Confirm rejection' : `Approve ${formatCurrency(total)}`}
        </Button>
      </div>
    </form>
  );
}
