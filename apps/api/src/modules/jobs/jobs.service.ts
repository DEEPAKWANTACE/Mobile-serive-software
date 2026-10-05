import { randomUUID } from 'node:crypto';
import {
  ASSIGNABLE_STATUSES,
  ENGINEER_OPEN_STATUSES,
  ENGINEER_VISIBLE_PHOTO_KINDS,
  JOB_STATUSES,
  ROLES,
  type EngineerWorkloadDto,
  type JobStatsDto,
  type JobStatus,
} from '@msm/shared';
import type {
  JobCreateData,
  JobDto,
  JobHistoryEntryDto,
  JobListItemDto,
  JobListQuery,
  JobPhotoDto,
  PhotoKind,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { assertBranchAccess, branchScope } from '../../lib/access.ts';
import { HttpError } from '../../lib/http-error.ts';
import { detectImageType } from '../../lib/image-type.ts';
import { logger } from '../../lib/logger.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { storage } from '../../lib/storage.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { nextJobNumber } from './job-number.ts';

const isEngineer = (actor: Actor) => actor.role === ROLES.ENGINEER;

/** Branch isolation, plus engineers only ever see jobs assigned to them. */
function jobScope(actor: Actor): Prisma.JobWhereInput {
  return { ...branchScope(actor), ...(isEngineer(actor) && { assignedEngineerId: actor.sub }) };
}

/** Resolve which branch a branch-level query is about: own branch for staff, explicit for Super Admin. */
function resolveBranchId(actor: Actor, requested?: string) {
  if (actor.branchId) return actor.branchId;
  if (!requested) throw HttpError.badRequest('Invalid request', { branchId: ['Select a branch'] });
  return requested;
}

// ─── Create ─────────────────────────────────────────────────────────────────

export async function create(data: JobCreateData, actor: Actor) {
  if (!actor.branchId) throw HttpError.forbidden('Only branch staff can create job sheets');

  const [branch, model, faultCount] = await Promise.all([
    prisma.branch.findUnique({ where: { id: actor.branchId }, select: { id: true, code: true } }),
    prisma.deviceModel.findUnique({ where: { id: data.deviceModelId }, select: { brandId: true, isActive: true } }),
    prisma.fault.count({ where: { id: { in: data.faultIds }, isActive: true } }),
  ]);
  if (!branch) throw HttpError.forbidden('Your branch was not found');
  if (!model || !model.isActive || model.brandId !== data.brandId) {
    throw HttpError.badRequest('Invalid request', { deviceModelId: ['Select a valid model for this brand'] });
  }
  if (faultCount !== new Set(data.faultIds).size) {
    throw HttpError.badRequest('Invalid request', { faultIds: ['One or more selected faults are invalid'] });
  }

  const { customer, faultIds, ...jobFields } = data;

  return prisma.$transaction(async (tx) => {
    // Customers are matched by mobile number; latest details from the counter win.
    const { phone, ...customerFields } = customer;
    const savedCustomer = await tx.customer.upsert({
      where: { phone },
      create: customer,
      update: Object.fromEntries(Object.entries(customerFields).filter(([, v]) => v !== undefined && v !== null)),
      select: { id: true },
    });

    const jobNumber = await nextJobNumber(tx, branch);
    const job = await tx.job.create({
      data: {
        ...jobFields,
        jobNumber,
        branchId: branch.id,
        customerId: savedCustomer.id,
        createdById: actor.sub,
        faults: { create: [...new Set(faultIds)].map((faultId) => ({ faultId })) },
      },
      select: { id: true, jobNumber: true },
    });

    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.created',
        entityType: 'job',
        entityId: job.id,
        branchId: branch.id,
        metadata: { jobNumber },
        ip: actor.ip,
      },
      tx,
    );
    return job;
  });
}

// ─── Read ───────────────────────────────────────────────────────────────────

const listSelect = {
  id: true,
  jobNumber: true,
  status: true,
  createdAt: true,
  imei: true,
  customer: { select: { name: true, phone: true } },
  brand: { select: { name: true } },
  deviceModel: { select: { name: true } },
  branch: { select: { id: true, code: true, name: true } },
  assignedEngineer: { select: { id: true, name: true } },
  faults: { select: { fault: { select: { name: true } } } },
} satisfies Prisma.JobSelect;

