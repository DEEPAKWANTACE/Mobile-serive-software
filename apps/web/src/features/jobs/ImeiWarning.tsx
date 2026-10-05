import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { JOB_STATUS_LABELS, isValidImei, type ImeiCheckDto } from '@msm/shared';
import { api } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

/** Warns when the same IMEI already has an open job, and lists earlier repairs of the phone (all branches). */
export function ImeiWarning({ imei, excludeJobId }: { imei: string | null | undefined; excludeJobId?: string }) {
  const valid = !!imei && isValidImei(imei);
  const { data } = useQuery({
    queryKey: ['imei-check', imei, excludeJobId],
    queryFn: () => api.get<ImeiCheckDto>(`/jobs/imei-check?imei=${imei}${excludeJobId ? `&excludeJobId=${excludeJobId}` : ''}`),
    enabled: valid,
  });
  if (!valid || !data || (!data.open.length && !data.previous.length)) return null;
  return (
    <div className="space-y-1 text-xs">
      {data.open.length > 0 && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          ⚠ This IMEI already has an open job:{' '}
          {data.open.map((j, i) => (
            <span key={j.id}>
              {i > 0 && ', '}
              <Link to={`/jobs/${j.id}`} className="font-mono font-semibold underline">{j.jobNumber}</Link> ({j.branchCode}, {JOB_STATUS_LABELS[j.status]})
            </span>
          ))}
          . Check before creating another job.
        </div>
      )}
      {data.previous.length > 0 && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
          Repaired with us before:{' '}
          {data.previous.map((j, i) => (
            <span key={j.id}>
              {i > 0 && ', '}
              <Link to={`/jobs/${j.id}`} className="font-mono underline">{j.jobNumber}</Link>
              {j.deliveredAt && ` on ${formatDate(j.deliveredAt)}`}
              {j.rwr && ' (not repaired)'}
            </span>
          ))}
          . Possible repeat / warranty complaint.
        </div>
      )}
    </div>
  );
}
