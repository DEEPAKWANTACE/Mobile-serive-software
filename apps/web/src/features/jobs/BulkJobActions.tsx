import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BULK_JOB_ACTION_LABELS,
  BULK_JOB_ACTION_ROLES,
  BULK_JOB_ACTIONS,
  BULK_JOB_MAX,
  ENGINEER_TRANSITIONS,
  JOB_STATUS_LABELS,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  type BulkJobAction,
  type BulkJobActionInput,
  type BulkJobResultDto,
  type EngineerWorkloadDto,
  type JobListItemDto,
  type JobStatus,
  type PaymentMode,
  type Role,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api-client';

/** Statuses a manager can move work into (same rules as the engineer's own buttons). */
const STATUS_TARGETS = [...new Set(Object.values(ENGINEER_TRANSITIONS).flatMap((ts) => ts!.map((t) => t.to)))] as JobStatus[];

export const bulkActionsFor = (role: Role | undefined) => BULK_JOB_ACTIONS.filter((a) => role && BULK_JOB_ACTION_ROLES[a].includes(role));

type Props = {
  role: Role;
  /** Branch whose engineers can be picked (assign). */
  branchId: string | undefined;
  selected: JobListItemDto[];
  onClear: () => void;
};

/** Sticky bar shown above the job list while rows are selected. */
export function BulkJobActions({ role, branchId, selected, onClear }: Props) {
  const [action, setAction] = useState<BulkJobAction | null>(null);
  const actions = bulkActionsFor(role);
  if (!selected.length || !actions.length) return null;
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 ring-1 ring-brand-200">
      <span className="text-sm font-medium text-brand-800">{selected.length} selected</span>
      <button type="button" onClick={onClear} className="text-sm text-slate-600 underline hover:text-slate-900">
        Clear
      </button>
      <div className="ml-auto flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button key={a} size="sm" variant={a === 'delete' ? 'danger' : 'secondary'} onClick={() => setAction(a)}>
            {BULK_JOB_ACTION_LABELS[a]}
          </Button>
        ))}
      </div>
      {action && <BulkDialog action={action} branchId={branchId} selected={selected} onClose={() => setAction(null)} onDone={onClear} />}
    </div>
  );
}

function BulkDialog({ action, branchId, selected, onClose, onDone }: { action: BulkJobAction; branchId: string | undefined; selected: JobListItemDto[]; onClose: () => void; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [engineerId, setEngineerId] = useState('');
  const [status, setStatus] = useState<JobStatus>(STATUS_TARGETS[0]!);
  const [note, setNote] = useState('');
  const [refundMode, setRefundMode] = useState<PaymentMode>('CASH');
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState<BulkJobResultDto | null>(null);

  const engineers = useQuery({
    queryKey: ['engineers', branchId],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers?branchId=${branchId}`),
    enabled: action === 'assign' && !!branchId,
  });

  const jobIds = selected.map((j) => j.id);
  const body = (): BulkJobActionInput => {
    switch (action) {
      case 'assign': return { action, jobIds, engineerId };
      case 'unassign': return { action, jobIds, note: note || null };
      case 'status': return { action, jobIds, status, note: note || null };
      case 'cancel': return { action, jobIds, reason: note, refundMode: selected.some((j) => j.paid > 0) ? refundMode : null };
      case 'delete': return { action, jobIds };
    }
  };
  const run = useMutation({
    mutationFn: () => api.post<BulkJobResultDto>('/jobs/bulk', body()),
    onSuccess: (r) => {
      setResult(r);
      void queryClient.invalidateQueries();
      if (!r.failed) {
        toast.success(`${r.succeeded} job${r.succeeded === 1 ? '' : 's'} updated`);
        onDone();
        onClose();
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const paidCount = selected.filter((j) => j.paid > 0).length;
  const valid =
    selected.length <= BULK_JOB_MAX &&
    (action === 'assign' ? !!engineerId : action === 'cancel' ? note.trim().length >= 3 : action === 'delete' ? confirmText === 'DELETE' : true);
  const jobNo = new Map(selected.map((j) => [j.id, j.jobNumber]));

  return (
    <Modal open onClose={onClose} title={`${BULK_JOB_ACTION_LABELS[action]} — ${selected.length} job${selected.length === 1 ? '' : 's'}`}>
      {result ? (
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-medium text-green-700">{result.succeeded} done</span>
            {' · '}
            <span className="font-medium text-red-700">{result.failed} failed</span>
          </p>
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md bg-red-50 p-3">
            {result.results.filter((r) => !r.ok).map((r) => (
              <li key={r.jobId}>
                <span className="font-mono font-semibold">{jobNo.get(r.jobId)}</span> — {r.error}
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button onClick={() => (onDone(), onClose())}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="max-h-24 overflow-y-auto font-mono text-xs text-slate-600">{selected.map((j) => j.jobNumber).join(', ')}</p>
          {selected.length > BULK_JOB_MAX && <p className="text-red-700">Select at most {BULK_JOB_MAX} jobs at a time.</p>}

          {action === 'assign' && (
            <Field label="Engineer" required hint={branchId ? undefined : 'Filter the list by a branch first'}>
              <select value={engineerId} onChange={(e) => setEngineerId(e.target.value)} className={inputClass} disabled={!branchId}>
                <option value="">Select engineer</option>
                {(engineers.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </Field>
          )}
          {action === 'status' && (
            <>
              <Field label="New status" required hint="Only jobs where this is a valid next step will change">
                <select value={status} onChange={(e) => setStatus(e.target.value as JobStatus)} className={inputClass}>
                  {STATUS_TARGETS.map((s) => (
                    <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Note" hint={status === 'IN_REPAIR' ? 'Required when sending back to repair' : undefined}>
                <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
              </Field>
            </>
          )}
          {action === 'unassign' && (
            <Field label="Note">
              <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="Taken back from engineer" />
            </Field>
          )}
          {action === 'cancel' && (
            <>
              <Field label="Reason" required>
                <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="e.g. Customer took the phone back" />
              </Field>
              {paidCount > 0 && (
                <Field label={`${paidCount} job${paidCount === 1 ? ' has' : 's have'} an advance — refund by`}>
                  <select value={refundMode} onChange={(e) => setRefundMode(e.target.value as PaymentMode)} className={inputClass}>
                    {PAYMENT_MODES.map((m) => <option key={m} value={m}>{PAYMENT_MODE_LABELS[m]}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
          {action === 'delete' && (
            <>
              <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">
                Jobs, photos and history are removed permanently. Jobs with payments, an invoice, issued parts or L4 movements are skipped.
              </p>
              <Field label="Type DELETE to confirm" required>
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={inputClass} />
              </Field>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button variant={action === 'delete' ? 'danger' : 'primary'} disabled={!valid} loading={run.isPending} onClick={() => run.mutate()}>
              {BULK_JOB_ACTION_LABELS[action]}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
