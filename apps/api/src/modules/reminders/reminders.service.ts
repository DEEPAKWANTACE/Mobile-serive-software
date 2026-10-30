import {
  CLOSED_STATUSES, ROLES,
  type NotificationFeedDto, type NotificationItemDto, type ReminderAssigneeDto,
  type ReminderCreateData, type ReminderDto, type ReminderUpdateData, type Role,
} from '@msm/shared';
import { prisma } from '../../lib/prisma.ts';
import { HttpError } from '../../lib/http-error.ts';
import type { Actor } from '../../lib/request-context.ts';
import { publicJobNumber } from '../jobs/job-number.ts';

const jobScope = (actor: Actor) => actor.branchId ? { branchId: actor.branchId } : {};
const roleBelow: Partial<Record<Role, readonly Role[]>> = {
  [ROLES.BRANCH_MANAGER]: [ROLES.CCO, ROLES.ENGINEER, ROLES.STOREKEEPER, ROLES.ACCOUNTS],
  [ROLES.CCO]: [ROLES.ENGINEER],
};

async function targetFor(actor: Actor, requestedId?: string) {
  const id = requestedId ?? actor.sub;
  const target = await prisma.user.findFirst({ where: { id, isActive: true }, select: { id: true, name: true, role: true, branchId: true } });
  if (!target) throw HttpError.badRequest('Invalid request', { assignedToId: ['Select an active user'] });
  if (target.id === actor.sub || actor.role === ROLES.SUPER_ADMIN) return target;
  const allowed = actor.branchId && actor.branchId === target.branchId && roleBelow[actor.role]?.includes(target.role);
  if (!allowed) throw HttpError.forbidden('You can only assign reminders to staff below your role in your branch');
  return target;
}

