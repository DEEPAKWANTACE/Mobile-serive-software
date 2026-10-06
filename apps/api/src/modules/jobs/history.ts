import type { AssignmentEndReason, JobStatus, Prisma } from '../../generated/prisma/client.ts';

/**
 * Job history writers. Call them inside the transaction that changes the job so history can never drift from it.
 */

/** Record a status change (no-op if the status did not change). */
export async function recordStatus(
  tx: Prisma.TransactionClient,
  h: { jobId: string; from: JobStatus | null; to: JobStatus; actorId: string | null; remark?: string | null; engineerId?: string | null },
) {
  if (h.from === h.to) return;
  const engineerId =
    h.engineerId !== undefined
      ? h.engineerId
      : ((await tx.job.findUnique({ where: { id: h.jobId }, select: { assignedEngineerId: true } }))?.assignedEngineerId ?? null);
  await tx.jobStatusHistory.create({
    data: { jobId: h.jobId, fromStatus: h.from, toStatus: h.to, engineerId, changedById: h.actorId, remark: h.remark ?? null },
  });
}

/** Close the open assignment period of a job (if any). */
export async function endAssignment(tx: Prisma.TransactionClient, jobId: string, reason: AssignmentEndReason) {
  await tx.jobAssignment.updateMany({ where: { jobId, endedAt: null }, data: { endedAt: new Date(), endReason: reason } });
}

/** Close the current assignment and open a new one for `engineerId`. */
export async function startAssignment(
  tx: Prisma.TransactionClient,
  a: { jobId: string; engineerId: string; byId: string | null; endReason: AssignmentEndReason; note?: string | null },
) {
  await endAssignment(tx, a.jobId, a.endReason);
  await tx.jobAssignment.create({ data: { jobId: a.jobId, engineerId: a.engineerId, assignedById: a.byId, note: a.note ?? null } });
}
