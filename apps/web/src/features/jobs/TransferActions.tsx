import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { EngineerWorkloadDto, JobDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { FormActions } from '@/components/ui/FormActions';
import { api } from '@/lib/api-client';

/** Engineer asks a colleague (e.g. senior) to take over the job. */
export function TransferRequestForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ to?: string; reason?: string }>({});
  const engineers = useQuery({
    queryKey: ['engineers', job.branch.id],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers?branchId=${job.branch.id}`),
  });
  const options = (engineers.data ?? []).filter((e) => e.id !== job.assignedEngineer?.id);

  const send = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/transfers`, { toEngineerId: to, reason }),
    onSuccess: () => {
      toast.success('Transfer request sent — the job stays with you until it is accepted');
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const errs = { to: to ? undefined : 'Select an engineer', reason: reason.trim().length >= 3 ? undefined : 'Enter a reason' };
        setErrors(errs);
        if (!errs.to && !errs.reason) send.mutate();
      }}
      className="space-y-4"
    >
      <Field label="Transfer to" required error={errors.to}>
        <select value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
          <option value="">Select engineer</option>
          {options.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} — {e.openJobs} open
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason" required error={errors.reason}>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} placeholder="e.g. Board-level work, needs a senior" />
      </Field>
      <p className="text-xs text-slate-500">The other engineer must accept. Until then the job stays with you.</p>
      <FormActions onCancel={onDone} loading={send.isPending} submitLabel="Send request" />
    </form>
  );
}

/** Accept / reject an incoming transfer (receiving engineer). */
export function TransferResponseButtons({ transferId, onDone }: { transferId: string; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const respond = useMutation({
    mutationFn: (decision: 'ACCEPTED' | 'REJECTED') => api.post(`/jobs/transfers/${transferId}/respond`, { decision, note: note.trim() || null }),
    onSuccess: (_r, decision) => {
      toast.success(decision === 'ACCEPTED' ? 'Job accepted — it is now in your queue' : 'Transfer rejected');
      void queryClient.invalidateQueries();
      onDone?.();
    },
    onError: (err) => toast.error(err.message),
  });

  if (rejecting) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder="Reason for rejecting" className={`${inputClass} w-56! py-1!`} />
        <Button size="sm" variant="danger" disabled={note.trim().length < 2} loading={respond.isPending} onClick={() => respond.mutate('REJECTED')}>
          Reject
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setRejecting(false)}>
          Back
        </Button>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <Button size="sm" loading={respond.isPending} onClick={() => respond.mutate('ACCEPTED')}>
        Accept
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setRejecting(true)}>
        Reject
      </Button>
    </div>
  );
}

export function CancelTransferButton({ transferId }: { transferId: string }) {
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api.post(`/jobs/transfers/${transferId}/cancel`),
    onSuccess: () => {
      toast.success('Transfer request cancelled');
      void queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Button size="sm" variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate()}>
      Cancel request
    </Button>
  );
}
