import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { EngineerWorkloadDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api-client';

type Props = {
  job: { id: string; jobNumber: string; branchId: string; assignedEngineerId: string | null } | null;
  onClose: () => void;
};

/** Pick an engineer for a job, showing each engineer's open workload (least busy first). */
export function AssignEngineerDialog({ job, onClose }: Props) {
  return (
    <Modal open={!!job} onClose={onClose} title={job ? `${job.assignedEngineerId ? 'Reassign' : 'Assign'} ${job.jobNumber}` : ''}>
      {job && <AssignForm job={job} onClose={onClose} />}
    </Modal>
  );
}

function AssignForm({ job, onClose }: { job: NonNullable<Props['job']>; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const engineers = useQuery({
    queryKey: ['engineers', job.branchId],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers?branchId=${job.branchId}`),
  });

  const assign = useMutation({
    mutationFn: (engineerId: string) => api.post<{ assignedEngineer: { name: string } }>(`/jobs/${job.id}/assign`, { engineerId }),
    onSuccess: ({ assignedEngineer }) => {
      toast.success(`${job.jobNumber} assigned to ${assignedEngineer.name}`);
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  if (engineers.isLoading) return <p className="text-sm text-slate-500">Loading engineers…</p>;
  const list = engineers.data ?? [];
  if (!list.length) return <p className="text-sm text-slate-600">No active engineers in this branch. Add one under Staff.</p>;
  const leastBusy = list[0]!.openJobs;

  return (
    <div className="space-y-4">
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {list.map((e) => {
          const current = e.id === job.assignedEngineerId;
          return (
            <label
              key={e.id}
              className={`flex cursor-pointer items-center justify-between rounded-md border px-3 py-2.5 ${selected === e.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'} ${current ? 'opacity-60' : ''}`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="engineer"
                  disabled={current}
                  checked={selected === e.id}
                  onChange={() => setSelected(e.id)}
                  className="accent-brand-600"
                />
                <span className="text-sm font-medium">{e.name}</span>
                {current && <span className="text-xs text-slate-500">(current)</span>}
                {!current && e.openJobs === leastBusy && (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">Least busy</span>
                )}
              </span>
              <span className="text-xs text-slate-500">
                {e.openJobs} open job{e.openJobs === 1 ? '' : 's'}
              </span>
            </label>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!selected} loading={assign.isPending} onClick={() => selected && assign.mutate(selected)}>
          Assign
        </Button>
      </div>
    </div>
  );
}
