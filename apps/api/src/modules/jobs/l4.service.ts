import {
  JOB_STATUS_LABELS,
  L4_RETURNABLE_STATUSES,
  L4_SENDABLE_STATUSES,
  ROLES,
  type JobMovementDto,
  type L4MovementListQuery,
  type SendToL4Data,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { loadForAccess } from './jobs.service.ts';

/**
 * L4 / main-office flow. The owning branch (customer side) never changes; `currentBranchId` + `location` track the phone:
 *   branch ──send──▶ TO_L4 ──receive──▶ at L4 (assign L4 engineer, normal workflow) ──send back──▶ TO_BRANCH ──receive──▶ home
 * Approval calls and delivery stay with the owning branch.
 */

const isCounter = (actor: Actor) =>
  actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.BRANCH_MANAGER || actor.role === ROLES.CCO;

export async function sendToL4(jobId: string, { toBranchId, reason }: SendToL4Data, actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  if (job.location !== 'AT_BRANCH' || job.currentBranchId !== job.branchId) throw HttpError.conflict('The phone is not at its own branch');
  const allowed = job.assignedEngineerId === actor.sub || (isCounter(actor) && (!actor.branchId || actor.branchId === job.branchId));
  if (!allowed) throw HttpError.forbidden('Only the branch or the engineer working on it can send it to L4');
  if (!L4_SENDABLE_STATUSES.includes(job.status)) {
    throw HttpError.conflict(`Cannot send to L4 while the job is "${JOB_STATUS_LABELS[job.status]}"`);
  }
  const target = await prisma.branch.findUnique({ where: { id: toBranchId }, select: { id: true, name: true, code: true, type: true, isActive: true } });
  if (!target || !target.isActive || target.type !== 'MAIN_OFFICE' || target.id === job.branchId) {
    throw HttpError.badRequest('Invalid request', { toBranchId: ['Select an active main office (L4)'] });
  }

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: job.status, location: 'AT_BRANCH', currentBranchId: job.branchId },
      // L4 assigns its own engineer; earlier diagnosis/approval stay on record.
      data: { currentBranchId: target.id, location: 'TO_L4', status: 'RECEIVED', assignedEngineerId: null, assignedAt: null, statusBeforeHold: null },
    });
    if (!count) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    await tx.jobTransfer.updateMany({ where: { jobId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
    await tx.jobPart.updateMany({
      where: { jobId, status: { in: ['REQUESTED', 'NOT_AVAILABLE'] } },
      data: { status: 'CANCELLED', handledById: actor.sub, handledAt: new Date(), note: 'Sent to L4' },
    });
    await tx.jobMovement.create({ data: { jobId, direction: 'TO_L4', fromBranchId: job.branchId, toBranchId: target.id, reason, sentById: actor.sub } });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.sent_to_l4',
        entityType: 'job',
        entityId: jobId,
        branchId: job.branchId,
        metadata: { to: { id: target.id, name: target.name, code: target.code }, reason, fromStatus: job.status },
        ip: actor.ip,
      },
      tx,
    );
  });
}

/** The branch the phone is travelling to confirms it arrived. */
export async function receive(jobId: string, note: string | null | undefined, actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  if (job.location === 'AT_BRANCH') throw HttpError.conflict('The phone is not in transit');
  if (!isCounter(actor) || (actor.branchId && actor.branchId !== job.currentBranchId)) {
    throw HttpError.forbidden('Only the receiving branch can confirm receipt');
  }
  const movement = await prisma.jobMovement.findFirst({ where: { jobId, receivedAt: null }, orderBy: { sentAt: 'desc' }, select: { id: true, direction: true } });

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.job.updateMany({ where: { id: jobId, location: job.location }, data: { location: 'AT_BRANCH' } });
    if (!count) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    if (movement) await tx.jobMovement.update({ where: { id: movement.id }, data: { receivedById: actor.sub, receivedAt: new Date(), receiveNote: note ?? null } });
    await recordAudit(
      {
        actorId: actor.sub,
        action: job.location === 'TO_L4' ? 'job.received_at_l4' : 'job.received_from_l4',
        entityType: 'job',
        entityId: jobId,
        branchId: job.branchId,
        metadata: { note: note ?? null },
        ip: actor.ip,
      },
      tx,
    );
  });
}

/** L4 returns the phone (repaired or RWR) to the owning branch. */
export async function sendBack(jobId: string, note: string | null | undefined, actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  if (job.currentBranchId === job.branchId || job.location !== 'AT_BRANCH') throw HttpError.conflict('The phone is not at the main office');
  const allowed = job.assignedEngineerId === actor.sub || (isCounter(actor) && (!actor.branchId || actor.branchId === job.currentBranchId));
  if (!allowed) throw HttpError.forbidden('Only the main office can send the phone back');
  if (!L4_RETURNABLE_STATUSES.includes(job.status)) {
    throw HttpError.conflict('Send back once the phone is repaired (Ready) or returned without repair (RWR)');
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: job.status, location: 'AT_BRANCH', currentBranchId: job.currentBranchId },
      data: { currentBranchId: job.branchId, location: 'TO_BRANCH' },
    });
    if (!count) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    await tx.jobMovement.create({
      data: { jobId, direction: 'TO_BRANCH', fromBranchId: job.currentBranchId, toBranchId: job.branchId, reason: note ?? null, sentById: actor.sub },
    });
    await recordAudit(
      { actorId: actor.sub, action: 'job.sent_back_from_l4', entityType: 'job', entityId: jobId, branchId: job.branchId, metadata: { status: job.status, note: note ?? null }, ip: actor.ip },
      tx,
    );
  });
}

const movementSelect = {
  id: true,
  direction: true,
  reason: true,
  sentAt: true,
  receivedAt: true,
  receiveNote: true,
  fromBranch: { select: { id: true, code: true, name: true } },
  toBranch: { select: { id: true, code: true, name: true } },
  sentBy: { select: { name: true } },
  receivedBy: { select: { name: true } },
  job: {
    select: {
      id: true,
      jobNumber: true,
      status: true,
      brand: { select: { name: true } },
      deviceModel: { select: { name: true } },
      customer: { select: { name: true } },
    },
  },
} satisfies Prisma.JobMovementSelect;

export async function listMovements(query: L4MovementListQuery, actor: Actor): Promise<JobMovementDto[]> {
  const branch = actor.branchId ?? query.branchId;
  const mine = (field: 'toBranchId' | 'fromBranchId') => (branch ? { [field]: branch } : {});
  const where: Prisma.JobMovementWhereInput =
    query.view === 'incoming'
      ? { receivedAt: null, ...mine('toBranchId') }
      : query.view === 'outgoing'
        ? { receivedAt: null, ...mine('fromBranchId') }
        : branch
          ? { OR: [{ fromBranchId: branch }, { toBranchId: branch }] }
          : {};
  const rows = await prisma.jobMovement.findMany({ where, select: movementSelect, orderBy: { sentAt: 'desc' }, take: 300 });
  return rows.map((m) => ({
    id: m.id,
    direction: m.direction,
    from: m.fromBranch,
    to: m.toBranch,
    reason: m.reason,
    sentBy: m.sentBy.name,
    sentAt: m.sentAt.toISOString(),
    receivedBy: m.receivedBy?.name ?? null,
    receivedAt: m.receivedAt?.toISOString() ?? null,
    receiveNote: m.receiveNote,
    job: {
      id: m.job.id,
      jobNumber: m.job.jobNumber,
      status: m.job.status,
      device: `${m.job.brand.name} ${m.job.deviceModel.name}`,
      customer: m.job.customer.name,
    },
  }));
}
