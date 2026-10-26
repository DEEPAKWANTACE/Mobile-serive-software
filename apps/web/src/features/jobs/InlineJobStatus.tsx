import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ENGINEER_TRANSITIONS, JOB_STATUS_LABELS, type JobListItemDto, type JobStatus } from '@msm/shared';
import { api } from '@/lib/api-client';
import { JobStatusBadge } from './JobStatusBadge';

/** Compact, permission-safe status control for engineer job lists. */
export function InlineJobStatus({ job }: { job: JobListItemDto }) {
  const queryClient = useQueryClient();
  const transitions = ENGINEER_TRANSITIONS[job.status] ?? [];
  const save = useMutation({
    mutationFn: ({ status, note }: { status: JobStatus; note?: string }) => api.post(`/jobs/${job.id}/status`, { status, note: note || null }),
    onSuccess: () => {
      toast.success('Job status updated');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (!transitions.length) return <JobStatusBadge status={job.status} />;

  return (
    <select
      aria-label={`Change status for job ${job.jobNumber}`}
      value={job.status}
      disabled={save.isPending}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        const next = transitions.find((transition) => transition.to === event.target.value);
        if (!next) return;
        const note = next.noteRequired ? window.prompt('Reason for this status change')?.trim() : undefined;
        if (next.noteRequired && !note) return;
        save.mutate({ status: next.to, note });
      }}
      className="max-w-52 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none disabled:opacity-60"
    >
      <option value={job.status}>{JOB_STATUS_LABELS[job.status]}</option>
      {transitions.map((transition) => (
        <option key={transition.to} value={transition.to}>{transition.label}</option>
      ))}
    </select>
  );
}
