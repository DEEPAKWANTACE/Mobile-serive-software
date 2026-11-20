import {
  MANAGER_ROLES,
  roundMoney,
  type DiagnosisPendingRowDto,
  type JobStatus,
  type ManagerRangeQuery,
  type PendingJobRowDto,
  type PendingJobsQuery,
  type PoRowDto,
  type ProfitLossDto,
  type ProfitLossRowDto,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { businessRange, businessToday, startOfBusinessDay } from '../../lib/business-date.ts';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { assertCan } from '../../lib/permissions.ts';
import { publicJobNumber } from '../jobs/job-number.ts';

const DAY = 86_400_000;
const CLOSED: JobStatus[] = ['DELIVERED', 'CANCELLED'];

/** Branch managers are pinned to their own branch; Super Admin may pick one (or none = all). */
export function scope(actor: Actor, requested?: string) {
  if (!MANAGER_ROLES.includes(actor.role)) throw HttpError.forbidden();
  return actor.branchId ?? requested;
}

export const atBranch = (branchId?: string): Prisma.JobWhereInput => (branchId ? { OR: [{ branchId }, { currentBranchId: branchId }] } : {});

type DeviceInfo = {
  brand: { name: string } | null;
  deviceModel: { name: string } | null;
  manualBrand: string | null;
  manualModel: string | null;
  accessoryName: string | null;
};
const deviceName = (j: DeviceInfo) =>
  [j.brand?.name ?? j.manualBrand, j.deviceModel?.name ?? j.manualModel].filter(Boolean).join(' ') || j.accessoryName || '—';

const jobSelect = {
  id: true,
  jobNumber: true,
  status: true,
  imei: true,
  createdAt: true,
  branch: { select: { code: true } },
  customer: { select: { name: true } },
  brand: { select: { name: true } },
  deviceModel: { select: { name: true } },
  manualBrand: true,
  manualModel: true,
  accessoryName: true,
  assignedEngineer: { select: { name: true } },
} satisfies Prisma.JobSelect;

/** Open jobs older than `days` (default 15), any status except delivered / cancelled. */
export async function pendingJobs(query: PendingJobsQuery, actor: Actor): Promise<PendingJobRowDto[]> {
  const branchId = scope(actor, query.branchId);
  const created: Prisma.DateTimeFilter = { lte: new Date(Date.now() - query.days * DAY) };
  if (query.from) created.gte = startOfBusinessDay(query.from);
  if (query.to) created.lt = new Date(startOfBusinessDay(query.to).getTime() + DAY);
  const jobs = await prisma.job.findMany({
    where: { ...atBranch(branchId), status: query.status ? (query.status as JobStatus) : { notIn: CLOSED }, createdAt: created },
    orderBy: { createdAt: 'asc' },
    take: 1000,
    select: jobSelect,
  });
  return jobs.map((j) => ({
    id: j.id,
    jobNumber: publicJobNumber(j.jobNumber),
    customer: j.customer.name,
    model: deviceName(j),
    imei: j.imei,
    loginDate: j.createdAt.toISOString(),
    status: j.status,
    pendingDays: Math.floor((Date.now() - j.createdAt.getTime()) / DAY),
    engineer: j.assignedEngineer?.name ?? null,
    branchCode: j.branch.code,
  }));
}

/**
 * Mobile jobs logged in the range that no engineer has diagnosed. A job logged today is "Same-day" pending;
 * once the date rolls over it is shown as "Carried over". Closed / returned jobs and accessories are ignored.
 */
export async function diagnosisPending(query: ManagerRangeQuery, actor: Actor): Promise<DiagnosisPendingRowDto[]> {
  const branchId = scope(actor, query.branchId);
  const jobs = await prisma.job.findMany({
    where: {
      ...atBranch(branchId),
      jobType: 'MOBILE',
      diagnosedAt: null,
      status: { notIn: ['CANCELLED', 'DELIVERED', 'CUSTOMER_REJECTED', 'RWR', 'RWR_PENDING'] },
      createdAt: businessRange(query.from, query.to),
    },
    orderBy: { createdAt: 'asc' },
    take: 1000,
    select: jobSelect,
  });
  const remarks = await prisma.managerRemark.findMany({
    where: { kind: 'DIAGNOSIS', jobId: { in: jobs.map((j) => j.id) } },
    orderBy: { createdAt: 'desc' },
    select: { jobId: true, remark: true },
  });
  const latest = new Map<string, string>();
  for (const r of remarks) if (!latest.has(r.jobId)) latest.set(r.jobId, r.remark);
  const today = startOfBusinessDay(businessToday()).getTime();
  return jobs.map((j) => {
    const daysOpen = Math.max(0, Math.round((today - startOfBusinessDay(businessToday(j.createdAt)).getTime()) / DAY));
    const reason = !j.assignedEngineer
      ? 'Not assigned to an engineer yet'
      : j.status === 'SPARE_PENDING'
        ? 'Waiting for a spare part'
        : 'Assigned, but the engineer has not recorded a diagnosis';
    return {
      id: j.id,
      jobNumber: publicJobNumber(j.jobNumber),
      loginDate: j.createdAt.toISOString(),
      engineer: j.assignedEngineer?.name ?? null,
      customer: j.customer.name,
      model: deviceName(j),
      status: j.status,
      kind: daysOpen === 0 ? 'SAME_DAY' : 'CARRIED_OVER',
      remark: latest.get(j.id) ?? null,
      daysOpen,
      reason,
      branchCode: j.branch.code,
    };
  });
}

/** Parts actually issued to jobs in the range. Returned / cancelled lines are excluded, so nothing is counted twice. */
export async function consumption(query: ManagerRangeQuery, actor: Actor, unorderedOnly = false) {
  const branchId = scope(actor, query.branchId);
  const rows = await prisma.jobPart.findMany({
    where: { status: 'ISSUED', noteStatus: 'APPROVED', handledAt: businessRange(query.from, query.to), ...(unorderedOnly && { poId: null }), ...(branchId && { job: atBranch(branchId) }) },
    select: {
      id: true,
      quantity: true,
      usedQuantity: true,
      unitPrice: true,
      requestedBy: { select: { name: true } },
      part: {
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          subcategory: true,
          color: true,
          costPrice: true,
          brand: { select: { name: true } },
          deviceModel: { select: { name: true } },
        },
      },
    },
  });
  // Only what the engineer confirmed as used (Return Note approved) counts as consumption.
  return rows.map((r) => ({ ...r, quantity: r.usedQuantity ?? r.quantity })).filter((r) => r.quantity > 0);
}

