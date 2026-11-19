import {
  ROLES,
  roundMoney,
  type JobAmountsData,
  type JobLinesData,
  type JobStatus,
  type PartStockOptionDto,
  type RepeatRepairData,
  type StockPartAddData,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
import { contains } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { applyMovement } from '../inventory/stock.ts';
import { recordStatus, startAssignment } from './history.ts';
import { nextJobNumber, publicJobNumber } from './job-number.ts';
import { findBranchEngineer, loadForAccess } from './jobs.service.ts';

/**
 * Job costing: the estimate lines are what the customer is billed. Lines with a part use stock — stock goes down
 * as soon as a part line is saved and comes back when the line is removed.
 */

export type CostLine = {
  description: string | null;
  partId: string | null;
  warranty: string | null;
  amount: number;
  faultId?: string | null;
  priceLabel?: string | null;
};

type JobRef = { id: string; branchId: string; currentBranchId: string };

/** Statuses in which the bill can still change (before delivery, not returned unrepaired). */
const COSTING_STATUSES: readonly JobStatus[] = [
  'RECEIVED', 'ASSIGNED', 'AWAITING_APPROVAL', 'IN_REPAIR', 'SPARE_PENDING', 'REPAIRED', 'TESTING', 'READY_FOR_DELIVERY', 'CUSTOMER_REJECTED',
];

const tally = (ids: (string | null | undefined)[]) => {
  const m = new Map<string, number>();
  for (const id of ids) if (id) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
};

/**
 * Replace all estimate lines of a job, issuing / returning stock for part lines that were added / removed.
 * Must run inside the caller's transaction. Returns the new total.
 */
export async function writeLines(tx: Prisma.TransactionClient, job: JobRef, lines: CostLine[], actor: Actor) {
  const before = await tx.jobEstimateLine.findMany({ where: { jobId: job.id }, select: { partId: true } });
  const oldCount = tally(before.map((l) => l.partId));
  const newCount = tally(lines.map((l) => l.partId));
  const partIds = [...new Set([...oldCount.keys(), ...newCount.keys()])];
  const parts = await tx.part.findMany({
    where: { id: { in: partIds } },
    select: { id: true, code: true, name: true, sellingPrice: true, isActive: true, branchId: true },
  });
  const partById = new Map(parts.map((p) => [p.id, p]));

  for (const partId of partIds) {
    const part = partById.get(partId);
    const delta = (newCount.get(partId) ?? 0) - (oldCount.get(partId) ?? 0);
    if (!part) throw HttpError.badRequest('Invalid request', { lines: ['Unknown part'] });
    const label = `${part.code} ${part.name}`;
    if (delta > 0) {
      if (!part.isActive || (part.branchId && part.branchId !== job.currentBranchId && part.branchId !== job.branchId)) {
        throw HttpError.badRequest('Invalid request', { lines: [`${label} is not available at this branch`] });
      }
      let m;
      try {
        m = await applyMovement(tx, { partId, branchId: job.currentBranchId, type: 'ISSUE', quantity: -delta, jobId: job.id, note: 'Used on job', actorId: actor.sub });
      } catch (err) {
        if (err instanceof HttpError && err.status === 409) {
          throw HttpError.conflict(`Not enough stock of ${label}. Mark "Spare not available" so the store sees the request.`);
        }
        throw err;
      }
      const now = new Date();
      await tx.jobPart.createMany({
        data: Array.from({ length: delta }, () => ({
          jobId: job.id, partId, quantity: 1, unitPrice: part.sellingPrice, status: 'ISSUED' as const,
          requestedById: actor.sub, handledById: actor.sub, handledAt: now, note: 'Used from stock',
        })),
      });
      await recordAudit({
        actorId: actor.sub, action: 'job.part_used', entityType: 'job', entityId: job.id, branchId: job.branchId,
        metadata: { code: part.code, name: part.name, quantity: delta, stockAfter: m.balanceAfter }, ip: actor.ip,
      }, tx);
    } else if (delta < 0) {
      // Only parts this job actually took from stock go back (older lines may never have been issued).
      const issued = await tx.jobPart.findMany({
        where: { jobId: job.id, partId, status: 'ISSUED' },
        select: { id: true },
        orderBy: { requestedAt: 'desc' },
        take: -delta,
      });
      if (!issued.length) continue;
      await tx.jobPart.updateMany({
        where: { id: { in: issued.map((r) => r.id) } },
        data: { status: 'RETURNED', handledById: actor.sub, handledAt: new Date(), note: 'Removed from job costing' },
      });
      const m = await applyMovement(tx, { partId, branchId: job.currentBranchId, type: 'RETURN', quantity: issued.length, jobId: job.id, note: 'Removed from job', actorId: actor.sub });
      await recordAudit({
        actorId: actor.sub, action: 'job.part_returned', entityType: 'job', entityId: job.id, branchId: job.branchId,
        metadata: { code: part.code, name: part.name, quantity: issued.length, stockAfter: m.balanceAfter }, ip: actor.ip,
      }, tx);
    }
  }

  await tx.jobEstimateLine.deleteMany({ where: { jobId: job.id } });
  if (lines.length) {
    await tx.jobEstimateLine.createMany({
      data: lines.map((l, i) => ({
        jobId: job.id,
        partId: l.partId,
        faultId: l.faultId ?? null,
        priceLabel: l.priceLabel ?? null,
        description: l.description || (l.partId ? null : 'Service'),
        warranty: l.warranty,
        amount: l.amount,
        sortOrder: i,
      })),
    });
  }
  return roundMoney(lines.reduce((s, l) => s + l.amount, 0));
}

/** Current lines of a job in the shape `writeLines` takes. */
export async function currentLines(tx: Prisma.TransactionClient, jobId: string): Promise<(CostLine & { id: string })[]> {
  const rows = await tx.jobEstimateLine.findMany({
    where: { jobId },
    select: { id: true, description: true, partId: true, warranty: true, amount: true, faultId: true, priceLabel: true },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((r) => ({ ...r, amount: r.amount.toNumber() }));
}

/** After lines change, keep the job's quoted (and, once approved, approved) amount equal to the bill. */
async function setJobTotal(tx: Prisma.TransactionClient, jobId: string, total: number) {
  const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, select: { approvedAt: true } });
  await tx.job.update({ where: { id: jobId }, data: { quotedAmount: total, ...(job.approvedAt && { approvedAmount: total }) } });
}

const isCounter = (actor: Actor) => actor.role === ROLES.BRANCH_MANAGER || actor.role === ROLES.CCO || actor.role === ROLES.SUPER_ADMIN;

async function loadForCosting(id: string, actor: Actor, { engineerAllowed }: { engineerAllowed: boolean }) {
  const job = await loadForAccess(id, actor);
  const isEngineer = actor.role === ROLES.ENGINEER && job.assignedEngineerId === actor.sub;
  if (isEngineer && !engineerAllowed) throw HttpError.forbidden();
  if (!isEngineer && !(isCounter(actor) && (!actor.branchId || actor.branchId === job.branchId || actor.branchId === job.currentBranchId))) {
    throw HttpError.forbidden('Only the counter of this job or its engineer can change parts');
  }
  if (!COSTING_STATUSES.includes(job.status)) throw HttpError.conflict('The bill of this job can no longer be changed');
  const invoice = await prisma.invoice.count({ where: { jobId: id } });
  if (invoice) throw HttpError.conflict('This job is already invoiced');
  return job;
}

/** CCO edits the costing (add / remove items, change amounts, attach parts and warranty). */
export async function setLines(id: string, data: JobLinesData, actor: Actor) {
  const job = await loadForCosting(id, actor, { engineerAllowed: false });
  const total = await prisma.$transaction(async (tx) => {
    const t = await writeLines(tx, job, data.lines.map((l) => ({ description: l.description ?? null, partId: l.partId ?? null, warranty: l.warranty ?? null, amount: l.amount })), actor);
    await setJobTotal(tx, id, t);
    await recordAudit({ actorId: actor.sub, action: 'job.costing_updated', entityType: 'job', entityId: id, branchId: job.branchId, metadata: { total: t, items: data.lines.length }, ip: actor.ip }, tx);
    return t;
  });
  return { total };
}

/** CCO / manager changes the total and / or the advance received, at any stage before delivery. */
export async function setAmounts(id: string, data: JobAmountsData, actor: Actor) {
  const job = await loadForCosting(id, actor, { engineerAllowed: false });
  if (actor.branchId && actor.branchId !== job.branchId) throw HttpError.forbidden('Only the branch that took in the phone can change its amounts');
  return prisma.$transaction(async (tx) => {
    const metadata: Record<string, unknown> = {};
    if (data.totalAmount !== undefined) {
      const lines = await currentLines(tx, id);
      if (!lines.length) {
        // Not diagnosed / costed yet: this is the intake estimate.
        const cur = await tx.job.findUniqueOrThrow({ where: { id }, select: { estimatedAmount: true, approvedAt: true } });
        await tx.job.update({
          where: { id },
          data: { estimatedAmount: data.totalAmount, ...(cur.approvedAt && data.totalAmount !== null && { approvedAmount: data.totalAmount }) },
        });
        metadata.total = { from: cur.estimatedAmount?.toNumber() ?? null, to: data.totalAmount };
      } else {
        if (data.totalAmount === null) throw HttpError.badRequest('Invalid request', { totalAmount: ['Enter the total amount'] });
        const before = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
        const delta = roundMoney(data.totalAmount - before);
        if (delta !== 0) {
          // Parts keep their price; the difference goes on the (last) repair / service line.
          const idx = lines.map((l) => !l.partId).lastIndexOf(true);
          if (idx >= 0) {
            const next = roundMoney(lines[idx]!.amount + delta);
            if (next < 0) throw HttpError.badRequest('Invalid request', { totalAmount: ['Total cannot be less than the parts on this job'] });
            lines[idx] = { ...lines[idx]!, amount: next };
          } else {
            if (delta < 0) throw HttpError.badRequest('Invalid request', { totalAmount: ['Total cannot be less than the parts on this job'] });
            lines.push({ id: '', description: 'Repair charges', partId: null, warranty: null, amount: delta });
          }
          const total = await writeLines(tx, job, lines.map(({ id: _id, ...l }) => l), actor);
          await setJobTotal(tx, id, total);
        }
        metadata.total = { from: before, to: data.totalAmount };
      }
    }
    if (data.advance !== undefined) {
      const payments = await tx.payment.findMany({ where: { jobId: id, invoiceId: null }, select: { kind: true, amount: true } });
      const paid = roundMoney(payments.reduce((s, p) => s + (p.kind === 'REFUND' ? -1 : 1) * p.amount.toNumber(), 0));
      const delta = roundMoney(data.advance - paid);
      if (delta !== 0) {
        await tx.payment.create({
          data: {
            jobId: id,
            branchId: job.branchId,
            kind: delta > 0 ? 'ADVANCE' : 'REFUND',
            mode: data.mode,
            amount: Math.abs(delta),
            reference: data.reference ?? null,
            receivedById: actor.sub,
          },
        });
      }
      metadata.advance = { from: paid, to: data.advance };
    }
    await recordAudit({ actorId: actor.sub, action: 'job.amounts_updated', entityType: 'job', entityId: id, branchId: job.branchId, metadata: metadata as Prisma.InputJsonValue, ip: actor.ip }, tx);
    return { ok: true };
  });
}

/** Use a part from branch stock on the job (engineer or counter). It is billed at the part's selling price. */
export async function addStockPart(id: string, { partId, warranty }: StockPartAddData, actor: Actor) {
  const job = await loadForCosting(id, actor, { engineerAllowed: true });
  const part = await prisma.part.findUnique({ where: { id: partId }, select: { sellingPrice: true } });
  if (!part) throw HttpError.badRequest('Invalid request', { partId: ['Select a part'] });
  return prisma.$transaction(async (tx) => {
    const lines = await currentLines(tx, id);
    const total = await writeLines(tx, job, [...lines, { description: null, partId, warranty: warranty ?? null, amount: part.sellingPrice.toNumber() }], actor);
    await setJobTotal(tx, id, total);
    return { total };
  });
}

export async function removeStockPart(id: string, lineId: string, actor: Actor) {
  const job = await loadForCosting(id, actor, { engineerAllowed: true });
  return prisma.$transaction(async (tx) => {
    const lines = await currentLines(tx, id);
    const line = lines.find((l) => l.id === lineId);
    if (!line?.partId) throw HttpError.notFound('Part line not found');
    const total = await writeLines(tx, job, lines.filter((l) => l.id !== lineId), actor);
    await setJobTotal(tx, id, total);
    return { total };
  });
}

/** Parts that can be used at the branch, with stock (most stock first). */
export async function partsInStock(query: { search?: string; branchId?: string }, actor: Actor): Promise<PartStockOptionDto[]> {
  const branchId = actor.branchId ?? query.branchId;
  if (!branchId) throw HttpError.badRequest('Invalid request', { branchId: ['Select a branch'] });
  const parts = await prisma.part.findMany({
    where: {
      isActive: true,
      OR: [{ branchId }, { branchId: null }],
      ...(query.search && { AND: [{ OR: [{ code: contains(query.search) }, { name: contains(query.search) }] }] }),
    },
    select: { id: true, code: true, name: true, sellingPrice: true, stocks: { where: { branchId }, select: { quantity: true } } },
    orderBy: { code: 'asc' },
    take: 200,
  });
  return parts
    .map((p) => ({ id: p.id, code: p.code, name: p.name, sellingPrice: p.sellingPrice.toNumber(), stock: p.stocks[0]?.quantity ?? 0 }))
    .sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.code.localeCompare(b.code))
    .slice(0, 50);
}

