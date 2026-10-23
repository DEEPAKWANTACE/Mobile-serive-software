import { BULK_JOB_ACTION_ROLES, type BulkJobActionData, type BulkJobResultDto } from '@msm/shared';
import { HttpError } from '../../lib/http-error.ts';
import type { Actor } from '../../lib/request-context.ts';
import * as service from './jobs.service.ts';
import * as workflow from './workflow.service.ts';

/**
 * Runs one action over many jobs. Each job goes through the same service (and rules) as the single-job
 * action, one at a time, so one failure doesn't block the rest — the result lists what failed and why.
 */
export async function run(data: BulkJobActionData, actor: Actor): Promise<BulkJobResultDto> {
  if (!BULK_JOB_ACTION_ROLES[data.action].includes(actor.role)) throw HttpError.forbidden('Your role cannot run this bulk action');

  const one = (jobId: string): Promise<unknown> => {
    switch (data.action) {
      case 'assign': return service.assign(jobId, data.engineerId, actor);
      case 'unassign': return service.unassign(jobId, data.note, actor);
      case 'status': return workflow.changeStatus(jobId, { status: data.status, note: data.note }, actor);
      case 'cancel': return service.cancel(jobId, { reason: data.reason, refundMode: data.refundMode }, actor);
      case 'delete': return service.remove(jobId, actor);
    }
  };

  const results: BulkJobResultDto['results'] = [];
  for (const jobId of [...new Set(data.jobIds)]) {
    try {
      await one(jobId);
      results.push({ jobId, ok: true });
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      const detail = err.details ? Object.values(err.details as Record<string, string[]>)[0]?.[0] : undefined;
      results.push({ jobId, ok: false, error: detail ?? err.message });
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}
