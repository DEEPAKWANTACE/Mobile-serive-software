import {
  DIAGNOSABLE_STATUSES,
  ENGINEER_TRANSITIONS,
  JOB_STATUS_LABELS,
  ROLES,
  RWR_MIN_PHOTOS,
  RWR_STATUSES,
  SPARE_HOLD_STATUSES,
  type ApprovalData,
  type RwrData,
  type SpareHoldData,
  type DiagnosisData,
  type JobStatus,
  type StatusChangeData,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { assertBranchAccess } from '../../lib/access.ts';
import { createPhotoRows, loadForAccess, preparePhotos, withStoredPhotos } from './jobs.service.ts';
import { recordStatus } from './history.ts';

/**
 * Job workflow after assignment:
 *   ASSIGNED → (diagnosis) → AWAITING_APPROVAL → (CCO approves) → IN_REPAIR → REPAIRED → TESTING → READY_FOR_DELIVERY
 *                                    └→ (customer rejects) → CUSTOMER_REJECTED
 * A diagnosis within the amount the customer already agreed (intake estimate or earlier approval) skips approval.
 */

const notAllowed = (status: JobStatus) =>
  HttpError.conflict(`Not allowed while the job is "${JOB_STATUS_LABELS[status]}". Refresh and try again.`);

/**
 * Moves the job only if it is still in `from` (guards against concurrent changes) and writes the status history.
 */
async function moveFrom(
  tx: Prisma.TransactionClient,
  id: string,
  from: JobStatus,
  data: Prisma.JobUncheckedUpdateManyInput,
  ctx: { actor: Actor; remark?: string | null },
) {
  const { count } = await tx.job.updateMany({ where: { id, status: from }, data });
  if (count === 0) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
  if (typeof data.status === 'string') {
    await recordStatus(tx, { jobId: id, from, to: data.status as JobStatus, actorId: ctx.actor.sub, remark: ctx.remark });
  }
}

async function loadForEngineer(id: string, actor: Actor) {
  const job = await loadForAccess(id, actor);
  if (job.assignedEngineerId !== actor.sub) throw HttpError.forbidden('Only the assigned engineer can do this');
  return job;
}

// ─── Diagnosis / quote ──────────────────────────────────────────────────────

export async function diagnose(id: string, data: DiagnosisData, actor: Actor) {
  const access = await loadForEngineer(id, actor);
  if (!DIAGNOSABLE_STATUSES.includes(access.status)) throw notAllowed(access.status);

  const job = await prisma.job.findUniqueOrThrow({
    where: { id },
    select: { deviceModelId: true, estimatedAmount: true, approvedAmount: true },
  });

  // Resolve price options server-side; the client only says which option was picked.
  const priceIds = data.lines.flatMap((l) => (l.priceId ? [l.priceId] : []));
  const faultIds = [...new Set(data.lines.flatMap((l) => (l.faultId ? [l.faultId] : [])))];
  const partIds = [...new Set(data.lines.flatMap((l) => (l.partId ? [l.partId] : [])))];
  const [prices, faultCount, parts] = await Promise.all([
    prisma.servicePrice.findMany({
      where: { id: { in: priceIds } },
      select: { id: true, faultId: true, deviceModelId: true, label: true, price: true },
    }),
    prisma.fault.count({ where: { id: { in: faultIds } } }),
    prisma.part.findMany({ where: { id: { in: partIds }, isActive: true }, select: { id: true, sellingPrice: true } }),
  ]);
  if (parts.length !== partIds.length) throw HttpError.badRequest('Invalid request', { lines: ['Unknown or inactive part in estimate'] });
  const partPrice = new Map(parts.map((p) => [p.id, p.sellingPrice.toNumber()]));
  if (faultCount !== faultIds.length) throw HttpError.badRequest('Invalid request', { lines: ['Unknown fault in estimate'] });
  const priceById = new Map(prices.map((p) => [p.id, p]));

  const lines = data.lines.map((l, i) => {
    const partId = l.partId ?? null;
    // A part line is charged at the part's selling price ("enter code → amount comes").
    if (partId && !l.priceId) {
      return { faultId: l.faultId ?? null, partId, description: l.description ?? null, priceLabel: null, amount: partPrice.get(partId)!, sortOrder: i };
    }
    if (!l.priceId) {
      return { faultId: l.faultId ?? null, partId, description: l.description ?? null, priceLabel: null, amount: l.amount!, sortOrder: i };
    }
    const p = priceById.get(l.priceId);
    if (!p || p.deviceModelId !== job.deviceModelId || (l.faultId && p.faultId !== l.faultId)) {
      throw HttpError.badRequest('Invalid request', { lines: ['A selected price is not valid for this model'] });
    }
    return { faultId: p.faultId, partId, description: l.description ?? null, priceLabel: p.label, amount: p.price.toNumber(), sortOrder: i };
  });
  const total = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;

  // The customer already agreed to the intake estimate (or an earlier approval); no call needed within it.
  const agreed = job.approvedAmount ?? job.estimatedAmount;
  const withinAgreed = agreed !== null && total <= agreed.toNumber();
  const status: JobStatus = withinAgreed ? 'IN_REPAIR' : 'AWAITING_APPROVAL';

  await prisma.$transaction(async (tx) => {
    await moveFrom(tx, id, access.status, {
      diagnosisNotes: data.notes,
      diagnosedAt: new Date(),
      quotedAmount: total,
      status,
      ...(withinAgreed
        ? { approvedAmount: agreed }
        : { customerResponse: null }),
    }, { actor, remark: withinAgreed ? `Diagnosed: ${data.notes} (within agreed amount)` : `Diagnosed: ${data.notes}` });
    await tx.jobEstimateLine.deleteMany({ where: { jobId: id } });
    await tx.jobEstimateLine.createMany({ data: lines.map((l) => ({ ...l, jobId: id })) });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.diagnosed',
        entityType: 'job',
        entityId: id,
        branchId: access.branchId,
        metadata: { total, status, autoApproved: withinAgreed, agreedAmount: agreed?.toNumber() ?? null, items: lines.length },
        ip: actor.ip,
      },
      tx,
    );
  });
  return { status, quotedAmount: total, autoApproved: withinAgreed };
}