export async function list(query: JobListQuery, actor: Actor) {
  const s = query.search;
  const where: Prisma.JobWhereInput = {
    status: query.status,
    branchId: query.branchId,
    ...(query.engineerId && { assignedEngineerId: query.engineerId === 'none' ? null : query.engineerId }),
    ...jobScope(actor), // last, so it overrides any filter the caller is not allowed to widen
    ...(s && {
      OR: [
        { jobNumber: contains(s) },
        { imei: { startsWith: s } },
        { serialNumber: contains(s) },
        { customer: { phone: { startsWith: s } } },
        { customer: { name: contains(s) } },
      ],
    }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.job.findMany({
      where,
      select: listSelect,
      orderBy: { createdAt: query.sort === 'oldest' ? 'asc' : 'desc' },
      ...pageArgs(query),
    }),
    prisma.job.count({ where }),
  ]);
  const items: JobListItemDto[] = rows.map((j) => ({
    id: j.id,
    jobNumber: j.jobNumber,
    status: j.status,
    createdAt: j.createdAt.toISOString(),
    customer: j.customer,
    device: `${j.brand.name} ${j.deviceModel.name}`,
    imei: j.imei,
    faults: j.faults.map((f) => f.fault.name),
    branch: j.branch,
    assignedEngineer: j.assignedEngineer,
  }));
  return toPage(items, total, query);
}

const detailSelect = {
  id: true,
  jobNumber: true,
  status: true,
  createdAt: true,
  imei: true,
  serialNumber: true,
  color: true,
  customerComplaint: true,
  accessories: true,
  accessoriesOther: true,
  conditionNotes: true,
  branch: { select: { id: true, code: true, name: true } },
  customer: { select: { id: true, name: true, phone: true, altPhone: true, email: true, address: true } },
  brand: { select: { id: true, name: true } },
  deviceModel: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  assignedEngineer: { select: { id: true, name: true } },
  assignedAt: true,
  faults: { select: { fault: { select: { id: true, name: true } } }, orderBy: { fault: { name: 'asc' } } },
  photos: { select: { id: true, kind: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.JobSelect;

/** Loads a job's branch and enforces branch isolation. */
async function loadForAccess(id: string, actor: Actor) {
  const job = await prisma.job.findUnique({
    where: { id },
    select: { id: true, branchId: true, status: true, assignedEngineerId: true },
  });
  if (!job) throw HttpError.notFound('Job not found');
  assertBranchAccess(actor, job.branchId);
  if (isEngineer(actor) && job.assignedEngineerId !== actor.sub) throw HttpError.forbidden('This job is not assigned to you');
  return job;
}

export async function get(id: string, actor: Actor): Promise<JobDto> {
  await loadForAccess(id, actor);
  const j = await prisma.job.findUniqueOrThrow({ where: { id }, select: detailSelect });
  const { deviceModel, faults, photos, createdAt, assignedAt, ...rest } = j;
  const visiblePhotos = isEngineer(actor) ? photos.filter((p) => ENGINEER_VISIBLE_PHOTO_KINDS.includes(p.kind)) : photos;
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    assignedAt: assignedAt?.toISOString() ?? null,
    model: deviceModel,
    faults: faults.map((f) => f.fault),
    photos: visiblePhotos.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
  };
}

export async function history(id: string, actor: Actor): Promise<JobHistoryEntryDto[]> {
  await loadForAccess(id, actor);
  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'job', entityId: id },
    select: { id: true, action: true, createdAt: true, metadata: true, actor: { select: { id: true, name: true } } },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => ({ ...r, id: String(r.id), createdAt: r.createdAt.toISOString() }));
}

// ─── Photos ─────────────────────────────────────────────────────────────────

