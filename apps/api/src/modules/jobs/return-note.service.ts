import { MANAGER_ROLES, ROLES, type ReturnNoteDto, type ReturnNoteListQuery } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
import { assertCan } from '../../lib/permissions.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { applyMovement } from '../inventory/stock.ts';
import { loadForAccess } from './jobs.service.ts';
import { publicJobNumber } from './job-number.ts';

/**
 * Return Note: after using parts the engineer states how many were really consumed.
 * Consumption (purchase orders, profit & loss) counts only once the Branch Manager approves; unused pieces go back to stock.
 */

const ELIGIBLE = ['NONE', 'REJECTED'] as const;

export async function submit(jobId: string, lines: { jobPartId: string; usedQuantity: number }[], actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  const isOwner = actor.role === ROLES.ENGINEER && job.assignedEngineerId === actor.sub;
  const isManager = actor.role === ROLES.BRANCH_MANAGER || actor.role === ROLES.SUPER_ADMIN;
  if (!isOwner && !isManager) throw HttpError.forbidden('Only the engineer working on the job can file its Return Note');

  const parts = await prisma.jobPart.findMany({
    where: { jobId, status: 'ISSUED', noteStatus: { in: [...ELIGIBLE] } },
    select: { id: true, quantity: true, part: { select: { code: true } } },
  });
  if (!parts.length) throw HttpError.conflict('There are no issued parts waiting for a Return Note');
  const byId = new Map(lines.map((l) => [l.jobPartId, l.usedQuantity]));
  for (const p of parts) {
    const used = byId.get(p.id);
    if (used === undefined) throw HttpError.badRequest('Invalid request', { lines: [`Enter the used quantity for part ${p.part.code}`] });
    if (used > p.quantity) throw HttpError.badRequest('Invalid request', { lines: [`Part ${p.part.code}: used cannot exceed the ${p.quantity} issued`] });
  }
  await prisma.$transaction(async (tx) => {
    for (const p of parts) {
      await tx.jobPart.update({
        where: { id: p.id },
        data: { noteStatus: 'SUBMITTED', usedQuantity: byId.get(p.id)!, noteRemark: null, noteSubmittedAt: new Date(), noteSubmittedById: actor.sub },
      });
    }
    await recordAudit(
      { actorId: actor.sub, action: 'job.return_note_submitted', entityType: 'job', entityId: jobId, branchId: job.branchId, metadata: { lines: lines.map((l) => ({ ...l })) }, ip: actor.ip },
      tx,
    );
  });
}

const noteSelect = {
  id: true,
  quantity: true,
  usedQuantity: true,
  noteStatus: true,
  noteRemark: true,
  noteSubmittedAt: true,
  part: { select: { code: true, name: true, color: true } },
  job: {
    select: {
      id: true,
      jobNumber: true,
      branchId: true,
      currentBranchId: true,
      jobType: true,
      accessoryName: true,
      manualBrand: true,
      manualModel: true,
      brand: { select: { name: true } },
      deviceModel: { select: { name: true } },
      customer: { select: { name: true } },
      branch: { select: { code: true } },
      assignedEngineer: { select: { name: true } },
    },
  },
} satisfies Prisma.JobPartSelect;

function managerScope(actor: Actor, requested?: string) {
  if (!MANAGER_ROLES.includes(actor.role)) throw HttpError.forbidden();
  return actor.branchId ?? requested;
}

export async function list(query: ReturnNoteListQuery, actor: Actor): Promise<ReturnNoteDto[]> {
  const branchId = managerScope(actor, query.branchId);
  const rows = await prisma.jobPart.findMany({
    where: { status: 'ISSUED', noteStatus: query.status, ...(branchId && { job: { OR: [{ branchId }, { currentBranchId: branchId }] } }) },
    select: noteSelect,
    orderBy: { noteSubmittedAt: 'desc' },
    take: 1000,
  });
  const jobs = new Map<string, ReturnNoteDto>();
  for (const r of rows) {
    const j = r.job;
    const cur =
      jobs.get(j.id) ??
      ({
        jobId: j.id,
        jobNumber: publicJobNumber(j.jobNumber),
        customer: j.customer.name,
        device: j.jobType === 'ACCESSORY' ? (j.accessoryName ?? 'Accessory') : [j.brand?.name ?? j.manualBrand, j.deviceModel?.name ?? j.manualModel].filter(Boolean).join(' ') || 'Mobile',
        engineer: j.assignedEngineer?.name ?? null,
        branchCode: j.branch.code,
        status: query.status,
        submittedAt: r.noteSubmittedAt?.toISOString() ?? null,
        remark: r.noteRemark,
        lines: [],
      } satisfies ReturnNoteDto);
    cur.lines.push({ jobPartId: r.id, code: r.part.code, name: r.part.name, color: r.part.color, quantity: r.quantity, usedQuantity: r.usedQuantity });
    jobs.set(j.id, cur);
  }
  return [...jobs.values()];
}

/** Approve (unused pieces return to stock) or reject (engineer files again) all submitted lines of a job. */
export async function decide(jobId: string, approve: boolean, remark: string | undefined, actor: Actor) {
  managerScope(actor);
  await assertCan(actor, 'approve_return_note');
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, jobNumber: true, branchId: true, currentBranchId: true } });
  if (!job) throw HttpError.notFound('Job not found');
  if (actor.branchId && actor.branchId !== job.branchId && actor.branchId !== job.currentBranchId) throw HttpError.forbidden();

  await prisma.$transaction(async (tx) => {
    const parts = await tx.jobPart.findMany({ where: { jobId, status: 'ISSUED', noteStatus: 'SUBMITTED' }, select: { id: true, partId: true, quantity: true, usedQuantity: true } });
    if (!parts.length) throw HttpError.conflict('This Return Note was already decided');
    for (const p of parts) {
      const { count } = await tx.jobPart.updateMany({
        where: { id: p.id, noteStatus: 'SUBMITTED' },
        data: { noteStatus: approve ? 'APPROVED' : 'REJECTED', noteRemark: remark ?? null, noteDecidedAt: new Date(), noteDecidedById: actor.sub },
      });
      if (!count) throw HttpError.conflict('This Return Note was just decided by someone else');
      const unused = p.quantity - (p.usedQuantity ?? p.quantity);
      if (approve && unused > 0) {
        const issued = await tx.stockMovement.findFirst({ where: { jobId, partId: p.partId, type: 'ISSUE' }, orderBy: { createdAt: 'desc' }, select: { branchId: true } });
        await applyMovement(tx, {
          partId: p.partId,
          branchId: issued?.branchId ?? job.currentBranchId,
          type: 'RETURN',
          quantity: unused,
          jobId,
          reference: `Return note ${publicJobNumber(job.jobNumber)}`,
          note: 'Issued but not used',
          actorId: actor.sub,
        });
      }
    }
    await recordAudit(
      { actorId: actor.sub, action: approve ? 'job.return_note_approved' : 'job.return_note_rejected', entityType: 'job', entityId: jobId, branchId: job.branchId, metadata: { remark: remark ?? null, lines: parts.length }, ip: actor.ip },
      tx,
    );
  });
}
