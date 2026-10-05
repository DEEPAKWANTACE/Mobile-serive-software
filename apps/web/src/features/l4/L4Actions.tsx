import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { L4_RETURNABLE_STATUSES, L4_SENDABLE_STATUSES, ROLES, type BranchDto, type JobDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { FormActions } from '@/components/ui/FormActions';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/lib/api-client';
import { useOptions } from '@/lib/crud';
import { formatDateTime } from '@/lib/format';

/** Location banner + L4 actions (send / receive / send back) for a job. */
export function L4Panel({ job }: { job: JobDto }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'send' | 'receive' | 'back' | null>(null);
  const isCounter = user?.role === ROLES.SUPER_ADMIN || user?.role === ROLES.BRANCH_MANAGER || user?.role === ROLES.CCO;
  const isAssigned = user?.role === ROLES.ENGINEER && job.assignedEngineer?.id === user.id;
  const myBranch = user?.branch?.id;
  const atHome = job.location === 'AT_BRANCH' && job.currentBranch.id === job.branch.id;
  const atL4 = job.location === 'AT_BRANCH' && job.currentBranch.id !== job.branch.id;

  const canSend = atHome && L4_SENDABLE_STATUSES.includes(job.status) && (isAssigned || (isCounter && (!myBranch || myBranch === job.branch.id)));
  const canReceive = job.location !== 'AT_BRANCH' && isCounter && (!myBranch || myBranch === job.currentBranch.id);
  const canSendBack = atL4 && L4_RETURNABLE_STATUSES.includes(job.status) && (isAssigned || (isCounter && (!myBranch || myBranch === job.currentBranch.id)));

  const done = (msg: string) => {
    toast.success(msg);
    void queryClient.invalidateQueries();
    setDialog(null);
  };

  const banner =
    job.location === 'TO_L4'
      ? { cls: 'bg-violet-50 ring-violet-200 text-violet-900', text: `🚚 In transit to ${job.currentBranch.name} (L4)` }
      : job.location === 'TO_BRANCH'
        ? { cls: 'bg-violet-50 ring-violet-200 text-violet-900', text: `🚚 Returning from L4 to ${job.branch.name}` }
        : atL4
          ? { cls: 'bg-violet-50 ring-violet-200 text-violet-900', text: `🏢 At main office: ${job.currentBranch.name}` }
          : null;

  if (!banner && !canSend) return null;

  return (
    <>
      {banner && (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-md p-3 text-sm ring-1 ${banner.cls}`}>
          <span className="font-medium">{banner.text}</span>
          <span className="flex gap-2">
            {canReceive && <Button size="sm" onClick={() => setDialog('receive')}>Receive phone</Button>}
            {canSendBack && <Button size="sm" onClick={() => setDialog('back')}>Send back to {job.branch.code}</Button>}
          </span>
        </div>
      )}
      {canSend && (
        <Button variant="secondary" onClick={() => setDialog('send')}>
          Send to L4 / main office
        </Button>
      )}
      <Modal open={dialog === 'send'} onClose={() => setDialog(null)} title="Send to main office (L4)" size="sm">
        {dialog === 'send' && <SendForm job={job} onDone={() => done('Sent to L4 — the main office must receive it')} onCancel={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'receive' || dialog === 'back'} onClose={() => setDialog(null)} title={dialog === 'receive' ? 'Receive phone' : `Send back to ${job.branch.name}`} size="sm">
        {(dialog === 'receive' || dialog === 'back') && (
          <NoteForm
            url={`/jobs/${job.id}/l4/${dialog === 'receive' ? 'receive' : 'send-back'}`}
            submitLabel={dialog === 'receive' ? 'Confirm received' : 'Send back'}
            placeholder={dialog === 'receive' ? 'e.g. Received sealed, accessories as listed' : 'e.g. Repaired and tested at L4'}
            onDone={() => done(dialog === 'receive' ? 'Phone received' : 'Sent back — the branch must receive it')}
            onCancel={() => setDialog(null)}
          />
        )}
      </Modal>
    </>
  );
}

function SendForm({ job, onDone, onCancel }: { job: JobDto; onDone: () => void; onCancel: () => void }) {
  const { items: offices } = useOptions<BranchDto>('branches', { type: 'MAIN_OFFICE' });
  const choices = offices.filter((b) => b.id !== job.branch.id);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const send = useMutation({ mutationFn: () => api.post(`/jobs/${job.id}/l4/send`, { toBranchId: to || choices[0]?.id, reason }), onSuccess: onDone, onError: (e) => setError(e.message) });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length < 3) return setError('Why is it going to L4?');
        send.mutate();
      }}
      className="space-y-4"
    >
      <Field label="Main office">
        <select value={to || choices[0]?.id || ''} onChange={(e) => setTo(e.target.value)} className={inputClass}>
          {choices.map((b) => (
            <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
          ))}
        </select>
      </Field>
      <Field label="Reason" required error={error}>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} placeholder="e.g. Board-level work not possible here" />
      </Field>
      <p className="text-xs text-slate-500">The current engineer is released; the main office assigns its own engineer after receiving the phone. Customer calls and delivery stay with this branch.</p>
      <FormActions onCancel={onCancel} loading={send.isPending} submitLabel="Send to L4" />
    </form>
  );
}

function NoteForm({ url, submitLabel, placeholder, onDone, onCancel }: { url: string; submitLabel: string; placeholder: string; onDone: () => void; onCancel: () => void }) {
  const [note, setNote] = useState('');
  const save = useMutation({ mutationFn: () => api.post(url, { note: note || null }), onSuccess: onDone, onError: (e) => toast.error(e.message) });
  return (
    <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="space-y-4">
      <Field label="Note">
        <input value={note} onChange={(e) => setNote(e.target.value)} autoFocus className={inputClass} placeholder={placeholder} />
      </Field>
      <FormActions onCancel={onCancel} loading={save.isPending} submitLabel={submitLabel} />
    </form>
  );
}

export function MovementsCard({ job }: { job: JobDto }) {
  if (!job.movements.length) return null;
  return (
    <section className="rounded-lg bg-white p-5 ring-1 ring-slate-200">
      <h2 className="mb-3 font-semibold">L4 movements</h2>
      <ul className="space-y-2 text-sm">
        {job.movements.map((m) => (
          <li key={m.id}>
            <span className="font-medium">
              {m.from.code} → {m.to.code}
            </span>{' '}
            · sent {formatDateTime(m.sentAt)} by {m.sentBy}
            {m.reason && <span className="text-slate-600"> — “{m.reason}”</span>}
            <div className="text-xs text-slate-500">
              {m.receivedAt ? `Received ${formatDateTime(m.receivedAt)} by ${m.receivedBy}${m.receiveNote ? ` — “${m.receiveNote}”` : ''}` : 'Not received yet'}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