/** Auto purchase order: total issued quantity per part for the period — no manual counting. */
export function groupConsumption(items: Awaited<ReturnType<typeof consumption>>): PoRowDto[] {
  const rows = new Map<string, PoRowDto>();
  for (const c of items) {
    const p = c.part;
    const cost = p.costPrice?.toNumber() ?? 0;
    const row = rows.get(p.id) ?? {
      partId: p.id,
      partCode: p.code,
      product: p.name,
      category: p.category,
      subcategory: p.subcategory,
      brand: p.brand?.name ?? null,
      model: p.deviceModel?.name ?? null,
      color: p.color,
      quantity: 0,
      unitCost: cost,
      amount: 0,
    };
    row.quantity += c.quantity;
    row.amount = roundMoney(row.quantity * cost);
    rows.set(p.id, row);
  }
  return [...rows.values()].sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.product.localeCompare(b.product));
}

/** Live preview: parts issued in the period that are not yet on any saved purchase order. */
export async function purchaseOrder(query: ManagerRangeQuery, actor: Actor): Promise<PoRowDto[]> {
  return groupConsumption(await consumption(query, actor, true));
}

export async function profitLoss(query: ManagerRangeQuery, actor: Actor): Promise<ProfitLossDto> {
  const branchId = scope(actor, query.branchId);
  await assertCan(actor, 'view_pnl');
  const r = businessRange(query.from, query.to);
  const used = await consumption(query, actor);

  const byBrand = new Map<string, ProfitLossRowDto>();
  const byCategory = new Map<string, ProfitLossRowDto>();
  const byModel = new Map<string, ProfitLossRowDto>();
  const byPartCode = new Map<string, ProfitLossRowDto>();
  const byEngineer = new Map<string, ProfitLossRowDto>();
  const add = (m: Map<string, ProfitLossRowDto>, label: string, q: number, purchase: number, selling: number) => {
    const row = m.get(label) ?? { key: label, label, quantity: 0, purchase: 0, selling: 0, profit: 0 };
    row.quantity += q;
    row.purchase = roundMoney(row.purchase + purchase);
    row.selling = roundMoney(row.selling + selling);
    row.profit = roundMoney(row.selling - row.purchase);
    m.set(label, row);
  };
  let qty = 0;
  let purchaseValue = 0;
  let sellingValue = 0;
  for (const c of used) {
    const purchase = (c.part.costPrice?.toNumber() ?? 0) * c.quantity;
    const selling = c.unitPrice.toNumber() * c.quantity;
    qty += c.quantity;
    purchaseValue += purchase;
    sellingValue += selling;
    add(byBrand, c.part.brand?.name ?? 'No brand', c.quantity, purchase, selling);
    add(byCategory, c.part.category ?? 'Uncategorised', c.quantity, purchase, selling);
    add(byModel, c.part.deviceModel?.name ?? 'No model', c.quantity, purchase, selling);
    add(byPartCode, `${c.part.code} · ${c.part.name}`, c.quantity, purchase, selling);
    add(byEngineer, c.requestedBy.name, c.quantity, purchase, selling);
  }

  const own = branchId ? { branchId } : {};
  const [exp, inv, ref] = await Promise.all([
    prisma.expense.aggregate({ _sum: { amount: true }, where: { ...own, voidedAt: null, expenseDate: { gte: query.from, lte: query.to } } }),
    prisma.invoice.aggregate({ _sum: { discount: true }, where: { ...own, createdAt: r } }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { ...own, kind: 'REFUND', createdAt: r } }),
  ]);
  const expenses = exp._sum.amount?.toNumber() ?? 0;
  const discounts = inv._sum.discount?.toNumber() ?? 0;
  const refunds = ref._sum.amount?.toNumber() ?? 0;
  const gross = sellingValue - purchaseValue;
  const sorted = (m: Map<string, ProfitLossRowDto>) => [...m.values()].sort((a, b) => b.profit - a.profit);
  return {
    partsConsumed: qty,
    purchaseValue: roundMoney(purchaseValue),
    sellingValue: roundMoney(sellingValue),
    grossProfit: roundMoney(gross),
    expenses: roundMoney(expenses),
    discounts: roundMoney(discounts),
    refunds: roundMoney(refunds),
    // Refunds are shown but not deducted again: the margin above already counts only parts that stayed issued.
    netProfit: roundMoney(gross - expenses - discounts),
    byBrand: sorted(byBrand),
    byCategory: sorted(byCategory),
    byModel: sorted(byModel),
    byPartCode: sorted(byPartCode),
    byEngineer: sorted(byEngineer),
  };
}
