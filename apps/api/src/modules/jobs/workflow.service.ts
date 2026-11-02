import {
  DIAGNOSABLE_STATUSES,
  ENGINEER_TRANSITIONS,
  JOB_STATUS_LABELS,
  ROLES,
  RWR_STATUSES,
  SPARE_HOLD_STATUSES,
  type ApprovalData,
  type DeadRiskApprovalData,
  type NegotiatedEstimateData,
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
    select: {
      deviceModelId: true,
      estimatedAmount: true,
      approvedAmount: true,
      devices: { select: { deviceModelId: true } },
    },
  });

  // Resolve price options server-side; the client only says which option was picked.
  const priceIds = data.lines.flatMap((l) => (l.priceId ? [l.priceId] : []));
  const faultIds = [...new Set(data.lines.flatMap((l) => (l.faultId ? [l.faultId] : [])))];
  const partIds = [...new Set(data.lines.flatMap((l) => (l.partId ? [l.partId] : [])))];
  const [prices, faultCount, parts, findings] = await Promise.all([
    prisma.servicePrice.findMany({
      where: { id: { in: priceIds } },
      select: { id: true, faultId: true, deviceModelId: true, label: true, price: true },
    }),
    prisma.fault.count({ where: { id: { in: faultIds } } }),
    prisma.part.findMany({ where: { id: { in: partIds }, isActive: true }, select: { id: true, sellingPrice: true } }),
    prisma.diagnosisFinding.findMany({
      where: { id: { in: data.findingIds }, isActive: true },
      select: { id: true, label: true },
    }),
  ]);
  if (parts.length !== partIds.length) throw HttpError.badRequest('Invalid request', { lines: ['Unknown or inactive part in estimate'] });
  const partPrice = new Map(parts.map((p) => [p.id, p.sellingPrice.toNumber()]));
  if (faultCount !== faultIds.length) throw HttpError.badRequest('Invalid request', { lines: ['Unknown fault in estimate'] });
  if (findings.length !== data.findingIds.length) {
    throw HttpError.badRequest('Invalid request', { findingIds: ['One or more diagnosis findings are unknown or inactive'] });
  }
  const priceById = new Map(prices.map((p) => [p.id, p]));
  const validModelIds = new Set([job.deviceModelId, ...job.devices.map((device) => device.deviceModelId)].filter((id): id is string => !!id));

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
    if (!p || !validModelIds.has(p.deviceModelId) || (l.faultId && p.faultId !== l.faultId)) {
      throw HttpError.badRequest('Invalid request', { lines: ['A selected price is not valid for this model'] });
    }
    return { faultId: p.faultId, partId, description: l.description ?? null, priceLabel: p.label, amount: p.price.toNumber(), sortOrder: i };
  });
  const total = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;

  // Every engineer-entered estimate returns to the CCO so the customer's decision is explicit.
  const agreed = job.approvedAmount ?? job.estimatedAmount;
  const status: JobStatus = 'AWAITING_APPROVAL';

  await prisma.$transaction(async (tx) => {
    await moveFrom(tx, id, access.status, {
      diagnosisNotes: data.notes ?? null,
      diagnosedAt: new Date(),
      quotedAmount: total,
      status,
      customerResponse: null,
      approvedAmount: null,
      approvedAt: null,
      approvedById: null,
      deadRiskRequested: data.deadRiskRequested,
      deadRiskNote: data.deadRiskRequested ? data.deadRiskNote : null,
      deadRiskApprovedAt: null,
      deadRiskApprovedById: null,
    }, { actor, remark: `Diagnosed: ${data.notes ?? findings.map((finding) => finding.label).join(', ')}` });
    await tx.jobEstimateLine.deleteMany({ where: { jobId: id } });
    await tx.jobEstimateLine.createMany({ data: lines.map((l) => ({ ...l, jobId: id })) });
    if (data.options && data.options.length > 0) {
      await tx.jobEstimateOption.deleteMany({ where: { jobId: id } });
      await tx.jobEstimateOption.createMany({
        data: data.options.map((opt) => ({
          jobId: id,
          title: opt.title,
          description: opt.description ?? null,
          amount: opt.amount,
        })),
      });
    }
    await tx.jobDiagnosisFinding.deleteMany({ where: { jobId: id } });
    if (findings.length) {
      await tx.jobDiagnosisFinding.createMany({
        data: findings.map((finding) => ({ jobId: id, diagnosisFindingId: finding.id, labelSnapshot: finding.label })),
      });
    }
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.diagnosed',
        entityType: 'job',
        entityId: id,
        branchId: access.branchId,
        metadata: {
          total,
          status,
          autoApproved: false,
          earlierAmount: agreed?.toNumber() ?? null,
          items: lines.length,
          findings: findings.map((finding) => finding.label),
          deadRiskRequested: data.deadRiskRequested,
          deadRiskNote: data.deadRiskNote ?? null,
        },
        ip: actor.ip,
      },
      tx,
    );
  });
  return { status, quotedAmount: total, autoApproved: false };
}

