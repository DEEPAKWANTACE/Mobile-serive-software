import { Modal } from '@/components/ui/Modal';
import { DeliveryForm } from '@/features/billing/DeliveryForm';
import { formatJobNumber } from '@/lib/format';
import { useJob } from './api';

/** Deliver & bill straight from the job list (loads the full job first). */
export function DeliverJobDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const job = useJob(jobId ?? '', !!jobId);
  return (
    <Modal open={!!jobId} onClose={onClose} title={job.data ? `Deliver ${formatJobNumber(job.data.jobNumber)}` : 'Deliver'} size="lg">
      {jobId && (job.data ? <DeliveryForm key={job.data.id} job={job.data} onDone={onClose} /> : <p className="text-sm text-slate-500">Loading…</p>)}
    </Modal>
  );
}
