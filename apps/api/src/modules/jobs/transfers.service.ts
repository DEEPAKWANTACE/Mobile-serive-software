import { ROLES, TRANSFERABLE_STATUSES, type TransferDto, type TransferListQuery, type TransferRequestData, type TransferResponseData } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { findBranchEngineer, jobBranchScope, loadForAccess } from './jobs.service.ts';
import { startAssignment } from './history.ts';

/**
 * Engineer-to-engineer transfer. The sender keeps the job until the receiver accepts, so a job can never be
 * dropped on someone without their agreement. Each hand-over records how long the sender held the phone.
 */

const select = {
  id: true,
  reason: true,
  status: true,
  responseNote: true,
  heldSince: true,
  createdAt: true,
  respondedAt: true,
  fromEngineer: { select: { id: true, name: true } },
  toEngineer: { select: { id: true, name: true } },
  job: {
    select: { id: true, jobNumber: true, status: true, brand: { select: { name: true } }, deviceModel: { select: { name: true } } },
  },
} satisfies Prisma.JobTransferSelect;

type Row = Prisma.JobTransferGetPayload<{ select: typeof select }>;

const toDto = (t: Row): TransferDto => ({
  id: t.id,
  job: { id: t.job.id, jobNumber: t.job.jobNumber, status: t.job.status, device: `${t.job.brand.name} ${t.job.deviceModel.name}` },
  from: t.fromEngineer,
  to: t.toEngineer,
  reason: t.reason,
  status: t.status,
  responseNote: t.responseNote,
  heldSince: t.heldSince.toISOString(),
  createdAt: t.createdAt.toISOString(),
  respondedAt: t.respondedAt?.toISOString() ?? null,
});

/** Row-locks the job so concurrent transfer/assignment actions on it are serialised. */
const lockJob = (tx: Prisma.TransactionClient, jobId: string) => tx.$queryRaw`SELECT id FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE`;

export async function list(query: TransferListQuery, actor: Actor) {
  const where: Prisma.JobTransferWhereInput = { status: query.status };
  if (actor.role === ROLES.ENGINEER) {
    if (query.direction === 'incoming') where.toEngineerId = actor.sub;
    else if (query.direction === 'outgoing') where.fromEngineerId = actor.sub;
    else where.OR = [{ toEngineerId: actor.sub }, { fromEngineerId: actor.sub }];
  } else {
    where.job = jobBranchScope(actor);
  }
  const rows = await prisma.jobTransfer.findMany({ where, select, orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map(toDto);
}

export async function request(jobId: string, { toEngineerId, reason, remark }: TransferRequestData, actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  if (job.assignedEngineerId !== actor.sub) throw HttpError.forbidden('Only the engineer holding the job can transfer it');
  if (!TRANSFERABLE_STATUSES.includes(job.status)) throw HttpError.conflict('This job cannot be transferred at its current stage');
  if (toEngineerId === actor.sub) throw HttpError.badRequest('Invalid request', { toEngineerId: ['Choose another engineer'] });
  const to = await findBranchEngineer(job.currentBranchId, toEngineerId);

  return prisma.$transaction(async (tx) => {
    await lockJob(tx, jobId);
    const pending = await tx.jobTransfer.count({ where: { jobId, status: 'PENDING' } });
    if (pending) throw HttpError.conflict('A transfer request is already pending for this job');
    const current = await tx.job.findUniqueOrThrow({ where: { id: jobId }, select: { assignedEngineerId: true, assignedAt: true } });
    if (current.assignedEngineerId !== actor.sub) throw HttpError.conflict('This job is no longer assigned to you');

    const row = await tx.jobTransfer.create({
      data: { jobId, fromEngineerId: actor.sub, toEngineerId: to.id, reason, remark: remark ?? null, heldSince: current.assignedAt ?? new Date() },
      select,
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.transfer_requested',
        entityType: 'job',
        entityId: jobId,
        branchId: job.branchId,
        metadata: { to, reason },
        ip: actor.ip,
      },
      tx,
    );
    return toDto(row);
  });
}

async function loadPending(transferId: string) {
  const t = await prisma.jobTransfer.findUnique({
    where: { id: transferId },
    select: { id: true, jobId: true, status: true, fromEngineerId: true, toEngineerId: true, heldSince: true, job: { select: { branchId: true } } },
  });
  if (!t) throw HttpError.notFound('Transfer request not found');
  if (t.status !== 'PENDING') throw HttpError.conflict('This transfer request was already answered or cancelled');
  return t;
}

export async function respond(transferId: string, { decision, note }: TransferResponseData, actor: Actor) {
  const t = await loadPending(transferId);
  if (t.toEngineerId !== actor.sub) throw HttpError.forbidden('Only the receiving engineer can answer this request');
  const accepted = decision === 'ACCEPTED';
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await lockJob(tx, t.jobId);
    const fresh = await tx.jobTransfer.findUniqueOrThrow({ where: { id: transferId }, select: { status: true } });
    if (fresh.status !== 'PENDING') throw HttpError.conflict('This transfer request was already answered or cancelled');

    if (accepted) {
      const job = await tx.job.findUniqueOrThrow({ where: { id: t.jobId }, select: { assignedEngineerId: true, status: true } });
      if (job.assignedEngineerId !== t.fromEngineerId || !TRANSFERABLE_STATUSES.includes(job.status)) {
        await tx.jobTransfer.update({ where: { id: transferId }, data: { status: 'CANCELLED', respondedAt: now } });
        throw HttpError.conflict('The job has changed since this request was sent; the request was cancelled');
      }
      await tx.job.update({ where: { id: t.jobId }, data: { assignedEngineerId: actor.sub, assignedAt: now } });
      await startAssignment(tx, { jobId: t.jobId, engineerId: actor.sub, byId: t.fromEngineerId, endReason: 'TRANSFERRED', note: 'Transfer accepted' });
    }
    const row = await tx.jobTransfer.update({
      where: { id: transferId },
      data: { status: accepted ? 'ACCEPTED' : 'REJECTED', responseNote: note ?? null, respondedAt: now },
      select,
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: accepted ? 'job.transfer_accepted' : 'job.transfer_rejected',
        entityType: 'job',
        entityId: t.jobId,
        branchId: t.job.branchId,
        metadata: {
          from: row.fromEngineer,
          to: row.toEngineer,
          note: note ?? null,
          heldMinutes: Math.round((now.getTime() - t.heldSince.getTime()) / 60_000),
        },
        ip: actor.ip,
      },
      tx,
    );
    return toDto(row);
  });
}

export async function cancel(transferId: string, actor: Actor) {
  const t = await loadPending(transferId);
  const isManager = actor.role === ROLES.SUPER_ADMIN || (actor.role === ROLES.BRANCH_MANAGER && actor.branchId === t.job.branchId);
  if (t.fromEngineerId !== actor.sub && !isManager) throw HttpError.forbidden();

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.jobTransfer.updateMany({
      where: { id: transferId, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    if (!count) throw HttpError.conflict('This transfer request was already answered or cancelled');
    await recordAudit(
      { actorId: actor.sub, action: 'job.transfer_cancelled', entityType: 'job', entityId: t.jobId, branchId: t.job.branchId, ip: actor.ip },
      tx,
    );
  });
}
