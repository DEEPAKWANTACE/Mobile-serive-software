import {
  roundMoney,
  type CallingListQuery,
  type CallingRowDto,
  type CallLogCreateData,
  type CallLogDto,
  type JobStatus,
  type PendingCollectionSummaryDto,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { branchScope } from '../../lib/access.ts';
import { businessRange, businessToday } from '../../lib/business-date.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { loadForAccess } from '../jobs/jobs.service.ts';

/** Jobs that are waiting on the customer (for calling and pending collection). */
const OPEN_FOR_CALLS: JobStatus[] = ['READY_FOR_DELIVERY', 'RWR', 'AWAITING_APPROVAL', 'CUSTOMER_REJECTED'];

const rowSelect = {
  id: true,
  jobNumber: true,
  status: true,
  readyAt: true,
  rwrAt: true,
  diagnosedAt: true,
  quotedAmount: true,
  brand: { select: { name: true } },
  deviceModel: { select: { name: true } },
  branch: { select: { code: true } },
  customer: { select: { name: true, phone: true, altPhone: true } },
  payments: { select: { kind: true, amount: true } },
  callLogs: {
    select: { outcome: true, note: true, createdAt: true, nextFollowUpAt: true, createdBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  _count: { select: { callLogs: true } },
} satisfies Prisma.JobSelect;

type Row = Prisma.JobGetPayload<{ select: typeof rowSelect }>;

function toRow(j: Row, now = Date.now()): CallingRowDto {
  const paid = j.payments.reduce((s, p) => s + (p.kind === 'REFUND' ? -1 : 1) * p.amount.toNumber(), 0);
  const quoted = j.quotedAmount?.toNumber() ?? 0;
  // Repaired: approved estimate minus payments. RWR / rejected: nothing to charge (refund any advance). Approval: the estimate.
  const balance = roundMoney(j.status === 'READY_FOR_DELIVERY' || j.status === 'AWAITING_APPROVAL' ? quoted - paid : -paid);
  const since = j.status === 'READY_FOR_DELIVERY' ? j.readyAt : j.status === 'RWR' ? j.rwrAt : j.diagnosedAt;
  const last = j.callLogs[0];
  return {
    job: { id: j.id, jobNumber: j.jobNumber, status: j.status, device: `${j.brand.name} ${j.deviceModel.name}`, branchCode: j.branch.code },
    customer: j.customer,
    since: since?.toISOString() ?? null,
    daysWaiting: since ? Math.floor((now - since.getTime()) / 86_400_000) : 0,
    balance,
    attempts: j._count.callLogs,
    lastCall: last ? { outcome: last.outcome, at: last.createdAt.toISOString(), by: last.createdBy.name, note: last.note } : null,
    nextFollowUpAt: last?.nextFollowUpAt?.toISOString() ?? null,
  };
}

function scope(actor: Actor, branchId?: string): Prisma.JobWhereInput {
  return actor.branchId ? branchScope(actor) : branchId ? { branchId } : {};
}

const endOfToday = () => businessRange(businessToday(), businessToday()).lt;

export async function list(query: CallingListQuery, actor: Actor): Promise<CallingRowDto[]> {
  const statusFor: Record<Exclude<CallingListQuery['list'], 'due'>, JobStatus[]> = {
    ready: ['READY_FOR_DELIVERY'],
    rwr: ['RWR', 'CUSTOMER_REJECTED'],
    approval: ['AWAITING_APPROVAL'],
  };
  const statuses = query.list === 'due' ? OPEN_FOR_CALLS : statusFor[query.list];
  const jobs = await prisma.job.findMany({
    where: { ...scope(actor, query.branchId), status: { in: statuses } },
    select: rowSelect,
    take: 500,
  });
  let rows = jobs.map((j) => toRow(j));
  if (query.list === 'due') {
    const end = endOfToday().getTime();
    rows = rows.filter((r) => r.nextFollowUpAt && new Date(r.nextFollowUpAt).getTime() < end);
    rows.sort((a, b) => a.nextFollowUpAt!.localeCompare(b.nextFollowUpAt!));
  } else {
    rows.sort((a, b) => b.daysWaiting - a.daysWaiting); // longest waiting first
  }
  return rows;
}

export async function summary(actor: Actor, branchId?: string): Promise<PendingCollectionSummaryDto> {
  const rows = (
    await prisma.job.findMany({ where: { ...scope(actor, branchId), status: { in: OPEN_FOR_CALLS } }, select: rowSelect, take: 2000 })
  ).map((j) => toRow(j));
  const end = endOfToday().getTime();
  const ready = rows.filter((r) => r.job.status === 'READY_FOR_DELIVERY');
  const rwr = rows.filter((r) => r.job.status === 'RWR' || r.job.status === 'CUSTOMER_REJECTED');
  return {
    ready: { count: ready.length, amount: roundMoney(ready.reduce((s, r) => s + Math.max(0, r.balance), 0)) },
    rwr: { count: rwr.length, refunds: roundMoney(rwr.reduce((s, r) => s + Math.max(0, -r.balance), 0)) },
    followUpsDue: rows.filter((r) => r.nextFollowUpAt && new Date(r.nextFollowUpAt).getTime() < end).length,
  };
}

const callSelect = {
  id: true,
  purpose: true,
  outcome: true,
  note: true,
  nextFollowUpAt: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.CallLogSelect;

const toCallDto = (c: Prisma.CallLogGetPayload<{ select: typeof callSelect }>): CallLogDto => ({
  ...c,
  nextFollowUpAt: c.nextFollowUpAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
});

export async function jobCalls(jobId: string, actor: Actor) {
  await loadForAccess(jobId, actor);
  const rows = await prisma.callLog.findMany({ where: { jobId }, select: callSelect, orderBy: { createdAt: 'desc' } });
  return rows.map(toCallDto);
}

export async function logCall(jobId: string, data: CallLogCreateData, actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  return prisma.$transaction(async (tx) => {
    const row = await tx.callLog.create({
      data: {
        jobId,
        branchId: job.branchId,
        purpose: data.purpose,
        outcome: data.outcome,
        note: data.note ?? null,
        nextFollowUpAt: data.nextFollowUpAt ? new Date(data.nextFollowUpAt) : null,
        createdById: actor.sub,
      },
      select: callSelect,
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.call_logged',
        entityType: 'job',
        entityId: jobId,
        branchId: job.branchId,
        metadata: { purpose: data.purpose, outcome: data.outcome, note: data.note ?? null, nextFollowUpAt: data.nextFollowUpAt ?? null },
        ip: actor.ip,
      },
      tx,
    );
    return toCallDto(row);
  });
}
