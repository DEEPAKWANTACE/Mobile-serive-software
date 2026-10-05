import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CALL_OUTCOME_LABELS, CALL_OUTCOMES, CALL_PURPOSE_LABELS, CALL_PURPOSES, purposeForStatus, type CallOutcome, type CallPurpose, type JobStatus } from '@msm/shared';
import { Field, inputClass } from '@/components/ui/Field';
import { FormActions } from '@/components/ui/FormActions';
import { api } from '@/lib/api-client';

type Props = { jobId: string; jobNumber: string; status: JobStatus; customer: { name: string; phone: string }; onDone: () => void };

const quickDates = [
  { label: 'In 2 hours', at: () => new Date(Date.now() + 2 * 3600_000) },
  { label: 'Tomorrow 11 am', at: () => tomorrowAt(11) },
  { label: 'In 3 days', at: () => new Date(Date.now() + 3 * 86_400_000) },
];
function tomorrowAt(h: number) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, 0, 0, 0);
  return d;
}
/** datetime-local value in the user's local time. */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function LogCallForm({ jobId, jobNumber, status, customer, onDone }: Props) {
  const queryClient = useQueryClient();
  const [purpose, setPurpose] = useState<CallPurpose>(purposeForStatus(status));
  const [outcome, setOutcome] = useState<CallOutcome | ''>('');
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string>();

  const save = useMutation({
    mutationFn: () =>
      api.post(`/jobs/${jobId}/calls`, { purpose, outcome, note: note || null, nextFollowUpAt: next ? new Date(next).toISOString() : null }),
    onSuccess: () => {
      toast.success('Call logged');
      void queryClient.invalidateQueries({ queryKey: ['calling'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs', jobId] });
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!outcome) return setError('Select the call result');
        save.mutate();
      }}
      className="space-y-4"
    >
      <p className="text-sm">
        <span className="font-mono">{jobNumber}</span> ·{' '}
        <a href={`tel:${customer.phone}`} className="font-medium text-brand-600 hover:underline">
          📞 {customer.name} ({customer.phone})
        </a>
      </p>
      <Field label="Purpose">
        <select value={purpose} onChange={(e) => setPurpose(e.target.value as CallPurpose)} className={inputClass}>
          {CALL_PURPOSES.map((p) => (
            <option key={p} value={p}>{CALL_PURPOSE_LABELS[p]}</option>
          ))}
        </select>
      </Field>
      <Field label="Result" required error={error}>
        <div className="grid grid-cols-2 gap-2">
          {CALL_OUTCOMES.map((o) => (
            <label key={o} className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${outcome === o ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 hover:bg-slate-50'}`}>
              <input type="radio" name="outcome" className="sr-only" checked={outcome === o} onChange={() => (setOutcome(o), setError(undefined))} />
              {CALL_OUTCOME_LABELS[o]}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Note">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="e.g. Will come Saturday evening" />
      </Field>
      <Field label="Next follow-up / promised visit">
        <div className="flex flex-wrap gap-2">
          <input type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} className={`${inputClass} w-56!`} />
          {quickDates.map((q) => (
            <button key={q.label} type="button" onClick={() => setNext(toLocalInput(q.at()))} className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
              {q.label}
            </button>
          ))}
        </div>
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Save call" />
    </form>
  );
}