// ─── Customer approval (CCO) ────────────────────────────────────────────────

const APPROVAL_ADJUSTMENT = 'Customer-approved estimate adjustment';

/** Keep delivery billing in sync when an approved/negotiated total differs from quote lines. */
async function syncApprovedTotal(tx: Prisma.TransactionClient, jobId: string, target: number) {
  const lines = await tx.jobEstimateLine.findMany({
    where: { jobId },
    select: { description: true, amount: true, sortOrder: true },
  });
  const baseLines = lines.filter((line) => line.description !== APPROVAL_ADJUSTMENT);
  const base = baseLines.reduce((sum, line) => sum + line.amount.toNumber(), 0);
  const adjustment = Math.round((target - base) * 100) / 100;
  await tx.jobEstimateLine.deleteMany({ where: { jobId, description: APPROVAL_ADJUSTMENT } });
  if (adjustment !== 0) {
    await tx.jobEstimateLine.create({
      data: {
        jobId,
        description: APPROVAL_ADJUSTMENT,
        amount: adjustment,
        sortOrder: Math.max(-1, ...baseLines.map((line) => line.sortOrder)) + 1,
      },
    });
  }
}

export async function decideApproval(id: string, { decision, selectedOptionId, amount, note }: ApprovalData, actor: Actor) {
  const access = await loadForAccess(id, actor);
  if (actor.branchId && actor.branchId !== access.branchId) throw HttpError.forbidden('Only the owning branch can record customer approval');
  if (access.status !== 'AWAITING_APPROVAL') throw notAllowed(access.status);
  const job = await prisma.job.findUniqueOrThrow({
    where: { id },
    select: { quotedAmount: true, estimateOptions: true, deadRiskRequested: true, deadRiskApprovedAt: true },
  });

  const approved = decision === 'APPROVED';
  let finalApprovedAmount = amount ?? job.quotedAmount?.toNumber() ?? null;
  let selectedOptionTitle: string | null = null;
  if (approved && selectedOptionId) {
    const option = job.estimateOptions.find((candidate) => candidate.id === selectedOptionId);
    if (!option) throw HttpError.badRequest('Invalid request', { selectedOptionId: ['Select an estimate option from this job'] });
    if (amount === null || amount === undefined) finalApprovedAmount = option.amount.toNumber();
    selectedOptionTitle = option.title;
  }
  if (approved && finalApprovedAmount === null) {
    throw HttpError.badRequest('Invalid request', { amount: ['Enter the approved amount'] });
  }

  const waitingForDeadRisk = approved && job.deadRiskRequested && !job.deadRiskApprovedAt;
  const status: JobStatus = approved ? (waitingForDeadRisk ? 'AWAITING_APPROVAL' : 'IN_REPAIR') : 'CUSTOMER_REJECTED';
  const approvalNote = [
    selectedOptionTitle ? `Selected: ${selectedOptionTitle}` : null,
    amount !== null && amount !== undefined ? `Negotiated amount: ₹${Number(amount).toFixed(2)}` : null,
    note ?? null,
  ].filter(Boolean).join(' — ') || null;

  await prisma.$transaction(async (tx) => {
    if (approved) {
      await tx.jobEstimateOption.updateMany({ where: { jobId: id }, data: { isApproved: false } });
      if (selectedOptionId) await tx.jobEstimateOption.update({ where: { id: selectedOptionId }, data: { isApproved: true } });
      await syncApprovedTotal(tx, id, finalApprovedAmount!);
    }

    const update = {
      customerResponse: approvalNote,
      ...(approved
        ? { approvedAt: new Date(), approvedById: actor.sub, approvedAmount: finalApprovedAmount!, quotedAmount: finalApprovedAmount! }
        : { approvedAt: null, approvedById: null }),
    } satisfies Prisma.JobUncheckedUpdateManyInput;
    const remark = approved
      ? `Customer approved${approvalNote ? `: ${approvalNote}` : ''}${waitingForDeadRisk ? ' — waiting for separate dead-risk approval' : ''}`
      : `Customer rejected: ${note ?? ''}`;
    if (status === 'AWAITING_APPROVAL') {
      const result = await tx.job.updateMany({ where: { id, status: 'AWAITING_APPROVAL' }, data: update });
      if (!result.count) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    } else {
      await moveFrom(tx, id, 'AWAITING_APPROVAL', { ...update, status }, { actor, remark });
    }
    await recordAudit(
      {
        actorId: actor.sub,
        action: approved ? 'job.approved' : 'job.rejected',
        entityType: 'job',
        entityId: id,
        branchId: access.branchId,
        metadata: { amount: finalApprovedAmount, note: note ?? null, waitingForDeadRisk },
        ip: actor.ip,
      },
      tx,
    );
  });
  return { status, waitingForDeadRisk };
}

