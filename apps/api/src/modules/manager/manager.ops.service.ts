import {
  roundMoney,
  type CallingPendingRowDto,
  type CallingReportDto,
  type JobStatus,
  type ManagerAlertDto,
  type ManagerOverviewDto,
  type ManagerRangeQuery,
  type PoCreateData,
  type PoRowDto,
  type PurchaseOrderDto,
  type StockOverviewDto,
} from '@msm/shared';
import { businessRange, businessToday, startOfBusinessDay } from '../../lib/business-date.ts';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { publicJobNumber } from '../jobs/job-number.ts';
import { atBranch, consumption, diagnosisPending, groupConsumption, pendingJobs, scope } from './manager.service.ts';

const DAY = 86_400_000;
const CALL_STATUSES: JobStatus[] = ['READY_FOR_DELIVERY', 'RWR', 'AWAITING_APPROVAL', 'CUSTOMER_REJECTED'];
const CONNECTED = ['WILL_COLLECT', 'CALL_LATER', 'OTHER'];

// ─── Stock overview ─────────────────────────────────────────────────────────

export async function stockOverview(actor: Actor, requested?: string): Promise<StockOverviewDto> {
  const branchId = scope(actor, requested);
  const rows = await prisma.partStock.findMany({
    where: { ...(branchId && { branchId }), part: { isActive: true } },
    select: { quantity: true, part: { select: { id: true, code: true, name: true, color: true, costPrice: true, reorderLevel: true } } },
  });
  let units = 0;
  let value = 0;
  const qty = new Map<string, { code: string; name: string; color: string | null; quantity: number; reorderLevel: number }>();
  for (const r of rows) {
    units += r.quantity;
    value += r.quantity * (r.part.costPrice?.toNumber() ?? 0);
    const cur = qty.get(r.part.id) ?? { code: r.part.code, name: r.part.name, color: r.part.color, quantity: 0, reorderLevel: r.part.reorderLevel };
    cur.quantity += r.quantity;
    qty.set(r.part.id, cur);
  }
  const low = [...qty].filter(([, v]) => v.quantity <= v.reorderLevel).map(([partId, v]) => ({ partId, ...v })).sort((a, b) => a.quantity - b.quantity);
  return { items: qty.size, units, value: roundMoney(value), low };
}

// ─── Calling report / Happy Calling ─────────────────────────────────────────

