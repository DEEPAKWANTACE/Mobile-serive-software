import {
  ENGINEER_OPEN_STATUSES,
  REPORT_ROLES,
  roundMoney,
  type DashboardSummaryQuery,
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
  type AreaStatRow,
  type AreaStatsQuery,
} from '@msm/shared';
import { businessRange, businessToday } from '../../lib/business-date.ts';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import { toPage } from '../../lib/pagination.ts';
import { jobMoney } from '../jobs/jobs.service.ts';
import { publicJobNumber } from '../jobs/job-number.ts';

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

/** "khamgaon " / "KHAMGAON" → "Khamgaon"; blank → null. */
const areaName = (value: string | null) => {
  const t = (value ?? '').trim().replace(/\s+/g, ' ');
  return t ? t.toLowerCase().replace(/(?<![\p{L}\p{M}])\p{L}/gu, (m) => m.toUpperCase()) : null;
};

/** CCO and above: how many job sheets of each type came from each city, or each gaon. */
export async function areaStats(query: AreaStatsQuery, actor: Actor): Promise<AreaStatRow[]> {
  if (query.from > query.to) throw HttpError.badRequest('Invalid request', { from: ['From date is after To date'] });
  const branches = await resolveBranches(query, actor);
  const r = businessRange(query.from, query.to);
  const jobs = await prisma.job.findMany({
    where: { branchId: { in: branches.map((b) => b.id) }, createdAt: r },
    select: { jobType: true, customerType: true, status: true, customer: { select: { state: true, district: true, city: true, village: true } }, invoice: { select: { total: true } } },
  });
  const money = actor.role !== ROLES.CCO;
  const rows = new Map<string, AreaStatRow>();
  for (const j of jobs) {
    const area = {
      state: areaName(j.customer.state),
      district: areaName(j.customer.district),
      city: areaName(j.customer.city),
      village: query.level === 'village' ? areaName(j.customer.village) : null,
    };
    // The same village name exists in many places, so the whole area is the key. Older records have a city only.
    const key = [area.state, area.district, area.city, area.village].join('|');
    const row = rows.get(key) ?? { ...area, total: 0, mobile: 0, accessory: 0, walkIn: 0, retailer: 0, open: 0, delivered: 0, rwr: 0, cancelled: 0, revenue: money ? 0 : null };
    row.total += 1;
    if (j.jobType === 'ACCESSORY') row.accessory += 1;
    else row.mobile += 1;
    if (j.customerType === 'RETAILER') row.retailer += 1;
    else row.walkIn += 1;
    if (j.status === 'DELIVERED') row.delivered += 1;
    else if (j.status === 'CANCELLED') row.cancelled += 1;
    else row.open += 1;
    if (j.status === 'RWR' || j.status === 'RWR_PENDING') row.rwr += 1;
    if (j.invoice && row.revenue !== null) row.revenue = roundMoney(row.revenue + j.invoice.total.toNumber());
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || (a.village ?? a.city ?? '').localeCompare(b.village ?? b.city ?? ''));
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
        manualBrand: true,
        manualModel: true,
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
      job: { id: j.id, jobNumber: publicJobNumber(j.jobNumber), createdAt: j.createdAt.toISOString(), status: j.status, branchCode: j.branch.code },
      customer: j.customer.name,
      product: j.manualBrand || j.manualModel
        ? `${j.manualBrand ?? ''} ${j.manualModel ?? ''}`.trim()
        : j.brand && j.deviceModel
          ? `${j.brand.name} ${j.deviceModel.name}`
          : 'Accessory',
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

export async function dashboardSummary(query: DashboardSummaryQuery, actor: Actor): Promise<DashboardSummaryDto> {
  if (query.from && query.to && query.from > query.to) {
    throw HttpError.badRequest('Invalid request', { from: ['From date is after To date'] });
  }
  // Financial position: only Branch Manager / Super Admin may look at any period; counter staff see today or yesterday.
  if (actor.role !== ROLES.SUPER_ADMIN && actor.role !== ROLES.BRANCH_MANAGER) {
    const today = businessToday();
    const yesterday = businessToday(new Date(Date.now() - 86_400_000));
    query = { ...query, from: query.from ?? today, to: query.to ?? today };
    if (query.from! < yesterday || query.to! > today) throw HttpError.forbidden('You can only view today or yesterday');
  }
  const branchId = actor.branchId ?? query.branchId;
  const scope: Prisma.JobWhereInput = branchId ? { branchId } : {};
  const range = query.from || query.to ? businessRange(query.from ?? '2000-01-01', query.to ?? businessToday()) : null;

  const [totalIn, openJobs, totalOut, moneyJobs, completedPayments] = await Promise.all([
    prisma.job.count({ where: { ...scope, ...(range && { createdAt: range }) } }),
    // Pending work is "what is open right now": it must not shrink as the chosen period moves on,
    // otherwise yesterday's unfinished jobs vanish from a dashboard that opens on "Today".
    prisma.job.findMany({
      where: { ...scope, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
      select: {
        status: true,
        createdAt: true,
        assignedEngineer: { select: { id: true, name: true, phone: true } },
      },
    }),
    prisma.job.count({ where: { ...scope, status: 'DELIVERED', ...(range && { deliveredAt: range }) } }),
    prisma.job.findMany({
      where: { ...scope, status: { in: ['AWAITING_APPROVAL', 'IN_REPAIR', 'SPARE_PENDING', 'REPAIRED', 'TESTING', 'READY_FOR_DELIVERY'] } },
      select: {
        status: true,
        diagnosedAt: true,
        approvedAt: true,
        readyAt: true,
        quotedAmount: true,
        approvedAmount: true,
        estimatedAmount: true,
        invoice: { select: { total: true } },
        payments: { select: { kind: true, amount: true } },
      },
    }),
    prisma.payment.findMany({
      where: {
        ...(range && { createdAt: range }),
        job: { ...scope, status: { in: ['READY_FOR_DELIVERY', 'RWR', 'DELIVERED'] } },
      },
      select: { jobId: true, kind: true, mode: true, amount: true },
    }),
  ]);
  const open = openJobs;
  const perEngineer = new Map<string, { engineerId: string; engineer: string; phone: string | null; pending: number }>();
  for (const j of open) {
    if (!j.assignedEngineer) continue;
    const row = perEngineer.get(j.assignedEngineer.id) ?? { engineerId: j.assignedEngineer.id, engineer: j.assignedEngineer.name, phone: j.assignedEngineer.phone, pending: 0 };
    row.pending += 1;
    perEngineer.set(row.engineerId, row);
  }

  const isInMetricRange = (date: Date | null) => !range || inRange(date, range);
  const readyToCollect = moneyJobs.filter((j) => j.status === 'READY_FOR_DELIVERY' && isInMetricRange(j.readyAt));
  const pendingApproval = moneyJobs.filter((j) => j.status === 'AWAITING_APPROVAL' && isInMetricRange(j.diagnosedAt));
  const approvedUnderRepairStatuses = new Set(['IN_REPAIR', 'SPARE_PENDING', 'REPAIRED', 'TESTING']);
  const approvedUnderRepair = moneyJobs.filter((j) => approvedUnderRepairStatuses.has(j.status) && isInMetricRange(j.approvedAt));

  const readyToCollectAmount = roundMoney(
    readyToCollect.reduce((sum, job) => sum + Math.max(0, jobMoney(job).balance), 0),
  );
  const pendingApprovalAmount = roundMoney(
    pendingApproval.reduce((sum, job) => sum + ((job.quotedAmount ?? job.estimatedAmount)?.toNumber() ?? 0), 0),
  );
  const approvedUnderRepairAmount = roundMoney(
    approvedUnderRepair.reduce((sum, job) => sum + ((job.approvedAmount ?? job.quotedAmount ?? job.estimatedAmount)?.toNumber() ?? 0), 0),
  );

  const completedReceivedByMode = { CASH: 0, UPI: 0, CARD: 0 };
  for (const payment of completedPayments) {
    const signed = (payment.kind === 'REFUND' ? -1 : 1) * payment.amount.toNumber();
    completedReceivedByMode[payment.mode] += signed;
  }
  completedReceivedByMode.CASH = roundMoney(completedReceivedByMode.CASH);
  completedReceivedByMode.UPI = roundMoney(completedReceivedByMode.UPI);
  completedReceivedByMode.CARD = roundMoney(completedReceivedByMode.CARD);
  const selectedPayments = query.paymentMode
    ? completedPayments.filter((payment) => payment.mode === query.paymentMode)
    : completedPayments;
  const completedReceivedAmount = query.paymentMode
    ? completedReceivedByMode[query.paymentMode]
    : roundMoney(Object.values(completedReceivedByMode).reduce((sum, amount) => sum + amount, 0));

  return {
    totalJobs: totalIn,
    totalIn,
    totalOut,
    pending: open.length,
    underRepair: open.filter((j) => (ENGINEER_OPEN_STATUSES as readonly string[]).includes(j.status)).length,
    over15Days: open.filter((j) => Date.now() - j.createdAt.getTime() >= 15 * DAY).length,
    readyToCollectAmount,
    readyToCollectCount: readyToCollect.length,
    pendingApprovalAmount,
    pendingApprovalCount: pendingApproval.length,
    approvedUnderRepairAmount,
    approvedUnderRepairCount: approvedUnderRepair.length,
    completedReceivedAmount,
    completedReceivedCount: new Set(selectedPayments.map((payment) => payment.jobId)).size,
    completedReceivedByMode,
    paymentMode: query.paymentMode ?? null,
    engineerPending: [...perEngineer.values()].sort((a, b) => b.pending - a.pending),
  };
}