export async function assignees(actor: Actor): Promise<ReminderAssigneeDto[]> {
  const roles = roleBelow[actor.role] ?? [];
  return prisma.user.findMany({
    where: actor.role === ROLES.SUPER_ADMIN
      ? { isActive: true }
      : { isActive: true, OR: [{ id: actor.sub }, ...(actor.branchId && roles.length ? [{ branchId: actor.branchId, role: { in: [...roles] } }] : [])] },
    select: { id: true, name: true, role: true }, orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
}

export async function feed(actor: Actor): Promise<NotificationFeedDto> {
  const now = new Date();
  const [reminders, deadlines, approvals] = await Promise.all([
    prisma.reminder.findMany({
      where: { assignedToId: actor.sub, completedAt: null },
      select: { id: true, title: true, dueAt: true, jobId: true, job: { select: { jobNumber: true } }, createdBy: { select: { name: true } }, assignedTo: { select: { name: true } } },
      orderBy: { dueAt: 'asc' }, take: 100,
    }),
    prisma.job.findMany({
      where: { ...jobScope(actor), dueAt: { not: null }, status: { notIn: [...CLOSED_STATUSES] } },
      select: { id: true, jobNumber: true, dueAt: true, customer: { select: { name: true } }, assignedEngineer: { select: { name: true } } },
      orderBy: { dueAt: 'asc' }, take: 100,
    }),
    prisma.job.findMany({
      where: { ...jobScope(actor), status: 'AWAITING_APPROVAL' },
      select: { id: true, jobNumber: true, diagnosedAt: true, updatedAt: true, customer: { select: { name: true } }, quotedAmount: true },
      orderBy: { diagnosedAt: 'asc' }, take: 100,
    }),
  ]);
  const items: NotificationItemDto[] = [
    ...reminders.map((r) => ({
      id: r.id, kind: 'REMINDER' as const, title: r.title, dueAt: r.dueAt.toISOString(), isDue: r.dueAt <= now,
      jobId: r.jobId, jobNumber: r.job ? publicJobNumber(r.job.jobNumber) : null, createdBy: r.createdBy.name, assignedTo: r.assignedTo.name,
    })),
    ...deadlines.map((j) => ({
      id: `deadline:${j.id}`, kind: 'JOB_DEADLINE' as const,
      title: `${publicJobNumber(j.jobNumber)} for ${j.customer.name}${j.assignedEngineer ? ` · ${j.assignedEngineer.name}` : ''}`,
      dueAt: j.dueAt!.toISOString(), isDue: j.dueAt! <= now, jobId: j.id, jobNumber: publicJobNumber(j.jobNumber), createdBy: null, assignedTo: null,
    })),
    ...approvals.map((j) => ({
      id: `approval:${j.id}`, kind: 'APPROVAL' as const,
      title: `Approval needed: ${publicJobNumber(j.jobNumber)} · ${j.customer.name} · ₹${j.quotedAmount?.toNumber().toLocaleString('en-IN') ?? '0'}`,
      dueAt: (j.diagnosedAt ?? j.updatedAt).toISOString(), isDue: true, jobId: j.id, jobNumber: publicJobNumber(j.jobNumber), createdBy: null, assignedTo: null,
    })),
  ].sort((a, b) => Number(b.isDue) - Number(a.isDue) || new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  return { items, dueCount: items.filter((item) => item.isDue).length };
}

const reminderSelect = {
  id: true, title: true, dueAt: true, completedAt: true, createdAt: true,
  job: { select: { id: true, jobNumber: true } },
  createdBy: { select: { id: true, name: true, role: true } },
  assignedTo: { select: { id: true, name: true, role: true } },
} as const;

type ReminderRow = {
  id: string; title: string; dueAt: Date; completedAt: Date | null; createdAt: Date;
  job: { id: string; jobNumber: string } | null; createdBy: ReminderAssigneeDto; assignedTo: ReminderAssigneeDto;
};
const toDto = (r: ReminderRow, actor: Actor): ReminderDto => ({
  ...r, dueAt: r.dueAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  job: r.job ? { ...r.job, jobNumber: publicJobNumber(r.job.jobNumber) } : null,
  canEdit: r.createdBy.id === actor.sub || r.assignedTo.id === actor.sub,
  canComplete: r.assignedTo.id === actor.sub && !r.completedAt,
});

export async function mine(actor: Actor): Promise<ReminderDto[]> {
  const rows = await prisma.reminder.findMany({
    where: { OR: [{ assignedToId: actor.sub }, { createdById: actor.sub }] }, select: reminderSelect,
    orderBy: [{ completedAt: 'asc' }, { dueAt: 'asc' }], take: 250,
  });
  return rows.map((row) => toDto(row, actor));
}

export async function create(data: ReminderCreateData, actor: Actor) {
  const dueAt = new Date(data.dueAt);
  if (dueAt.getTime() <= Date.now()) throw HttpError.badRequest('Invalid request', { dueAt: ['Choose a future time'] });
  const target = await targetFor(actor, data.assignedToId);
  if (data.jobId) {
    const job = await prisma.job.findFirst({ where: { id: data.jobId, ...jobScope(actor) }, select: { id: true, branchId: true } });
    if (!job) throw HttpError.notFound('Job not found');
    if (target.branchId && job.branchId !== target.branchId) throw HttpError.badRequest('The job and assignee must belong to the same branch');
  }
  return prisma.reminder.create({
    data: { title: data.title, dueAt, jobId: data.jobId, createdById: actor.sub, assignedToId: target.id, branchId: target.branchId },
    select: { id: true },
  });
}

export async function update(id: string, data: ReminderUpdateData, actor: Actor) {
  const reminder = await prisma.reminder.findUnique({ where: { id }, select: { createdById: true, assignedToId: true, completedAt: true } });
  if (!reminder || (reminder.createdById !== actor.sub && reminder.assignedToId !== actor.sub)) throw HttpError.notFound('Reminder not found');
  if (reminder.completedAt) throw HttpError.conflict('Completed reminders cannot be edited');
  if (data.dueAt && new Date(data.dueAt).getTime() <= Date.now()) throw HttpError.badRequest('Invalid request', { dueAt: ['Choose a future time'] });
  let target: Awaited<ReturnType<typeof targetFor>> | undefined;
  if (data.assignedToId && data.assignedToId !== reminder.assignedToId) {
    if (reminder.createdById !== actor.sub) throw HttpError.forbidden('Only the reminder creator can change the assignee');
    target = await targetFor(actor, data.assignedToId);
  }
  await prisma.reminder.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.dueAt !== undefined && { dueAt: new Date(data.dueAt) }),
      ...(target && { assignedToId: target.id, branchId: target.branchId }),
    },
  });
}

export async function complete(id: string, actor: Actor) {
  const result = await prisma.reminder.updateMany({ where: { id, assignedToId: actor.sub, completedAt: null }, data: { completedAt: new Date() } });
  if (!result.count) throw HttpError.notFound('Reminder not found');
}