// ─── Repeat repair ──────────────────────────────────────────────────────────

const faultCopy = { select: { faultId: true, priceLabel: true, price: true } } as const;

/** First of the earlier engineers who is still an active engineer of this branch. */
async function previousEngineer(branchId: string, ids: (string | null)[]) {
  const candidates = [...new Set(ids.filter((v): v is string => !!v))];
  const active = await prisma.user.findMany({
    where: { id: { in: candidates }, role: ROLES.ENGINEER, isActive: true, branchId },
    select: { id: true, name: true },
  });
  const engineer = candidates.map((cid) => active.find((u) => u.id === cid)).find(Boolean);
  if (!engineer) throw HttpError.badRequest('Invalid request', { engineerId: ['The earlier engineer is no longer active here — select an engineer'] });
  return engineer;
}

/** CCO starts a job sheet again: a new linked job for the same customer and device, straight to diagnosis. */
export async function repeatRepair(id: string, data: RepeatRepairData, actor: Actor) {
  if (actor.role !== ROLES.CCO) throw HttpError.forbidden('Only a CCO can start a repeat repair');
  const access = await loadForAccess(id, actor);
  if (actor.branchId && actor.branchId !== access.branchId) throw HttpError.forbidden('Only the branch that took in the phone can repeat it');
  const old = await prisma.job.findUniqueOrThrow({
    where: { id },
    select: {
      jobNumber: true, branchId: true, customerId: true, customerType: true, retailer: true, jobType: true, accessoryName: true,
      brandId: true, deviceModelId: true, manualBrand: true, manualModel: true, manualFault: true, imei: true, imei2: true,
      serialNumber: true, color: true, customerComplaint: true, accessories: true, accessoriesOther: true, conditionNotes: true,
      physicalConditionRemark: true, phoneDamaged: true, warranty: true, devicePasswordEnc: true, warrantyPeriod: true, warrantyTerms: true,
      assignedEngineerId: true,
      assignments: { select: { engineerId: true }, orderBy: { assignedAt: 'desc' } },
      faults: faultCopy,
      devices: {
        select: {
          sortOrder: true, jobType: true, accessoryName: true, brandId: true, deviceModelId: true, manualBrand: true, manualModel: true,
          manualFault: true, imei: true, imei2: true, serialNumber: true, color: true, customerComplaint: true, accessories: true,
          accessoriesOther: true, conditionNotes: true, physicalConditionRemark: true, faults: faultCopy,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: old.branchId }, select: { id: true, code: true } });
  // Same engineer who worked on the earlier job, unless the CCO picked someone else.
  const engineer = data.engineerId
    ? await findBranchEngineer(branch.id, data.engineerId)
    : await previousEngineer(branch.id, [old.assignedEngineerId, ...old.assignments.map((a) => a.engineerId)]);
  const oldNumber = publicJobNumber(old.jobNumber);
  const complaint = [`Repeat repair of ${oldNumber}`, data.note, old.customerComplaint].filter(Boolean).join(' — ').slice(0, 1000);
  const { faults, devices, jobNumber: _n, assignedEngineerId: _a, assignments: _as, ...fields } = old;

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const jobNumber = await nextJobNumber(tx, branch);
    const job = await tx.job.create({
      data: {
        ...fields,
        customerComplaint: complaint,
        jobNumber,
        currentBranchId: branch.id,
        createdById: actor.sub,
        inwardById: actor.sub,
        repeatOfJobId: id,
        status: 'ASSIGNED',
        assignedEngineerId: engineer.id,
        assignedAt: now,
        faults: { create: faults },
        devices: { create: devices.map(({ faults: deviceFaults, ...d }) => ({ ...d, faults: { create: deviceFaults } })) },
      },
      select: { id: true, jobNumber: true },
    });
    await recordStatus(tx, { jobId: job.id, from: null, to: 'ASSIGNED', actorId: actor.sub, engineerId: engineer.id, remark: `Repeat repair of ${oldNumber}` });
    await startAssignment(tx, { jobId: job.id, engineerId: engineer.id, byId: actor.sub, endReason: 'REASSIGNED', note: 'Repeat repair' });
    await recordAudit({ actorId: actor.sub, action: 'job.created', entityType: 'job', entityId: job.id, branchId: branch.id, metadata: { jobNumber, repeatOf: oldNumber, note: data.note ?? null }, ip: actor.ip }, tx);
    await recordAudit({ actorId: actor.sub, action: 'job.assigned', entityType: 'job', entityId: job.id, branchId: branch.id, metadata: { engineer }, ip: actor.ip }, tx);
    await recordAudit({ actorId: actor.sub, action: 'job.repeat_started', entityType: 'job', entityId: id, branchId: branch.id, metadata: { jobNumber: publicJobNumber(jobNumber), note: data.note ?? null }, ip: actor.ip }, tx);
    return { id: job.id, jobNumber: publicJobNumber(job.jobNumber) };
  });
}

