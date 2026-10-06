import {
  ENGINEER_OPEN_STATUSES,
  REPORT_ROLES,
  roundMoney,
  type DashboardSummaryDto,
  type EngineerReportQuery,
  type EngineerReportRowDto,
  type JobStatus,
  ROLES,
  type ReportBranchRow,
  type ReportCcoRow,
  type ReportDto,
  type ReportEngineerRow,
  type ReportQuery,
} from '@msm/shared';
import { businessRange, businessToday } from '../../lib/business-date.ts';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import { toPage } from '../../lib/pagination.ts';
import { jobMoney } from '../jobs/jobs.service.ts';

const TAT_LIMIT_DAYS = 15;
const DAY = 86_400_000;

/** Branches in the report: own branch for branch roles; Super Admin may narrow by state / city / branch. */
async function resolveBranches(query: ReportQuery, actor: Actor) {
  if (!REPORT_ROLES.includes(actor.role)) throw HttpError.forbidden();
  const where = actor.branchId
    ? { id: actor.branchId }
    : query.branchId
      ? { id: query.branchId }
      : query.cityId
        ? { cityId: query.cityId }
        : query.stateId
          ? { city: { stateId: query.stateId } }
          : {};
  return prisma.branch.findMany({
    where,
    select: { id: true, code: true, name: true, city: { select: { name: true, state: { select: { name: true } } } } },
    orderBy: { name: 'asc' },
  });
}

const inRange = (d: Date | null, r: { gte: Date; lt: Date }) => !!d && d >= r.gte && d < r.lt;