export async function callingReport(query: ManagerRangeQuery, actor: Actor): Promise<CallingReportDto> {
  const branchId = scope(actor, query.branchId);
  const own = branchId ? { branchId } : {};
  const [logs, waiting] = await Promise.all([
    prisma.callLog.findMany({
      where: { ...own, createdAt: businessRange(query.from, query.to) },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true,
        purpose: true,
        outcome: true,
        note: true,
        feedback: true,
        satisfaction: true,
        source: true,
        nextFollowUpAt: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        job: { select: { id: true, jobNumber: true, customer: { select: { name: true, phone: true } } } },
      },
    }),
    prisma.job.findMany({
      where: { ...own, status: { in: CALL_STATUSES } },
      select: {
        id: true,
        jobNumber: true,
        status: true,
        readyAt: true,
        rwrAt: true,
        diagnosedAt: true,
        createdAt: true,
        branch: { select: { code: true } },
        customer: { select: { name: true, phone: true } },
        _count: { select: { callLogs: true } },
        callLogs: { select: { nextFollowUpAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      take: 2000,
    }),
  ]);
  const rows = logs.map((l) => ({
    id: l.id,
    jobId: l.job.id,
    jobNumber: publicJobNumber(l.job.jobNumber),
    customer: l.job.customer.name,
    phone: l.job.customer.phone,
    at: l.createdAt.toISOString(),
    cco: l.createdBy.name,
    purpose: l.purpose,
    outcome: l.outcome,
    connected: CONNECTED.includes(l.outcome),
    discussion: l.note,
    feedback: l.feedback,
    satisfaction: l.satisfaction,
    nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null,
    source: l.source,
  }));
  const end = businessRange(businessToday(), businessToday()).lt.getTime();
  const pending: CallingPendingRowDto[] = waiting
    .filter((j) => j._count.callLogs === 0)
    .map((j) => {
      const since = j.status === 'READY_FOR_DELIVERY' ? j.readyAt : j.status === 'RWR' ? j.rwrAt : (j.diagnosedAt ?? j.createdAt);
      return {
        jobId: j.id,
        jobNumber: publicJobNumber(j.jobNumber),
        customer: j.customer.name,
        phone: j.customer.phone,
        status: j.status,
        daysWaiting: since ? Math.floor((Date.now() - since.getTime()) / DAY) : 0,
        branchCode: j.branch.code,
      };
    })
    .sort((a, b) => b.daysWaiting - a.daysWaiting);
  const rated = rows.filter((r) => r.satisfaction != null);
  return {
    summary: {
      assigned: waiting.length,
      attempted: rows.length,
      connected: rows.filter((r) => r.connected).length,
      notConnected: rows.filter((r) => !r.connected).length,
      avgSatisfaction: rated.length ? Math.round((rated.reduce((s, r) => s + (r.satisfaction ?? 0), 0) / rated.length) * 10) / 10 : null,
      followUpDue: waiting.filter((j) => { const f = j.callLogs[0]?.nextFollowUpAt; return f && f.getTime() < end; }).length,
      pending: pending.length,
      verified: rows.filter((r) => r.source === 'VERIFIED').length,
    },
    rows,
    pending,
  };
}

// ─── Alerts ─────────────────────────────────────────────────────────────────

export async function alerts(actor: Actor, requested?: string): Promise<ManagerAlertDto[]> {
  const branchId = scope(actor, requested);
  const own = branchId ? { branchId } : {};
  const today = businessToday();
  const [old, diag, l4, incoming, stock, unordered, noCall, due, awaiting, unapproved] = await Promise.all([
    pendingJobs({ days: 15, branchId: requested }, actor).then((r) => r.length),
    diagnosisPending({ from: today, to: today, branchId: requested }, actor).then((r) => r.length),
    prisma.l4Request.count({ where: { status: 'PENDING', ...(branchId && { job: { branchId } }) } }),
    prisma.stockTransfer.count({ where: { status: 'SENT', ...(branchId && { toBranchId: branchId }) } }),
    stockOverview(actor, requested),
    prisma.jobPart.count({ where: { status: 'ISSUED', poId: null, ...(branchId && { job: atBranch(branchId) }) } }),
    prisma.job.count({ where: { ...own, status: { in: CALL_STATUSES }, callLogs: { none: {} } } }),
    prisma.job.count({ where: { ...own, status: { in: CALL_STATUSES }, callLogs: { some: { nextFollowUpAt: { lt: businessRange(today, today).lt } } } } }),
    prisma.job.count({ where: { ...own, status: 'AWAITING_APPROVAL' } }),
    prisma.expense.count({ where: { ...own, voidedAt: null, approvedAt: null, expenseDate: { gte: today.slice(0, 8) + '01' } } }),
  ]);
  const items: ManagerAlertDto[] = [
    { key: 'pending15', label: 'Jobs pending more than 15 days', count: old, priority: 'HIGH', link: '/branch-insights?tab=pending' },
    { key: 'l4', label: 'L4 transfer approvals pending', count: l4, priority: 'HIGH', link: '/l4' },
    { key: 'diagnosis', label: 'Same-day diagnosis pending', count: diag, priority: 'HIGH', link: '/branch-insights?tab=diagnosis' },
    { key: 'incoming', label: 'Stock from Head Office awaiting acceptance', count: incoming, priority: 'MEDIUM', link: '/store/transfers' },
    { key: 'lowStock', label: 'Low stock items', count: stock.low.length, priority: 'MEDIUM', link: '/branch-insights?tab=stock' },
    { key: 'po', label: 'Consumed parts not yet on a purchase order', count: unordered, priority: 'MEDIUM', link: '/branch-insights?tab=po' },
    { key: 'noCall', label: 'Customers not called yet', count: noCall, priority: 'MEDIUM', link: '/branch-insights?tab=calling' },
    { key: 'followUp', label: 'Customer follow-ups due', count: due, priority: 'MEDIUM', link: '/calling' },
    { key: 'approval', label: 'Estimates awaiting customer approval', count: awaiting, priority: 'LOW', link: '/jobs' },
    { key: 'expense', label: 'Expenses this month not yet approved', count: unapproved, priority: 'LOW', link: '/accounts/day-book' },
  ];
  return items.filter((i) => i.count > 0);
}

// ─── Overview ───────────────────────────────────────────────────────────────

export async function overview(query: ManagerRangeQuery, actor: Actor): Promise<ManagerOverviewDto> {
  const branchId = scope(actor, query.branchId);
  const own = branchId ? { branchId } : {};
  const range = businessRange(query.from, query.to);
  const [received, completed, pending, pays, exp, due, approvals, stock, assigned, repaired, openByEng, sheets, calls] = await Promise.all([
    prisma.job.count({ where: { ...own, createdAt: range } }),
    prisma.job.count({ where: { ...own, deliveredAt: range } }),
    prisma.job.count({ where: { ...own, status: { notIn: ['DELIVERED', 'CANCELLED'] } } }),
    prisma.payment.groupBy({ by: ['kind', 'mode'], where: { ...own, createdAt: range }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { ...own, voidedAt: null, expenseDate: { gte: query.from, lte: query.to } }, _sum: { amount: true } }),
    prisma.job.findMany({ where: { ...own, status: 'READY_FOR_DELIVERY' }, select: { quotedAmount: true, payments: { select: { kind: true, amount: true } } } }),
    prisma.job.count({ where: { ...own, status: 'AWAITING_APPROVAL' } }),
    stockOverview(actor, query.branchId),
    prisma.job.groupBy({ by: ['assignedEngineerId'], where: { ...own, assignedEngineerId: { not: null }, assignedAt: range }, _count: { _all: true } }),
    prisma.job.groupBy({ by: ['assignedEngineerId'], where: { ...own, assignedEngineerId: { not: null }, repairedAt: range }, _count: { _all: true } }),
    prisma.job.groupBy({ by: ['assignedEngineerId'], where: { ...own, assignedEngineerId: { not: null }, status: { notIn: ['DELIVERED', 'CANCELLED', 'READY_FOR_DELIVERY', 'RWR'] } }, _count: { _all: true } }),
    prisma.job.groupBy({ by: ['createdById'], where: { ...own, createdAt: range }, _count: { _all: true } }),
    prisma.callLog.groupBy({ by: ['createdById'], where: { ...own, createdAt: range }, _count: { _all: true } }),
  ]);
  let cash = 0;
  let online = 0;
  for (const g of pays) {
    const amt = (g._sum.amount?.toNumber() ?? 0) * (g.kind === 'REFUND' ? -1 : 1);
    if (g.mode === 'CASH') cash += amt;
    else online += amt;
  }
  const pendingPayments = due.reduce((s, j) => s + Math.max(0, (j.quotedAmount?.toNumber() ?? 0) - j.payments.reduce((p, x) => p + (x.kind === 'REFUND' ? -1 : 1) * x.amount.toNumber(), 0)), 0);

  const ids = new Set<string>();
  for (const g of [...assigned, ...repaired, ...openByEng]) if (g.assignedEngineerId) ids.add(g.assignedEngineerId);
  for (const g of [...sheets, ...calls]) ids.add(g.createdById);
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, role: true } })).map((u) => [u.id, u]));
  const n = (id: string | null) => (id ? names.get(id)?.name ?? 'Unknown' : 'Unknown');
  const count = (rows: { assignedEngineerId: string | null; _count: { _all: number } }[], id: string) => rows.find((r) => r.assignedEngineerId === id)?._count._all ?? 0;

  const engineerIds = [...ids].filter((id) => names.get(id)?.role === 'ENGINEER');
  const ccoIds = [...ids].filter((id) => ['CCO', 'BRANCH_MANAGER'].includes(names.get(id)?.role ?? ''));
  return {
    from: query.from,
    to: query.to,
    jobsReceived: received,
    jobsCompleted: completed,
    jobsPending: pending,
    collection: { cash: roundMoney(cash), online: roundMoney(online), total: roundMoney(cash + online) },
    expenses: roundMoney(exp._sum.amount?.toNumber() ?? 0),
    pendingPayments: roundMoney(pendingPayments),
    pendingApprovals: approvals,
    stock: { items: stock.items, units: stock.units, value: stock.value, lowCount: stock.low.length },
    engineers: engineerIds
      .map((id) => ({ name: n(id), assigned: count(assigned, id), completed: count(repaired, id), open: count(openByEng, id) }))
      .sort((a, b) => b.completed - a.completed),
    ccos: ccoIds
      .map((id) => ({ name: n(id), jobSheets: sheets.find((s) => s.createdById === id)?._count._all ?? 0, calls: calls.find((c) => c.createdById === id)?._count._all ?? 0 }))
      .sort((a, b) => b.calls - a.calls),
  };
}

