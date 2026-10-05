import { JOB_STATUS_LABELS, type JobStatus } from '@msm/shared';

const styles: Record<JobStatus, string> = {
  RECEIVED: 'bg-amber-50 text-amber-700',
  ASSIGNED: 'bg-sky-50 text-sky-700',
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{JOB_STATUS_LABELS[status]}</span>;
}
