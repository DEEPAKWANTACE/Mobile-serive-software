import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ROLES, type JobDto, type JobStatus } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/auth-context';
import { PartStockPicker } from '@/features/inventory/PartStockPicker';
import { api } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format';

/** Mirrors the API: the bill can change until delivery (not for RWR). */
const COSTING_STATUSES: readonly JobStatus[] = [
  'RECEIVED', 'ASSIGNED', 'AWAITING_APPROVAL', 'IN_REPAIR', 'SPARE_PENDING', 'REPAIRED', 'TESTING', 'READY_FOR_DELIVERY', 'CUSTOMER_REJECTED',
];

/** Parts used on the job, taken from branch stock by the engineer or the counter. Shown first in Repair work. */
export function StockPartsCard({ job }: { job: JobDto }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const isAssignedEngineer = user?.role === ROLES.ENGINEER && job.assignedEngineer?.id === user.id;
  const isCounter = (user?.role === ROLES.CCO || user?.role === ROLES.BRANCH_MANAGER)
    && (!user.branch || user.branch.id === job.branch.id || user.branch.id === job.currentBranch.id);
  const canEdit = (isAssignedEngineer || isCounter) && COSTING_STATUSES.includes(job.status) && !job.invoice;
  const partLines = job.estimateLines.filter((l) => l.part);

  const done = (msg: string) => {
    toast.success(msg);
    void queryClient.invalidateQueries();
  };
  const add = useMutation({
    mutationFn: (partId: string) => api.post(`/jobs/${job.id}/stock-parts`, { partId }),
    onSuccess: () => {
      setPicking(false);
      done('Part added — stock reduced');
    },
    onError: (err) => toast.error(err.message),
  });
  const remove = useMutation({
    mutationFn: (lineId: string) => api.delete(`/jobs/${job.id}/stock-parts/${lineId}`),
    onSuccess: () => done('Part removed — returned to stock'),
    onError: (err) => toast.error(err.message),
  });

  if (!canEdit && !partLines.length) return null;
  return (
    <Card
      title="Spare parts used"
      subtitle="Picked from branch stock · priced from the parts master"
      actions={canEdit && <Button size="sm" onClick={() => setPicking(true)}>+ Add part from stock</Button>}
    >
      {partLines.length ? (
        <ul className="-my-2 divide-y divide-slate-100 text-sm">
          {partLines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold">{l.part!.code}</span>{' '}
                {l.part!.name}
                {l.warranty && <span className="ml-1 text-xs text-slate-500">· {l.warranty} warranty</span>}
              </span>
              <span className="flex items-center gap-3">
                <span className="font-medium">{formatCurrency(l.amount)}</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove.mutate(l.id)}
                    disabled={remove.isPending}
                    aria-label={`Remove ${l.part!.code}`}
                    className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  >
                    ✕
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No parts used yet. If a part is out of stock, use “Spare not available”.</p>
      )}
      <Modal open={picking} onClose={() => setPicking(false)} title="Add part from stock" size="md">
        {picking && (
          <div className="space-y-2">
            <PartStockPicker branchId={job.currentBranch.id} autoFocus onPick={(p) => add.mutate(p.id)} />
            <p className="text-xs text-slate-500">The part is added to the bill at its selling price and stock goes down right away.</p>
          </div>
        )}
      </Modal>
    </Card>
  );
}