// ─── Purchase orders ────────────────────────────────────────────────────────

type PoRow = {
  id: string;
  poNumber: string;
  fromDate: string;
  toDate: string;
  status: 'DRAFT' | 'FORWARDED';
  note: string | null;
  lines: unknown;
  createdAt: Date;
  forwardedAt: Date | null;
  branch: { code: string };
  createdBy: { name: string };
};
const toPoDto = (r: PoRow): PurchaseOrderDto => {
  const lines = r.lines as PoRowDto[];
  return {
    id: r.id,
    poNumber: r.poNumber,
    branchCode: r.branch.code,
    from: r.fromDate,
    to: r.toDate,
    status: r.status,
    note: r.note,
    createdBy: r.createdBy.name,
    createdAt: r.createdAt.toISOString(),
    forwardedAt: r.forwardedAt?.toISOString() ?? null,
    lines,
    totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
    totalAmount: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
  };
};
const poSelect = {
  id: true, poNumber: true, fromDate: true, toDate: true, status: true, note: true, lines: true, createdAt: true, forwardedAt: true,
  branch: { select: { code: true } },
  createdBy: { select: { name: true } },
} as const;

/** Saves a PO from parts issued in the period that are on no PO yet, and marks them so they are never ordered twice. */
export async function createPo(data: PoCreateData, actor: Actor) {
  const branchId = scope(actor, data.branchId);
  if (!branchId) throw HttpError.badRequest('Invalid request', { branchId: ['Select a branch'] });
  if (data.from > data.to) throw HttpError.badRequest('Invalid request', { from: ['From date is after To date'] });
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId }, select: { code: true } });

  return prisma.$transaction(async (tx) => {
    const used = await consumption({ from: data.from, to: data.to, branchId }, actor, true);
    if (!used.length) throw HttpError.conflict('Nothing new to order for this period');
    const lines = groupConsumption(used);
    const ym = businessToday().slice(2, 7).replace('-', '');
    const seq = (await tx.purchaseOrder.count({ where: { branchId, poNumber: { startsWith: `PO-${branch.code}-${ym}-` } } })) + 1;
    const po = await tx.purchaseOrder.create({
      data: { poNumber: `PO-${branch.code}-${ym}-${String(seq).padStart(3, '0')}`, branchId, fromDate: data.from, toDate: data.to, note: data.note ?? null, lines, createdById: actor.sub },
      select: poSelect,
    });
    const { count } = await tx.jobPart.updateMany({ where: { id: { in: used.map((u) => u.id) }, poId: null }, data: { poId: po.id } });
    if (count !== used.length) throw HttpError.conflict('Parts changed while creating the purchase order. Try again.');
    await recordAudit({ actorId: actor.sub, action: 'po.created', entityType: 'purchase_order', entityId: po.id, branchId, metadata: { poNumber: po.poNumber, lines: lines.length, from: data.from, to: data.to }, ip: actor.ip }, tx);
    return toPoDto(po);
  });
}