export async function addPhotos(jobId: string, kind: PhotoKind, files: Express.Multer.File[], actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  if (!files.length) throw HttpError.badRequest('No photos uploaded');

  // Validate every file before storing any of them.
  const prepared = files.map((f) => {
    const type = detectImageType(f.buffer);
    if (!type) throw HttpError.badRequest(`"${f.originalname}" is not a JPEG, PNG or WebP image`);
    return { buffer: f.buffer, ...type, key: `jobs/${jobId}/${randomUUID()}.${type.ext}` };
  });

  const stored: string[] = [];
  try {
    for (const p of prepared) {
      await storage.put(p.key, p.buffer);
      stored.push(p.key);
    }
    return await prisma.$transaction(async (tx) => {
      const created: JobPhotoDto[] = [];
      for (const p of prepared) {
        const row = await tx.jobPhoto.create({
          data: { jobId, kind, storageKey: p.key, mimeType: p.mime, sizeBytes: p.buffer.length, uploadedById: actor.sub },
          select: { id: true, kind: true, createdAt: true },
        });
        created.push({ ...row, createdAt: row.createdAt.toISOString() });
      }
      await recordAudit(
        {
          actorId: actor.sub,
          action: 'job.photos_added',
          entityType: 'job',
          entityId: jobId,
          branchId: job.branchId,
          metadata: { kind, count: created.length },
          ip: actor.ip,
        },
        tx,
      );
      return created;
    });
  } catch (err) {
    // Don't leave orphaned files behind if the DB write failed.
    await Promise.all(stored.map((k) => storage.delete(k).catch((e) => logger.warn({ err: e, key: k }, 'cleanup failed'))));
    throw err;
  }
}

export async function getPhoto(jobId: string, photoId: string, actor: Actor) {
  await loadForAccess(jobId, actor);
  const photo = await prisma.jobPhoto.findFirst({
    where: { id: photoId, jobId },
    select: { storageKey: true, mimeType: true, kind: true },
  });
  if (!photo || (isEngineer(actor) && !ENGINEER_VISIBLE_PHOTO_KINDS.includes(photo.kind))) {
    throw HttpError.notFound('Photo not found');
  }
  return { stream: await storage.get(photo.storageKey), mimeType: photo.mimeType };
}

// ─── Engineer assignment ────────────────────────────────────────────────────

/** Active engineers of a branch with their open workload, least busy first. */
export async function engineers(actor: Actor, requestedBranchId?: string): Promise<EngineerWorkloadDto[]> {
  const branchId = resolveBranchId(actor, requestedBranchId);
  const rows = await prisma.user.findMany({
    where: { branchId, role: ROLES.ENGINEER, isActive: true },
    select: {
      id: true,
      name: true,
      _count: { select: { jobsAssigned: { where: { status: { in: [...ENGINEER_OPEN_STATUSES] } } } } },
    },
    orderBy: { name: 'asc' },
  });
  return rows
    .map((r) => ({ id: r.id, name: r.name, openJobs: r._count.jobsAssigned }))
    .sort((a, b) => a.openJobs - b.openJobs);
}

export async function assign(jobId: string, engineerId: string, actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  if (!ASSIGNABLE_STATUSES.includes(job.status)) {
    throw HttpError.conflict('The engineer can no longer be changed at this stage');
  }
  if (job.assignedEngineerId === engineerId) throw HttpError.badRequest('Job is already assigned to this engineer');

  const engineer = await prisma.user.findFirst({
    where: { id: engineerId, role: ROLES.ENGINEER, isActive: true, branchId: job.branchId },
    select: { id: true, name: true },
  });
  if (!engineer) throw HttpError.badRequest('Invalid request', { engineerId: ['Select an active engineer of this branch'] });

  return prisma.$transaction(async (tx) => {
    // Guard against a concurrent assignment/status change since we read the job.
    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: job.status, assignedEngineerId: job.assignedEngineerId },
      data: { assignedEngineerId: engineer.id, assignedAt: new Date(), status: 'ASSIGNED' },
    });
    if (count === 0) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');

    const previous = job.assignedEngineerId
      ? await tx.user.findUnique({ where: { id: job.assignedEngineerId }, select: { id: true, name: true } })
      : null;
    await recordAudit(
      {
        actorId: actor.sub,
        action: previous ? 'job.reassigned' : 'job.assigned',
        entityType: 'job',
        entityId: jobId,
        branchId: job.branchId,
        metadata: { engineer, ...(previous && { previousEngineer: previous }) },
        ip: actor.ip,
      },
      tx,
    );
    return { assignedEngineer: engineer };
  });
}

// ─── Dashboard stats ────────────────────────────────────────────────────────

export async function stats(actor: Actor, branchId?: string): Promise<JobStatsDto> {
  const groups = await prisma.job.groupBy({
    by: ['status'],
    where: { ...(branchId && { branchId }), ...jobScope(actor) },
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
  for (const g of groups) byStatus[g.status] = g._count._all;
  return { byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0) };
}
