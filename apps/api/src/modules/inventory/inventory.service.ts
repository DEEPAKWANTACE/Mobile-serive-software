import {
  PART_REQUEST_JOB_STATUSES,
  ROLES,
  SPARE_HOLD_STATUSES,
  STORE_ROLES,
  type JobStatus,
  type MovementListQuery,
  type PartRequestData,
  type PartRequestDto,
  type PartRequestListQuery,
  type StockAdjustmentData,
  type StockListQuery,
  type StockMovementDto,
  type StockReceiptData,
  type StockRowDto,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { assertBranchAccess } from '../../lib/access.ts';
import { HttpError } from '../../lib/http-error.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { loadForAccess } from '../jobs/jobs.service.ts';
import { jobPartSelect, toJobPartDto } from './job-part.ts';
import { applyMovement } from './stock.ts';

/** Branch the store action applies to: own branch for branch staff; Super Admin must say which. */
function storeBranch(actor: Actor, requested?: string | null) {
  if (actor.branchId) return actor.branchId;
  if (!requested) throw HttpError.badRequest('Invalid request', { branchId: ['Select a branch'] });
  return requested;
}

function assertStore(actor: Actor, branchId: string) {
  if (!STORE_ROLES.includes(actor.role)) throw HttpError.forbidden();
  assertBranchAccess(actor, branchId);
}

// ─── Stock ──────────────────────────────────────────────────────────────────

/** Every active part with its quantity at the branch (0 when never stocked). */
export async function stock(query: StockListQuery, actor: Actor) {
  const branchId = storeBranch(actor, query.branchId);
  const where: Prisma.PartWhereInput = {
    isActive: true,
    ...(query.search && { OR: [{ code: contains(query.search) }, { name: contains(query.search) }] }),
  };
  const parts = await prisma.part.findMany({
    where,
    select: {
      id: true,
      code: true,
      name: true,
      reorderLevel: true,
      sellingPrice: true,
      stocks: { where: { branchId }, select: { quantity: true } },
    },
    orderBy: { code: 'asc' },
  });
  let rows: StockRowDto[] = parts.map(({ stocks, sellingPrice, ...p }) => {
    const quantity = stocks[0]?.quantity ?? 0;
    return { part: { ...p, sellingPrice: sellingPrice.toNumber() }, quantity, low: quantity <= p.reorderLevel };
  });
  if (query.lowOnly) rows = rows.filter((r) => r.low);
  const start = (query.page - 1) * query.pageSize;
  return toPage(rows.slice(start, start + query.pageSize), rows.length, query);
}

async function activePart(partId: string) {
  const part = await prisma.part.findUnique({ where: { id: partId }, select: { id: true, code: true, name: true, isActive: true } });
  if (!part || !part.isActive) throw HttpError.badRequest('Invalid request', { partId: ['Select an active part'] });
  return part;
}

export async function receive(data: StockReceiptData, actor: Actor) {
  const branchId = storeBranch(actor, data.branchId);
  assertStore(actor, branchId);
  const part = await activePart(data.partId);
  return prisma.$transaction(async (tx) => {
    const m = await applyMovement(tx, {
      partId: part.id,
      branchId,
      type: 'RECEIPT',
      quantity: data.quantity,
      unitCost: data.unitCost,
      reference: data.reference,
      note: data.note,
      actorId: actor.sub,
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'stock.received',
        entityType: 'part',
        entityId: part.id,
        branchId,
        metadata: { code: part.code, quantity: data.quantity, balanceAfter: m.balanceAfter, reference: data.reference ?? null },
        ip: actor.ip,
      },
      tx,
    );
    return { balance: m.balanceAfter };
  });
}

export async function adjust(data: StockAdjustmentData, actor: Actor) {
  const branchId = storeBranch(actor, data.branchId);
  assertStore(actor, branchId);
  const part = await activePart(data.partId);
  return prisma.$transaction(async (tx) => {
    const m = await applyMovement(tx, {
      partId: part.id,
      branchId,
      type: 'ADJUSTMENT',
      quantity: data.quantity,
      note: data.note,
      actorId: actor.sub,
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'stock.adjusted',
        entityType: 'part',
        entityId: part.id,
        branchId,
        metadata: { code: part.code, quantity: data.quantity, balanceAfter: m.balanceAfter, note: data.note },
        ip: actor.ip,
      },
      tx,
    );
    return { balance: m.balanceAfter };
  });
}

export async function movements(query: MovementListQuery, actor: Actor) {
  const branchId = storeBranch(actor, query.branchId);
  assertStore(actor, branchId);
  const where: Prisma.StockMovementWhereInput = {
    branchId,
    partId: query.partId,
    type: query.type,
    ...(query.search && { part: { OR: [{ code: contains(query.search) }, { name: contains(query.search) }] } }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.stockMovement.findMany({
      where,
      select: {
        id: true,
        type: true,
        quantity: true,
        balanceAfter: true,
        unitCost: true,
        reference: true,
        note: true,
        createdAt: true,
        part: { select: { id: true, code: true, name: true } },
        job: { select: { id: true, jobNumber: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...pageArgs(query),
    }),
    prisma.stockMovement.count({ where }),
  ]);
  const items: StockMovementDto[] = rows.map((r) => ({
    ...r,
    unitCost: r.unitCost?.toNumber() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
  return toPage(items, total, query);
}

// ─── Job parts ──────────────────────────────────────────────────────────────

/** Assigned engineer asks the store for a part by its code. */
export async function requestPart(jobId: string, { code, quantity, note }: PartRequestData, actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  if (job.assignedEngineerId !== actor.sub) throw HttpError.forbidden('Only the assigned engineer can request parts');
  if (!(PART_REQUEST_JOB_STATUSES as readonly string[]).includes(job.status)) {
    throw HttpError.conflict('Parts cannot be requested at this stage of the job');
  }
  const part = await prisma.part.findUnique({ where: { code }, select: { id: true, code: true, name: true, sellingPrice: true, isActive: true } });
  if (!part || !part.isActive) throw HttpError.badRequest('Invalid request', { code: [`No active part with code ${code}`] });

  return prisma.$transaction(async (tx) => {
    const row = await tx.jobPart.create({
      data: { jobId, partId: part.id, quantity, unitPrice: part.sellingPrice, note: note ?? null, requestedById: actor.sub },
      select: jobPartSelect,
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.part_requested',
        entityType: 'job',
        entityId: jobId,
        branchId: job.branchId,
        metadata: { code: part.code, name: part.name, quantity },
        ip: actor.ip,
      },
      tx,
    );
    return toJobPartDto(row);
  });
}

/** Store queue: open requests (requested + not available) or a given status, with current branch stock. */
export async function requests(query: PartRequestListQuery, actor: Actor) {
  const branchId = storeBranch(actor, query.branchId);
  assertStore(actor, branchId);
  const rows = await prisma.jobPart.findMany({
    where: {
      job: { branchId },
      status: query.status === 'open' ? { in: ['REQUESTED', 'NOT_AVAILABLE'] } : query.status,
    },
    select: {
      ...jobPartSelect,
      job: {
        select: {
          id: true,
          jobNumber: true,
          status: true,
          brand: { select: { name: true } },
          deviceModel: { select: { name: true } },
          assignedEngineer: { select: { name: true } },
        },
      },
    },
    orderBy: { requestedAt: 'asc' },
    take: 200,
  });
  const stocks = await prisma.partStock.findMany({
    where: { branchId, partId: { in: [...new Set(rows.map((r) => r.part.id))] } },
    select: { partId: true, quantity: true },
  });
  const qty = new Map(stocks.map((s) => [s.partId, s.quantity]));
  return rows.map(
    ({ job, ...r }): PartRequestDto => ({
      ...toJobPartDto(r),
      job: {
        id: job.id,
        jobNumber: job.jobNumber,
        status: job.status,
        device: `${job.brand.name} ${job.deviceModel.name}`,
        engineer: job.assignedEngineer?.name ?? null,
      },
      stock: qty.get(r.part.id) ?? 0,
    }),
  );
}

async function loadJobPart(id: string) {
  const jp = await prisma.jobPart.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      quantity: true,
      requestedById: true,
      part: { select: { id: true, code: true, name: true } },
      job: { select: { id: true, branchId: true, status: true, statusBeforeHold: true, assignedEngineerId: true } },
    },
  });
  if (!jp) throw HttpError.notFound('Part request not found');
  return jp;
}

async function setStatus(
  tx: Prisma.TransactionClient,
  id: string,
  from: Prisma.EnumJobPartStatusFilter['in'],
  to: 'ISSUED' | 'NOT_AVAILABLE' | 'RETURNED' | 'CANCELLED',
  actor: Actor,
  note?: string | null,
) {
  const { count } = await tx.jobPart.updateMany({
    where: { id, status: { in: from } },
    data: { status: to, handledById: actor.sub, handledAt: new Date(), ...(note && { note }) },
  });
  if (!count) throw HttpError.conflict('This request was just updated by someone else. Refresh and try again.');
}

/** Store hands the part to the engineer. If this was the last missing part of a waiting job, the job resumes. */
export async function issue(id: string, note: string | null | undefined, actor: Actor) {
  const jp = await loadJobPart(id);
  assertStore(actor, jp.job.branchId);
  if (jp.status !== 'REQUESTED' && jp.status !== 'NOT_AVAILABLE') throw HttpError.conflict('This request is already closed');

  return prisma.$transaction(async (tx) => {
    await setStatus(tx, id, ['REQUESTED', 'NOT_AVAILABLE'], 'ISSUED', actor, note);
    const m = await applyMovement(tx, {
      partId: jp.part.id,
      branchId: jp.job.branchId,
      type: 'ISSUE',
      quantity: -jp.quantity,
      jobId: jp.job.id,
      actorId: actor.sub,
    });
    const audit = (action: string, metadata: Prisma.InputJsonValue) =>
      recordAudit({ actorId: actor.sub, action, entityType: 'job', entityId: jp.job.id, branchId: jp.job.branchId, metadata, ip: actor.ip }, tx);
    await audit('job.part_issued', { code: jp.part.code, name: jp.part.name, quantity: jp.quantity, stockAfter: m.balanceAfter });

    let resumed: JobStatus | null = null;
    if (jp.job.status === 'SPARE_PENDING') {
      const stillMissing = await tx.jobPart.count({ where: { jobId: jp.job.id, status: 'NOT_AVAILABLE' } });
      if (!stillMissing) {
        resumed = jp.job.statusBeforeHold ?? 'IN_REPAIR';
        await tx.job.updateMany({ where: { id: jp.job.id, status: 'SPARE_PENDING' }, data: { status: resumed, statusBeforeHold: null } });
        await audit('job.spare_received', { part: `${jp.part.code} – ${jp.part.name}`, resumedTo: resumed, note: 'Issued by store' });
      }
    }
    return { stockAfter: m.balanceAfter, jobResumedTo: resumed };
  });
}

/** Store has none: the job waits as "Spare not available" (if it was being worked on). */
export async function markNotAvailable(id: string, note: string | null | undefined, actor: Actor) {
  const jp = await loadJobPart(id);
  assertStore(actor, jp.job.branchId);
  if (jp.status !== 'REQUESTED') throw HttpError.conflict('Only new requests can be marked not available');

  return prisma.$transaction(async (tx) => {
    await setStatus(tx, id, ['REQUESTED'], 'NOT_AVAILABLE', actor, note);
    const label = `${jp.part.code} – ${jp.part.name}`;
    let held = false;
    if (SPARE_HOLD_STATUSES.includes(jp.job.status)) {
      const { count } = await tx.job.updateMany({
        where: { id: jp.job.id, status: jp.job.status },
        data: { status: 'SPARE_PENDING', sparePart: label, spareRequestedAt: new Date(), statusBeforeHold: jp.job.status },
      });
      held = count > 0;
    }
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.part_not_available',
        entityType: 'job',
        entityId: jp.job.id,
        branchId: jp.job.branchId,
        metadata: { part: label, note: note ?? null, jobOnHold: held },
        ip: actor.ip,
      },
      tx,
    );
    return { jobOnHold: held };
  });
}

/** Unused part comes back from the engineer to stock. */
export async function returnToStock(id: string, note: string | null | undefined, actor: Actor) {
  const jp = await loadJobPart(id);
  assertStore(actor, jp.job.branchId);
  if (jp.status !== 'ISSUED') throw HttpError.conflict('Only issued parts can be returned');

  return prisma.$transaction(async (tx) => {
    await setStatus(tx, id, ['ISSUED'], 'RETURNED', actor, note);
    const m = await applyMovement(tx, {
      partId: jp.part.id,
      branchId: jp.job.branchId,
      type: 'RETURN',
      quantity: jp.quantity,
      jobId: jp.job.id,
      note,
      actorId: actor.sub,
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.part_returned',
        entityType: 'job',
        entityId: jp.job.id,
        branchId: jp.job.branchId,
        metadata: { code: jp.part.code, name: jp.part.name, quantity: jp.quantity, stockAfter: m.balanceAfter },
        ip: actor.ip,
      },
      tx,
    );
    return { stockAfter: m.balanceAfter };
  });
}

/** Withdraw a request that has not been issued (requesting engineer or store). */
export async function cancel(id: string, actor: Actor) {
  const jp = await loadJobPart(id);
  const isStore = STORE_ROLES.includes(actor.role);
  if (isStore) assertBranchAccess(actor, jp.job.branchId);
  else if (!(actor.role === ROLES.ENGINEER && jp.job.assignedEngineerId === actor.sub)) throw HttpError.forbidden();
  if (jp.status !== 'REQUESTED' && jp.status !== 'NOT_AVAILABLE') throw HttpError.conflict('This request is already closed');

  await prisma.$transaction(async (tx) => {
    await setStatus(tx, id, ['REQUESTED', 'NOT_AVAILABLE'], 'CANCELLED', actor);
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.part_cancelled',
        entityType: 'job',
        entityId: jp.job.id,
        branchId: jp.job.branchId,
        metadata: { code: jp.part.code, name: jp.part.name },
        ip: actor.ip,
      },
      tx,
    );
  });
}
