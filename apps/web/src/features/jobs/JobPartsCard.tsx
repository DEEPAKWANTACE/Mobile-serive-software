import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { JOB_PART_STATUS_LABELS, PART_REQUEST_JOB_STATUSES, ROLES, type JobDto, type JobPartStatus, type PartLookupDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { inputClass } from '@/components/ui/Field';
import { useAuth } from '@/features/auth/auth-context';
import { PartCodeInput } from '@/features/inventory/PartCodeInput';
import { api } from '@/lib/api-client';
import { formatCurrency, formatDateTime } from '@/lib/format';

const statusStyle: Record<JobPartStatus, string> = {
  REQUESTED: 'bg-sky-50 text-sky-700',
  ISSUED: 'bg-emerald-50 text-emerald-700',
  NOT_AVAILABLE: 'bg-red-50 text-red-700',
  RETURNED: 'bg-slate-100 text-slate-600',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

/** Parts requested / used on the job. The assigned engineer requests parts by code. */
export function JobPartsCard({ job }: { job: JobDto }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isEngineer = user?.role === ROLES.ENGINEER && job.assignedEngineer?.id === user.id;
  const canRequest = isEngineer && (PART_REQUEST_JOB_STATUSES as readonly string[]).includes(job.status);
  const [found, setFound] = useState<PartLookupDto | null>(null);
  const [qty, setQty] = useState('1');
  const [inputKey, setInputKey] = useState(0);

  const request = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/parts`, { code: found!.code, quantity: Number(qty) || 1 }),
    onSuccess: () => {
      toast.success(`${found!.code} requested from store`);
      setFound(null);
      setQty('1');
      setInputKey((k) => k + 1);
      void queryClient.invalidateQueries({ queryKey: ['jobs', job.id] });
    },
    onError: (err) => toast.error(err.message),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/inventory/part-requests/${id}/cancel`),
    onSuccess: () => {
      toast.success('Request cancelled');
      void queryClient.invalidateQueries({ queryKey: ['jobs', job.id] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (!job.parts.length && !canRequest) return null;
  const issuedValue = job.parts.filter((p) => p.status === 'ISSUED').reduce((s, p) => s + p.unitPrice * p.quantity, 0);

  return (
    <Card title="Spare parts">
      {canRequest && (
        <div className="mb-4 flex flex-wrap items-start gap-2 rounded-md bg-slate-50 p-3">
          <PartCodeInput key={inputKey} branchId={job.branch.id} onFound={setFound} />
          {found && (
            <>
              <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" aria-label="Quantity" className={`${inputClass} w-16!`} />
              <Button loading={request.isPending} onClick={() => request.mutate()}>
                Request from store
              </Button>
            </>
          )}
        </div>
      )}
      {job.parts.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {job.parts.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-mono font-semibold">{p.part.code}</span> · {p.part.name}
                {p.quantity > 1 && ` × ${p.quantity}`} · {formatCurrency(p.unitPrice * p.quantity)}
                <span className="block text-xs text-slate-500">
                  Requested by {p.requestedBy.name} · {formatDateTime(p.requestedAt)}
                  {p.handledBy && ` · ${JOB_PART_STATUS_LABELS[p.status].toLowerCase()} by ${p.handledBy.name}`}
                  {p.note && ` · “${p.note}”`}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle[p.status]}`}>{JOB_PART_STATUS_LABELS[p.status]}</span>
                {isEngineer && (p.status === 'REQUESTED' || p.status === 'NOT_AVAILABLE') && (
                  <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(p.id)}>
                    Cancel
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No parts requested yet.</p>
      )}
      {issuedValue > 0 && <p className="mt-3 text-sm text-slate-600">Parts issued: {formatCurrency(issuedValue)}</p>}
    </Card>
  );
}