/** Separate acknowledgement of the risk of working on a dead device. */
export async function approveDeadRisk(id: string, { note }: DeadRiskApprovalData, actor: Actor) {
  const access = await loadForAccess(id, actor);
  if (actor.branchId && actor.branchId !== access.branchId) throw HttpError.forbidden('Only the owning branch can approve dead-device risk');
  if (access.status !== 'AWAITING_APPROVAL') throw notAllowed(access.status);
  const job = await prisma.job.findUniqueOrThrow({
    where: { id },
    select: { deadRiskRequested: true, deadRiskApprovedAt: true, approvedAt: true, approvedAmount: true },
  });
  if (!job.deadRiskRequested) throw HttpError.conflict('The engineer did not request dead-device risk approval');
  if (job.deadRiskApprovedAt) return { status: access.status, alreadyApproved: true };
  const status: JobStatus = job.approvedAt && job.approvedAmount !== null ? 'IN_REPAIR' : 'AWAITING_APPROVAL';
  const update = { deadRiskApprovedAt: new Date(), deadRiskApprovedById: actor.sub } satisfies Prisma.JobUncheckedUpdateManyInput;
  await prisma.$transaction(async (tx) => {
    if (status === 'IN_REPAIR') {
      await moveFrom(tx, id, 'AWAITING_APPROVAL', { ...update, status }, { actor, remark: `Dead-device risk approved${note ? `: ${note}` : ''}` });
    } else {
      const result = await tx.job.updateMany({ where: { id, status: 'AWAITING_APPROVAL', deadRiskApprovedAt: null }, data: update });
      if (!result.count) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    }
    await recordAudit({
      actorId: actor.sub,
      action: 'job.dead_risk_approved',
      entityType: 'job',
      entityId: id,
      branchId: access.branchId,
      metadata: { note: note ?? null, estimateAlreadyApproved: !!job.approvedAt },
      ip: actor.ip,
    }, tx);
  });
  return { status, alreadyApproved: false };
}

const NEGOTIABLE_STATUSES: readonly JobStatus[] = ['AWAITING_APPROVAL', 'IN_REPAIR', 'SPARE_PENDING', 'REPAIRED', 'TESTING', 'READY_FOR_DELIVERY'];