export async function listPos(actor: Actor, requested?: string): Promise<PurchaseOrderDto[]> {
  const branchId = scope(actor, requested);
  const rows = await prisma.purchaseOrder.findMany({ where: branchId ? { branchId } : {}, orderBy: { createdAt: 'desc' }, take: 100, select: poSelect });
  return rows.map(toPoDto);
}

export async function forwardPo(id: string, actor: Actor) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { branchId: true, status: true, poNumber: true } });
  if (!po) throw HttpError.notFound('Purchase order not found');
  if (actor.branchId && actor.branchId !== po.branchId) throw HttpError.forbidden();
  if (po.status === 'FORWARDED') throw HttpError.conflict('Already forwarded to Head Office');
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id }, data: { status: 'FORWARDED', forwardedAt: new Date() } });
    await recordAudit({ actorId: actor.sub, action: 'po.forwarded', entityType: 'purchase_order', entityId: id, branchId: po.branchId, metadata: { poNumber: po.poNumber }, ip: actor.ip }, tx);
  });
}

// ─── Remarks ────────────────────────────────────────────────────────────────

export async function addDiagnosisRemark(jobId: string, remark: string, actor: Actor) {
  scope(actor);
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { branchId: true } });
  if (!job) throw HttpError.notFound('Job not found');
  if (actor.branchId && actor.branchId !== job.branchId) throw HttpError.forbidden();
  await prisma.$transaction(async (tx) => {
    await tx.managerRemark.create({ data: { jobId, branchId: job.branchId, kind: 'DIAGNOSIS', remark, byId: actor.sub } });
    await recordAudit({ actorId: actor.sub, action: 'job.manager_remark', entityType: 'job', entityId: jobId, branchId: job.branchId, metadata: { kind: 'DIAGNOSIS', remark }, ip: actor.ip }, tx);
  });
}

export { startOfBusinessDay };
