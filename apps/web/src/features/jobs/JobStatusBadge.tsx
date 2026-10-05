import { JOB_STATUS_LABELS, type JobStatus } from '@msm/shared';

const styles: Record<JobStatus, string> = {
  RECEIVED: 'bg-amber-50 text-amber-700',
  ASSIGNED: 'bg-sky-50 text-sky-700',
  AWAITING_APPROVAL: 'bg-orange-100 text-orange-800',
  IN_REPAIR: 'bg-indigo-50 text-indigo-700',
  CUSTOMER_REJECTED: 'bg-red-50 text-red-700',
  REPAIRED: 'bg-teal-50 text-teal-700',
  TESTING: 'bg-violet-50 text-violet-700',
  READY_FOR_DELIVERY: 'bg-emerald-50 text-emerald-700',
  SPARE_PENDING: 'bg-yellow-100 text-yellow-800',
  RWR: 'bg-slate-200 text-slate-700',
  DELIVERED: 'bg-slate-800 text-white',
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${styles[status]}`}>
      {JOB_STATUS_LABELS[status]}
    </span>
  );
}