export async function build(query: ReportQuery, actor: Actor): Promise<ReportDto> {
  if (query.from > query.to) throw HttpError.badRequest('Invalid request', { from: ['From date is after To date'] });
  const branches = await resolveBranches(query, actor);
  const ids = branches.map((b) => b.id);
  const r = businessRange(query.from, query.to);
  const now = Date.now();

  const [jobs, invoices, l4, transfers, engineers, counterStaff] = await Promise.all([
    prisma.job.findMany({
      where: {
        OR: [{ branchId: { in: ids } }, { assignedEngineer: { branchId: { in: ids } } }],
        AND: [{ OR: [{ createdAt: r }, { deliveredAt: r }, { readyAt: r }, { rwrAt: r }, { approvedAt: r }, { status: { not: 'DELIVERED' } }] }],
      },
      select: {
        id: true,
        branchId: true,
        status: true,
        createdAt: true,
        deliveredAt: true,
        deliveredById: true,
        readyAt: true,
        rwrAt: true,
        assignedAt: true,
        approvedAt: true,
        approvedById: true,
        createdById: true,
        assignedEngineerId: true,
        payments: { where: { kind: 'ADVANCE', createdAt: r }, select: { amount: true } },
      },
    }),
    prisma.invoice.findMany({ where: { branchId: { in: ids }, createdAt: r }, select: { branchId: true, total: true, job: { select: { createdById: true } } } }),
    prisma.jobMovement.groupBy({ by: ['fromBranchId'], where: { direction: 'TO_L4', fromBranchId: { in: ids }, sentAt: r }, _count: { _all: true } }),
    prisma.jobTransfer.groupBy({ by: ['fromEngineerId'], where: { status: 'ACCEPTED', respondedAt: r }, _count: { _all: true } }),
    prisma.user.findMany({
      where: { role: ROLES.ENGINEER, branchId: { in: ids } },
      select: { id: true, name: true, isActive: true, branch: { select: { code: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { role: { in: [ROLES.CCO, ROLES.BRANCH_MANAGER] }, branchId: { in: ids } },
      select: { id: true, name: true, role: true, branch: { select: { code: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);

  const ownJobs = jobs.filter((j) => ids.includes(j.branchId));
  const l4ByBranch = new Map(l4.map((g) => [g.fromBranchId, g._count._all]));

  function counts(branchIds: string[]) {
    const js = ownJobs.filter((j) => branchIds.includes(j.branchId));
    const delivered = js.filter((j) => inRange(j.deliveredAt, r));
    const open = js.filter((j) => j.status !== 'DELIVERED');
    const sameDay = delivered.filter((j) => businessToday(j.createdAt) === businessToday(j.deliveredAt!));
    const tat = delivered.map((j) => (j.deliveredAt!.getTime() - j.createdAt.getTime()) / DAY);
    return {
      received: js.filter((j) => inRange(j.createdAt, r)).length,
      delivered: delivered.length,
      repairedDelivered: delivered.filter((j) => !j.rwrAt).length,
      rwrDelivered: delivered.filter((j) => !!j.rwrAt).length,
      pendingNow: open.length,
      overdueNow: open.filter((j) => now - j.createdAt.getTime() >= TAT_LIMIT_DAYS * DAY).length,
      sameDayPct: delivered.length ? Math.round((sameDay.length / delivered.length) * 100) : null,
      avgTatDays: tat.length ? Math.round((tat.reduce((a, b) => a + b, 0) / tat.length) * 10) / 10 : null,
      revenue: roundMoney(invoices.filter((i) => branchIds.includes(i.branchId)).reduce((s, i) => s + i.total.toNumber(), 0)),
      sentToL4: branchIds.reduce((s, id) => s + (l4ByBranch.get(id) ?? 0), 0),
    };
  }

  const branchRows: ReportBranchRow[] = branches.map((b) => ({
    branch: { id: b.id, code: b.code, name: b.name, city: b.city.name, state: b.city.state.name },
    ...counts([b.id]),
  }));

  const transfersOut = new Map(transfers.map((t) => [t.fromEngineerId, t._count._all]));
  const engineerRows: ReportEngineerRow[] = engineers
    .map((e) => {
      const mine = jobs.filter((j) => j.assignedEngineerId === e.id);
      const ready = mine.filter((j) => inRange(j.readyAt, r));
      const hours = ready.filter((j) => j.assignedAt).map((j) => (j.readyAt!.getTime() - j.assignedAt!.getTime()) / 3_600_000);
      return {
        engineer: { id: e.id, name: e.name, branchCode: e.branch?.code ?? '', isActive: e.isActive },
        pending: mine.filter((j) => ['ASSIGNED', 'AWAITING_APPROVAL', 'IN_REPAIR'].includes(j.status)).length,
        done: mine.filter((j) => j.status === 'REPAIRED').length,
        testing: mine.filter((j) => j.status === 'TESTING').length,
        spareNotAvailable: mine.filter((j) => j.status === 'SPARE_PENDING').length,
        returnedOk: ready.length,
        rwr: mine.filter((j) => inRange(j.rwrAt, r)).length,
        transfersOut: transfersOut.get(e.id) ?? 0,
        avgRepairHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
      };
    })
    // hide inactive engineers with nothing to show
    .filter((row) => row.engineer.isActive || row.pending + row.done + row.testing + row.returnedOk + row.rwr > 0);

  const ccoRows: ReportCcoRow[] = counterStaff.map((u) => {
    const created = ownJobs.filter((j) => j.createdById === u.id && inRange(j.createdAt, r));
    const createdAll = ownJobs.filter((j) => j.createdById === u.id);
    return {
      user: { id: u.id, name: u.name, role: u.role, branchCode: u.branch?.code ?? '' },
      received: created.length,
      deliveredOfReceived: created.filter((j) => j.status === 'DELIVERED').length,
      approvalsConfirmed: ownJobs.filter((j) => j.approvedById === u.id && inRange(j.approvedAt, r)).length,
      deliveriesDone: ownJobs.filter((j) => j.deliveredById === u.id && inRange(j.deliveredAt, r)).length,
      revenue: roundMoney(invoices.filter((i) => i.job.createdById === u.id).reduce((s, i) => s + i.total.toNumber(), 0)),
      advanceCollected: roundMoney(createdAll.reduce((s, j) => s + j.payments.reduce((a, p) => a + p.amount.toNumber(), 0), 0)),
    };
  });

  return { from: query.from, to: query.to, summary: counts(ids), branches: branchRows, engineers: engineerRows, ccos: ccoRows };
}

// ─── Engineer report (record level) ─────────────────────────────────────────

function reportBranch(actor: Actor, requested?: string) {
  if (!REPORT_ROLES.includes(actor.role)) throw HttpError.forbidden();
  return actor.branchId ?? requested;
}

function paymentStatus(total: number, paid: number): EngineerReportRowDto['paymentStatus'] {
  if (paid > total) return 'REFUND_DUE';
  if (total <= 0) return 'NO_CHARGE';
  if (paid >= total) return 'PAID';
  return paid > 0 ? 'PARTIAL' : 'UNPAID';
}

export async function engineerReport(query: EngineerReportQuery, actor: Actor) {
  const branchId = reportBranch(actor, query.branchId);
  const and: Prisma.JobWhereInput[] = [];
  if (branchId) and.push({ OR: [{ branchId }, { currentBranchId: branchId }] });
  if (query.jobNumber) and.push({ jobNumber: { contains: query.jobNumber, mode: 'insensitive' } });
  if (query.from || query.to) and.push({ createdAt: businessRange(query.from ?? '2000-01-01', query.to ?? businessToday()) });
  if (query.status) and.push({ status: query.status as JobStatus });
  // An engineer "worked on" a job if it is assigned to them now or was at any time (transfers included).
  if (query.engineerId) and.push({ OR: [{ assignedEngineerId: query.engineerId }, { assignments: { some: { engineerId: query.engineerId } } }] });
  const where: Prisma.JobWhereInput = { AND: and };

  const [rows, total] = await prisma.$transaction([
    prisma.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        jobNumber: true,
        status: true,
        createdAt: true,
        assignedAt: true,
        repairedAt: true,
        testingAt: true,
        diagnosisNotes: true,
        repairRemark: true,
        testingRemark: true,
        quotedAmount: true,
        estimatedAmount: true,
        invoice: { select: { total: true } },
        payments: { select: { kind: true, amount: true } },
        branch: { select: { code: true } },
        customer: { select: { name: true } },
        brand: { select: { name: true } },
        deviceModel: { select: { name: true } },
        assignedEngineer: { select: { name: true } },
        faults: { select: { fault: { select: { name: true } } } },
        assignments: { select: { engineer: { select: { name: true } }, endReason: true }, orderBy: { assignedAt: 'asc' } },
        statusHistory: { select: { changedAt: true }, orderBy: { id: 'desc' }, take: 1 },
      },
    }),
    prisma.job.count({ where }),
  ]);

  const items: EngineerReportRowDto[] = rows.map((j) => {
    const money = jobMoney(j);
    const chain = j.assignments.map((a) => a.engineer.name);
    const last = j.assignments.at(-1);
    if (last?.endReason === 'UNASSIGNED') chain.push('Admin');
    if (last?.endReason === 'SENT_TO_L4') chain.push('L4');
    return {
      job: { id: j.id, jobNumber: j.jobNumber, createdAt: j.createdAt.toISOString(), status: j.status, branchCode: j.branch.code },
      customer: j.customer.name,
      product: `${j.brand.name} ${j.deviceModel.name}`,
      problem: j.faults.map((f) => f.fault.name).join(', '),
      engineer: j.assignedEngineer?.name ?? null,
      assignedAt: j.assignedAt?.toISOString() ?? null,
      lastStatusAt: j.statusHistory[0]?.changedAt.toISOString() ?? null,
      repairedAt: j.repairedAt?.toISOString() ?? null,
      testingAt: j.testingAt?.toISOString() ?? null,
      totalAmount: money.totalAmount,
      paidAmount: money.paidAmount,
      balance: money.balance,
      paymentStatus: paymentStatus(money.totalAmount, money.paidAmount),
      transferHistory: chain.join(' → '),
      remarks: [j.diagnosisNotes, j.repairRemark && `Repair: ${j.repairRemark}`, j.testingRemark && `Testing: ${j.testingRemark}`].filter(Boolean).join(' · ') || null,
    };
  });
  return toPage(items, total, query);
}

// ─── Dashboard summary ──────────────────────────────────────────────────────

export async function dashboardSummary(query: { from?: string; to?: string; branchId?: string }, actor: Actor): Promise<DashboardSummaryDto> {
  const branchId = actor.branchId ?? query.branchId;
  const scope: Prisma.JobWhereInput = branchId ? { branchId } : {};
  const range = query.from || query.to ? businessRange(query.from ?? '2000-01-01', query.to ?? businessToday()) : null;

  const [jobs, totalOut] = await Promise.all([
    prisma.job.findMany({
      where: { ...scope, ...(range && { createdAt: range }) },
      select: {
        status: true,
        createdAt: true,
        quotedAmount: true,
        estimatedAmount: true,
        invoice: { select: { total: true } },
        payments: { select: { kind: true, amount: true } },
        assignedEngineer: { select: { id: true, name: true } },
      },
    }),
    prisma.job.count({ where: { ...scope, status: 'DELIVERED', ...(range && { deliveredAt: range }) } }),
  ]);
  const open = jobs.filter((j) => j.status !== 'DELIVERED' && j.status !== 'CANCELLED');
  const money = jobs.filter((j) => j.status !== 'CANCELLED').map((j) => jobMoney(j));
  const sum = (k: 'totalAmount' | 'paidAmount') => roundMoney(money.reduce((s, m) => s + m[k], 0));
  const perEngineer = new Map<string, { engineerId: string; engineer: string; pending: number }>();
  for (const j of open) {
    if (!j.assignedEngineer) continue;
    const row = perEngineer.get(j.assignedEngineer.id) ?? { engineerId: j.assignedEngineer.id, engineer: j.assignedEngineer.name, pending: 0 };
    row.pending += 1;
    perEngineer.set(row.engineerId, row);
  }

  return {
    totalJobs: jobs.length,
    totalIn: jobs.length,
    totalOut,
    pending: open.length,
    underRepair: open.filter((j) => (ENGINEER_OPEN_STATUSES as readonly string[]).includes(j.status)).length,
    over15Days: open.filter((j) => Date.now() - j.createdAt.getTime() >= 15 * DAY).length,
    totalAmount: sum('totalAmount'),
    totalPaid: sum('paidAmount'),
    totalBalance: roundMoney(sum('totalAmount') - sum('paidAmount')),
    engineerPending: [...perEngineer.values()].sort((a, b) => b.pending - a.pending),
  };
}
