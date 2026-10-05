import {
  REPORT_ROLES,
  roundMoney,
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
