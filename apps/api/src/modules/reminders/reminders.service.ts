import { CLOSED_STATUSES, type NotificationFeedDto, type NotificationItemDto, type ReminderCreateData } from '@msm/shared';
import { prisma } from '../../lib/prisma.ts';
import { HttpError } from '../../lib/http-error.ts';
import type { Actor } from '../../lib/request-context.ts';
import { publicJobNumber } from '../jobs/job-number.ts';

const jobScope = (actor: Actor) => actor.branchId ? { branchId: actor.branchId } : {};

export async function feed(actor: Actor): Promise<NotificationFeedDto> {
  const now = new Date();
  const [reminders, deadlines, approvals] = await Promise.all([
    prisma.reminder.findMany({
      where: { createdById: actor.sub, completedAt: null },
      select: { id: true, title: true, dueAt: true, jobId: true, job: { select: { jobNumber: true } }, createdBy: { select: { name: true } } },
      orderBy: { dueAt: 'asc' },
      take: 100,
    }),
    prisma.job.findMany({
      where: { ...jobScope(actor), dueAt: { not: null }, status: { notIn: [...CLOSED_STATUSES] } },
      select: { id: true, jobNumber: true, dueAt: true, customer: { select: { name: true } }, assignedEngineer: { select: { name: true } } },
      orderBy: { dueAt: 'asc' },
      take: 100,
    }),
    prisma.job.findMany({
      where: { ...jobScope(actor), status: 'AWAITING_APPROVAL' },
      select: { id: true, jobNumber: true, diagnosedAt: true, updatedAt: true, customer: { select: { name: true } }, quotedAmount: true },
      orderBy: { diagnosedAt: 'asc' },
      take: 100,
    }),
  ]);

  const items: NotificationItemDto[] = [
    ...reminders.map((r) => ({
      id: r.id,
      kind: 'REMINDER' as const,
      title: r.title,
      dueAt: r.dueAt.toISOString(),
      isDue: r.dueAt <= now,
      jobId: r.jobId,
      jobNumber: r.job ? publicJobNumber(r.job.jobNumber) : null,
      createdBy: r.createdBy.name,
    })),
    ...deadlines.map((j) => ({
      id: `deadline:${j.id}`,
      kind: 'JOB_DEADLINE' as const,
      title: `${publicJobNumber(j.jobNumber)} for ${j.customer.name}${j.assignedEngineer ? ` · ${j.assignedEngineer.name}` : ''}`,
      dueAt: j.dueAt!.toISOString(),
      isDue: j.dueAt! <= now,
      jobId: j.id,
      jobNumber: publicJobNumber(j.jobNumber),
      createdBy: null,
    })),
    ...approvals.map((j) => ({
      id: `approval:${j.id}`,
      kind: 'APPROVAL' as const,
      title: `Approval needed: ${publicJobNumber(j.jobNumber)} · ${j.customer.name} · ₹${j.quotedAmount?.toNumber().toLocaleString('en-IN') ?? '0'}`,
      dueAt: (j.diagnosedAt ?? j.updatedAt).toISOString(),
      isDue: true,
      jobId: j.id,
      jobNumber: publicJobNumber(j.jobNumber),
      createdBy: null,
    })),
  ].sort((a, b) => Number(b.isDue) - Number(a.isDue) || new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  return { items, dueCount: items.filter((i) => i.isDue).length };
}

export async function create(data: ReminderCreateData, actor: Actor) {
  const dueAt = new Date(data.dueAt);
  if (dueAt.getTime() <= Date.now()) throw HttpError.badRequest('Invalid request', { dueAt: ['Choose a future time'] });
  if (data.jobId) {
    const job = await prisma.job.findFirst({ where: { id: data.jobId, ...jobScope(actor) }, select: { id: true } });
    if (!job) throw HttpError.notFound('Job not found');
  }
  const row = await prisma.reminder.create({
    data: { title: data.title, dueAt, jobId: data.jobId, createdById: actor.sub, branchId: actor.branchId },
    select: { id: true },
  });
  return row;
}

export async function complete(id: string, actor: Actor) {
  const result = await prisma.reminder.updateMany({ where: { id, createdById: actor.sub, completedAt: null }, data: { completedAt: new Date() } });
  if (!result.count) throw HttpError.notFound('Reminder not found');
}
