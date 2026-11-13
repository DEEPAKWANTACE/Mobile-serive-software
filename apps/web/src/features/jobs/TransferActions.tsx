import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { L4_SENDABLE_STATUSES, type BranchDto, type EngineerWorkloadDto, type JobDto } from '@msm/shared';
import { useOptions } from '@/lib/crud';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { FormActions } from '@/components/ui/FormActions';
import { api } from '@/lib/api-client';

/** Engineer hands the job to a colleague (who must accept) or sends the phone to the L4 / main office. */
export function TransferRequestForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const engineers = useQuery({
    queryKey: ['engineers', job.branch.id],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers?branchId=${job.branch.id}`),
  });
  const options = (engineers.data ?? []).filter((e) => e.id !== job.assignedEngineer?.id);
  const atHome = job.location === 'AT_BRANCH' && job.currentBranch.id === job.branch.id;
  const canSendL4 = atHome && L4_SENDABLE_STATUSES.includes(job.status);
  const { items: offices } = useOptions<BranchDto>('branches', { type: 'MAIN_OFFICE' }, { enabled: canSendL4 });
  const l4Choices = offices.filter((b) => b.id !== job.branch.id);
  const toL4 = to.startsWith('l4:');

  const send = useMutation({
    mutationFn: () => toL4
      ? api.post(`/jobs/${job.id}/l4/send`, { toBranchId: to.slice(3), reason: reason.trim() || null })
      : api.post(`/jobs/${job.id}/transfers`, { toEngineerId: to, reason: reason.trim() || null }),
    onSuccess: () => {
      toast.success(toL4 ? 'Sent to L4 — the main office must receive it' : 'Transfer request sent — the job stays with you until it is accepted');
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!to) return setError('Select where to transfer the job');
        send.mutate();
      }}
      className="space-y-4"
    >
      <Field label="Transfer to" required error={error}>
        <select value={to} onChange={(e) => (setTo(e.target.value), setError(undefined))} className={inputClass}>
          <option value="">Select engineer or L4</option>
          <optgroup label="Engineers">
            {options.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.openJobs} open
              </option>
            ))}
          </optgroup>
          {canSendL4 && l4Choices.length > 0 && (
            <optgroup label="L4 / main office (for repair)">
              {l4Choices.map((b) => <option key={b.id} value={`l4:${b.id}`}>{b.name} ({b.code})</option>)}
            </optgroup>
          )}
        </select>
      </Field>
      <Field label="Reason" hint="Optional">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} placeholder={toL4 ? 'e.g. Board-level work not possible here' : 'e.g. Board-level work, needs a senior'} />
      </Field>
      <p className="text-xs text-slate-500">
        {toL4
          ? 'The phone goes to the main office and its engineer takes over. Customer calls and delivery stay with this branch.'
          : 'The other engineer must accept. Until then the job stays with you.'}
      </p>
      <FormActions onCancel={onDone} loading={send.isPending} submitLabel={toL4 ? 'Send to L4' : 'Send request'} />
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
