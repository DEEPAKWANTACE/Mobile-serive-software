import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CALL_OUTCOME_LABELS, CALL_PURPOSE_LABELS, ROLES, type CallLogDto, type JobDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { LogCallForm } from './LogCallForm';

/** Customer call history on the job page (counter roles). */
export function JobCallsCard({ job }: { job: JobDto }) {
  const { user } = useAuth();
  const isCounter = user?.role === ROLES.CCO || user?.role === ROLES.BRANCH_MANAGER || user?.role === ROLES.SUPER_ADMIN;
  const [open, setOpen] = useState(false);
  const calls = useQuery({ queryKey: ['jobs', job.id, 'calls'], queryFn: () => api.get<CallLogDto[]>(`/jobs/${job.id}/calls`), enabled: isCounter });
  if (!isCounter) return null;

  return (
    <Card
      title={`Customer calls (${calls.data?.length ?? 0})`}
      className="h-fit"
      actions={
        job.status !== 'DELIVERED' && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Log call
          </Button>
        )
      }
    >
      {calls.data?.length ? (
        <ul className="space-y-3 text-sm">
          {calls.data.map((c) => (
            <li key={c.id}>
              <div className="font-medium">{CALL_OUTCOME_LABELS[c.outcome]}</div>
              <div className="text-xs text-slate-500">
                {CALL_PURPOSE_LABELS[c.purpose]} · {c.createdBy.name} · {formatDateTime(c.createdAt)}
              </div>
              {c.note && <div className="text-slate-700">“{c.note}”</div>}
              {c.nextFollowUpAt && <div className="text-xs text-orange-700">Follow up: {formatDateTime(c.nextFollowUpAt)}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No calls logged yet.</p>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Log customer call">
        {open && <LogCallForm jobId={job.id} jobNumber={job.jobNumber} status={job.status} customer={job.customer} onDone={() => setOpen(false)} />}
      </Modal>
    </Card>
  );
}