// ─── Customer approval (CCO) ────────────────────────────────────────────────

export async function decideApproval(id: string, { decision, note }: ApprovalData, actor: Actor) {
  const access = await loadForAccess(id, actor);
  if (access.status !== 'AWAITING_APPROVAL') throw notAllowed(access.status);
  const { quotedAmount } = await prisma.job.findUniqueOrThrow({ where: { id }, select: { quotedAmount: true } });

  const approved = decision === 'APPROVED';
  const status: JobStatus = approved ? 'IN_REPAIR' : 'CUSTOMER_REJECTED';
  await prisma.$transaction(async (tx) => {
    await moveFrom(tx, id, 'AWAITING_APPROVAL', {
      status,
      customerResponse: note ?? null,
      approvedAt: new Date(),
      approvedById: actor.sub,
      ...(approved && { approvedAmount: quotedAmount }),
    }, { actor, remark: approved ? `Customer approved${note ? `: ${note}` : ''}` : `Customer rejected: ${note ?? ''}` });
    await recordAudit(
      {
        actorId: actor.sub,
        action: approved ? 'job.approved' : 'job.rejected',
        entityType: 'job',
        entityId: id,
        branchId: access.branchId,
        metadata: { amount: quotedAmount?.toNumber() ?? null, note: note ?? null },
        ip: actor.ip,
      },
      tx,
    );
  });
  return { status };
}

// ─── Engineer work progress ─────────────────────────────────────────────────

export async function changeStatus(id: string, { status: to, note }: StatusChangeData, actor: Actor) {
  // The assigned engineer moves work forward; an Admin / Branch Manager may do the same on their behalf.
  const isManager = actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.BRANCH_MANAGER;
  const access = isManager ? await loadForAccess(id, actor) : await loadForEngineer(id, actor);
  if (isManager && actor.branchId && actor.branchId !== access.currentBranchId) throw HttpError.forbidden();
  const transition = ENGINEER_TRANSITIONS[access.status]?.find((t) => t.to === to);
  if (!transition) throw notAllowed(access.status);
  if (transition.noteRequired && !note) throw HttpError.badRequest('Invalid request', { note: ['Enter a reason'] });

  // A note given when starting / finishing testing is the testing remark; one given on "done" is the repair remark.
  const testingNote = note && (to === 'TESTING' || access.status === 'TESTING');
  const repairNote = note && !testingNote && to === 'REPAIRED';

  await prisma.$transaction(async (tx) => {
    await moveFrom(tx, id, access.status, {
      status: to,
      ...(to === 'REPAIRED' && { repairedAt: new Date() }),
      ...(to === 'READY_FOR_DELIVERY' && { readyAt: new Date() }),
      ...(to === 'TESTING' && { testingAt: new Date() }),
      ...(testingNote && { testingRemark: note }),
      ...(repairNote && { repairRemark: note }),
    }, { actor, remark: note ?? null });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.status_changed',
        entityType: 'job',
        entityId: id,
        branchId: access.branchId,
        metadata: { from: access.status, to, note: note ?? null },
        ip: actor.ip,
      },
      tx,
    );
  });
  return { status: to };
}