/** Owning-branch counter staff may change an approved amount after customer negotiation. */
export async function updateNegotiatedEstimate(id: string, { amount, note }: NegotiatedEstimateData, actor: Actor) {
  const access = await loadForAccess(id, actor);
  if (actor.branchId && actor.branchId !== access.branchId) throw HttpError.forbidden('Only the owning branch can change the approved estimate');
  if (!NEGOTIABLE_STATUSES.includes(access.status)) throw notAllowed(access.status);
  const job = await prisma.job.findUniqueOrThrow({
    where: { id },
    select: { approvedAt: true, approvedAmount: true, invoice: { select: { id: true } } },
  });
  if (!job.approvedAt || job.approvedAmount === null) throw HttpError.conflict('The customer must approve an estimate before it can be renegotiated');
  if (job.invoice) throw HttpError.conflict('An invoiced amount cannot be changed');
  const previousAmount = job.approvedAmount.toNumber();
  await prisma.$transaction(async (tx) => {
    await syncApprovedTotal(tx, id, amount);
    const result = await tx.job.updateMany({
      where: { id, status: access.status },
      data: { approvedAmount: amount, quotedAmount: amount, customerResponse: `Negotiated to ₹${amount.toFixed(2)} — ${note}` },
    });
    if (!result.count) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    await recordAudit({
      actorId: actor.sub,
      action: 'job.approved_estimate_changed',
      entityType: 'job',
      entityId: id,
      branchId: access.branchId,
      metadata: { from: previousAmount, to: amount, note },
      ip: actor.ip,
    }, tx);
  });
  return { approvedAmount: amount, quotedAmount: amount };
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
      ...(to === 'READY_FOR_DELIVERY' && { readyAt: new Date(), dueAt: null }),
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

// ─── RWR: return without repair (reason compulsory, motherboard photos optional) ────

export async function returnWithoutRepair(id: string, { reason, note }: RwrData, files: Express.Multer.File[], actor: Actor) {
  const isCounterOrManager =
    actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.BRANCH_MANAGER || actor.role === ROLES.CCO;
  const access = isCounterOrManager ? await loadForAccess(id, actor) : await loadForEngineer(id, actor);
  if (isCounterOrManager) assertBranchAccess(actor, access.currentBranchId);
  if (!RWR_STATUSES.includes(access.status)) throw notAllowed(access.status);
  const prepared = preparePhotos({ RWR: files });

  await withStoredPhotos(prepared, () =>
    prisma.$transaction(async (tx) => {
      await moveFrom(tx, id, access.status, { status: 'RWR_PENDING', rwrReason: reason, rwrNote: note, rwrAt: null, statusBeforeHold: null }, { actor, remark: `RWR requested: ${note}` });
      await createPhotoRows(tx, id, prepared, actor);
      await tx.jobTransfer.updateMany({ where: { jobId: id, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
      await recordAudit(
        {
          actorId: actor.sub,
          action: 'job.rwr_requested',
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
  return { status: 'RWR_PENDING' as const };
}

/** Only the owning branch manager can accept an RWR request and release it for delivery. */
export async function finalizeRwr(id: string, actor: Actor) {
  const isManager = actor.role === ROLES.BRANCH_MANAGER || actor.role === ROLES.SUPER_ADMIN;
  if (!isManager) throw HttpError.forbidden();
  const access = await loadForAccess(id, actor);
  if (actor.role === ROLES.BRANCH_MANAGER && (!actor.branchId || access.branchId !== actor.branchId)) {
    throw HttpError.forbidden('Only this job\'s Branch Manager can finalize RWR');
  }
  if (access.status !== 'RWR_PENDING') throw notAllowed(access.status);
  await prisma.$transaction(async (tx) => {
    await moveFrom(tx, id, 'RWR_PENDING', { status: 'RWR', rwrAt: new Date(), dueAt: null }, { actor, remark: 'RWR finalized by Branch Manager' });
    await recordAudit({ actorId: actor.sub, action: 'job.rwr_finalized', entityType: 'job', entityId: id, branchId: access.branchId, ip: actor.ip }, tx);
  });
  return { status: 'RWR' as const };
}