// ─── Spare not available ────────────────────────────────────────────────────

export async function spareHold(id: string, { part, note }: SpareHoldData, actor: Actor) {
  const access = await loadForEngineer(id, actor);
  if (!SPARE_HOLD_STATUSES.includes(access.status)) throw notAllowed(access.status);

  await prisma.$transaction(async (tx) => {
    await moveFrom(tx, id, access.status, {
      status: 'SPARE_PENDING',
      sparePart: part,
      spareRequestedAt: new Date(),
      statusBeforeHold: access.status,
    }, { actor, remark: `Spare not available: ${part}${note ? ` — ${note}` : ''}` });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.spare_hold',
        entityType: 'job',
        entityId: id,
        branchId: access.branchId,
        metadata: { part, note: note ?? null },
        ip: actor.ip,
      },
      tx,
    );
  });
  return { status: 'SPARE_PENDING' as const };
}

/** Part arrived: resume the job where it was. Assigned engineer, or a manager of the branch. */
export async function spareReceived(id: string, note: string | null | undefined, actor: Actor) {
  const access = await loadForAccess(id, actor);
  const isManager = actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.BRANCH_MANAGER;
  if (access.assignedEngineerId !== actor.sub && !isManager) throw HttpError.forbidden();
  if (isManager) assertBranchAccess(actor, access.currentBranchId);
  if (access.status !== 'SPARE_PENDING') throw notAllowed(access.status);

  const job = await prisma.job.findUniqueOrThrow({
    where: { id },
    select: { statusBeforeHold: true, sparePart: true, spareRequestedAt: true },
  });
  const resume: JobStatus = job.statusBeforeHold ?? 'IN_REPAIR';
  await prisma.$transaction(async (tx) => {
    await moveFrom(tx, id, 'SPARE_PENDING', { status: resume, statusBeforeHold: null }, { actor, remark: `Spare received${note ? `: ${note}` : ''}` });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.spare_received',
        entityType: 'job',
        entityId: id,
        branchId: access.branchId,
        metadata: {
          part: job.sparePart,
          resumedTo: resume,
          note: note ?? null,
          waitedMinutes: job.spareRequestedAt ? Math.round((Date.now() - job.spareRequestedAt.getTime()) / 60_000) : null,
        },
        ip: actor.ip,
      },
      tx,
    );
  });
  return { status: resume };
}

// ─── RWR: return without repair (reason + motherboard photos compulsory) ────

export async function returnWithoutRepair(id: string, { reason, note }: RwrData, files: Express.Multer.File[], actor: Actor) {
  const access = await loadForEngineer(id, actor);
  if (!RWR_STATUSES.includes(access.status)) throw notAllowed(access.status);
  if (files.length < RWR_MIN_PHOTOS) {
    throw HttpError.badRequest('Invalid request', { photos: ['Motherboard / internal photo is compulsory for RWR'] });
  }
  const prepared = preparePhotos({ RWR: files });

  await withStoredPhotos(prepared, () =>
    prisma.$transaction(async (tx) => {
      await moveFrom(tx, id, access.status, { status: 'RWR', rwrReason: reason, rwrNote: note, rwrAt: new Date(), statusBeforeHold: null }, { actor, remark: note });
      await createPhotoRows(tx, id, prepared, actor);
      await tx.jobTransfer.updateMany({ where: { jobId: id, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
      await recordAudit(
        {
          actorId: actor.sub,
          action: 'job.rwr',
          entityType: 'job',
          entityId: id,
          branchId: access.branchId,
          metadata: { reason, note, from: access.status, photos: prepared.length },
          ip: actor.ip,
        },
        tx,
      );
    }),
  );
  return { status: 'RWR' as const };
}
