import { randomUUID } from 'node:crypto';
import {
  ASSIGNABLE_STATUSES,
  ENGINEER_OPEN_STATUSES,
  ENGINEER_VISIBLE_PHOTO_KINDS,
  JOB_STATUSES,
  ROLES,
  roundMoney,
  type EngineerWorkloadDto,
  type JobStatsDto,
  type JobStatus,
} from '@msm/shared';
import type {
  JobCreateData,
  JobDeviceUpdateData,
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
import { jobPartSelect, toJobPartDto } from '../inventory/job-part.ts';
import { nextJobNumber } from './job-number.ts';

const isEngineer = (actor: Actor) => actor.role === ROLES.ENGINEER;

/**
 * Branch staff see jobs their branch owns (customer side) or that are physically with them (e.g. at L4).
 * Engineers only ever see jobs assigned to them.
 */
export function jobBranchScope(actor: Actor): Prisma.JobWhereInput {
  const scope = branchScope(actor); // throws for branch roles without a branch
  if (!scope.branchId) return {};
  return { OR: [{ branchId: scope.branchId }, { currentBranchId: scope.branchId }] };
}

function jobScope(actor: Actor): Prisma.JobWhereInput {
  return isEngineer(actor) ? { assignedEngineerId: actor.sub } : jobBranchScope(actor);
}

/** True if the actor's branch owns the job or currently has the phone (Super Admin: always). */
function canSeeBranch(actor: Actor, job: { branchId: string; currentBranchId: string }) {
  return !actor.branchId || actor.branchId === job.branchId || actor.branchId === job.currentBranchId;
}

/** Resolve which branch a branch-level query is about: own branch for staff, explicit for Super Admin. */
function resolveBranchId(actor: Actor, requested?: string) {
  if (actor.branchId) return actor.branchId;
  if (!requested) throw HttpError.badRequest('Invalid request', { branchId: ['Select a branch'] });
  return requested;
}

// ─── Photos (shared helpers) ────────────────────────────────────────────────

export type IncomingPhotos = Partial<Record<PhotoKind, Express.Multer.File[]>>;
type PreparedPhoto = { kind: PhotoKind; buffer: Buffer; mime: string; key: string };

/** Validates real image type of every file (never trust client mimetype) and assigns storage keys. */
export function preparePhotos(photos: IncomingPhotos): PreparedPhoto[] {
  const month = new Date().toISOString().slice(0, 7).replace('-', '/');
  return (Object.entries(photos) as [PhotoKind, Express.Multer.File[]][]).flatMap(([kind, files]) =>
    files.map((f) => {
      const type = detectImageType(f.buffer);
      if (!type) throw HttpError.badRequest(`"${f.originalname}" is not a JPEG, PNG or WebP image`);
      return { kind, buffer: f.buffer, mime: type.mime, key: `jobs/${month}/${randomUUID()}.${type.ext}` };
    }),
  );
}

/**
 * Writes files to storage, then runs `persist` (DB work). If anything fails, stored files are removed
 * so no orphaned images are left behind.
 */
export async function withStoredPhotos<T>(prepared: PreparedPhoto[], persist: () => Promise<T>): Promise<T> {
  const stored: string[] = [];
  try {
    for (const p of prepared) {
      await storage.put(p.key, p.buffer);
      stored.push(p.key);
    }
    return await persist();
  } catch (err) {
    await Promise.all(stored.map((k) => storage.delete(k).catch((e) => logger.warn({ err: e, key: k }, 'cleanup failed'))));
    throw err;
  }
}

export async function createPhotoRows(tx: Prisma.TransactionClient, jobId: string, prepared: PreparedPhoto[], actor: Actor) {
  const created: JobPhotoDto[] = [];
  for (const p of prepared) {
    const row = await tx.jobPhoto.create({
      data: { jobId, kind: p.kind, storageKey: p.key, mimeType: p.mime, sizeBytes: p.buffer.length, uploadedById: actor.sub },
      select: { id: true, kind: true, createdAt: true },
    });
    created.push({ ...row, createdAt: row.createdAt.toISOString() });
  }
  return created;
}

export async function findBranchEngineer(branchId: string, engineerId: string) {
  const engineer = await prisma.user.findFirst({
    where: { id: engineerId, role: ROLES.ENGINEER, isActive: true, branchId },
    select: { id: true, name: true },
  });
  if (!engineer) throw HttpError.badRequest('Invalid request', { engineerId: ['Select an active engineer of this branch'] });
  return engineer;
}

// ─── Create ─────────────────────────────────────────────────────────────────

/**
 * Creates a job sheet together with its photos in one request, so rules that depend on both
 * (Aadhaar required for flagged faults) are enforced and a job never exists without its photos.
 */
export async function create(data: JobCreateData, photos: IncomingPhotos, actor: Actor) {
  if (!actor.branchId) throw HttpError.forbidden('Only branch staff can create job sheets');
  const faultIds = data.faults.map((f) => f.faultId);
  const priceIds = data.faults.flatMap((f) => (f.priceId ? [f.priceId] : []));

  const [branch, model, faultRows, priceRows] = await Promise.all([
    prisma.branch.findUnique({ where: { id: actor.branchId }, select: { id: true, code: true } }),
    prisma.deviceModel.findUnique({ where: { id: data.deviceModelId }, select: { brandId: true, isActive: true } }),
    prisma.fault.findMany({ where: { id: { in: faultIds }, isActive: true }, select: { id: true, name: true, requiresIdProof: true } }),
    prisma.servicePrice.findMany({
      where: { id: { in: priceIds } },
      select: { id: true, faultId: true, deviceModelId: true, label: true, price: true },
    }),
  ]);
  if (!branch) throw HttpError.forbidden('Your branch was not found');
  if (!model || !model.isActive || model.brandId !== data.brandId) {
    throw HttpError.badRequest('Invalid request', { deviceModelId: ['Select a valid model for this brand'] });
  }
  if (faultRows.length !== faultIds.length) {
    throw HttpError.badRequest('Invalid request', { faults: ['One or more selected faults are invalid'] });
  }

  // Anti-theft rule: some faults (e.g. software unlock) require the customer's ID proof.
  const needsId = faultRows.filter((f) => f.requiresIdProof);
  if (needsId.length && !photos.ID_PROOF?.length) {
    throw HttpError.badRequest('Invalid request', {
      idProof: [`Aadhaar / ID proof photo is required for: ${needsId.map((f) => f.name).join(', ')}`],
    });
  }

  // Price options are looked up server-side; the client only sends which option was chosen.
  const priceById = new Map(priceRows.map((p) => [p.id, p]));
  const lines = data.faults.map(({ faultId, priceId }) => {
    if (!priceId) return { faultId, priceLabel: null, price: null };
    const option = priceById.get(priceId);
    if (!option || option.faultId !== faultId || option.deviceModelId !== data.deviceModelId) {
      throw HttpError.badRequest('Invalid request', { faults: ['A selected price is not valid for this model'] });
    }
    return { faultId, priceLabel: option.label, price: option.price };
  });
  const priced = lines.filter((l) => l.price !== null);
  const estimatedAmount = priced.length ? priced.reduce((sum, l) => sum + l.price!.toNumber(), 0) : null;

  const engineer = data.engineerId ? await findBranchEngineer(branch.id, data.engineerId) : null;
  const prepared = preparePhotos(photos);
  const { customer, faults: _faults, engineerId: _e, advance, ...jobFields } = data;

  return withStoredPhotos(prepared, () =>
    prisma.$transaction(async (tx) => {
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
          estimatedAmount,
          branchId: branch.id,
          currentBranchId: branch.id,
          customerId: savedCustomer.id,
          createdById: actor.sub,
          ...(engineer && { assignedEngineerId: engineer.id, assignedAt: new Date(), status: 'ASSIGNED' as const }),
          faults: { create: lines },
        },
        select: { id: true, jobNumber: true },
      });

      await createPhotoRows(tx, job.id, prepared, actor);

      const audit = (action: string, metadata: Prisma.InputJsonValue) =>
        recordAudit({ actorId: actor.sub, action, entityType: 'job', entityId: job.id, branchId: branch.id, metadata, ip: actor.ip }, tx);

      await audit('job.created', {
        jobNumber,
        estimatedAmount,
        photos: prepared.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.kind]: (acc[p.kind] ?? 0) + 1 }), {}),
      });
      if (engineer) await audit('job.assigned', { engineer });
      if (advance) {
        await tx.payment.create({
          data: {
            jobId: job.id,
            branchId: branch.id,
            kind: 'ADVANCE',
            mode: advance.mode,
            amount: advance.amount,
            reference: advance.reference,
            receivedById: actor.sub,
          },
        });
        await audit('payment.received', { kind: 'ADVANCE', mode: advance.mode, amount: advance.amount });
      }
      return job;
    }),
  );
}

// ─── Device details ─────────────────────────────────────────────────────────

/** Fill in / correct IMEI and serial after intake (e.g. a dead phone that now powers on). */
export async function updateDevice(id: string, data: JobDeviceUpdateData, actor: Actor) {
  const job = await loadForAccess(id, actor);
  // IMEI is printed on the invoice; it is frozen once the phone is handed back.
  if (job.status === 'DELIVERED') throw HttpError.conflict('This job is delivered — device details can no longer be changed');
  const before = await prisma.job.findUniqueOrThrow({ where: { id }, select: { imei: true, serialNumber: true } });
  return prisma.$transaction(async (tx) => {
    const after = await tx.job.update({ where: { id }, data, select: { imei: true, serialNumber: true } });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.device_updated',
        entityType: 'job',
        entityId: id,
        branchId: job.branchId,
        metadata: { from: before, to: after },
        ip: actor.ip,
      },
      tx,
    );
    return after;
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
  currentBranch: { select: { id: true, code: true } },
  location: true,
  assignedEngineer: { select: { id: true, name: true } },
  assignedAt: true,
  quotedAmount: true,
  sparePart: true,
  transfers: { where: { status: 'PENDING' }, select: { id: true } },
  payments: { select: { kind: true, amount: true } },
  faults: { select: { fault: { select: { name: true } } } },
} satisfies Prisma.JobSelect;

export async function list(query: JobListQuery, actor: Actor) {
  const s = query.search;
  const and: Prisma.JobWhereInput[] = [jobScope(actor)];
  if (query.status) and.push({ status: query.status });
  if (query.branchId) and.push({ OR: [{ branchId: query.branchId }, { currentBranchId: query.branchId }] });
  if (query.engineerId) and.push({ assignedEngineerId: query.engineerId === 'none' ? null : query.engineerId });
  // "here"/"owned" use the caller's branch, or the branch a Super Admin is looking at (franchise view).
  const viewBranch = actor.branchId ?? query.branchId;
  if (query.here && viewBranch) and.push({ currentBranchId: viewBranch, location: 'AT_BRANCH' });
  if (query.owned && viewBranch) and.push({ branchId: viewBranch });
  if (query.open) and.push({ status: { not: 'DELIVERED' } });
  if (query.minAgeDays !== undefined) and.push({ createdAt: { lte: new Date(Date.now() - query.minAgeDays * 86_400_000) } });
  if (s) {
    and.push({
      OR: [
        { jobNumber: contains(s) },
        { imei: { startsWith: s } },
        { serialNumber: contains(s) },
        { customer: { phone: { startsWith: s } } },
        { customer: { name: contains(s) } },
      ],
    });
  }
  const where: Prisma.JobWhereInput = { AND: and };
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
    assignedAt: j.assignedAt?.toISOString() ?? null,
    quotedAmount: j.quotedAmount?.toNumber() ?? null,
    sparePart: j.sparePart,
    hasPendingTransfer: j.transfers.length > 0,
    currentBranch: j.currentBranch,
    location: j.location,
    paid: roundMoney(j.payments.reduce((sum, p) => sum + (p.kind === 'REFUND' ? -1 : 1) * p.amount.toNumber(), 0)),
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
  branch: { select: { id: true, code: true, name: true, address: true, phone: true } },
  customer: { select: { id: true, name: true, phone: true, altPhone: true, email: true, address: true } },
  brand: { select: { id: true, name: true } },
  deviceModel: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  assignedEngineer: { select: { id: true, name: true } },
  assignedAt: true,
  diagnosisNotes: true,
  diagnosedAt: true,
  quotedAmount: true,
  approvedAmount: true,
  approvedAt: true,
  approvedBy: { select: { id: true, name: true } },
  customerResponse: true,
  repairedAt: true,
  readyAt: true,
  currentBranch: { select: { id: true, code: true, name: true, type: true } },
  location: true,
  movements: {
    select: {
      id: true,
      direction: true,
      reason: true,
      sentAt: true,
      receivedAt: true,
      receiveNote: true,
      fromBranch: { select: { id: true, code: true, name: true } },
      toBranch: { select: { id: true, code: true, name: true } },
      sentBy: { select: { name: true } },
      receivedBy: { select: { name: true } },
    },
    orderBy: { sentAt: 'asc' },
  },
  deliveredAt: true,
  deliveredTo: true,
  deliveryNote: true,
  deliveredBy: { select: { id: true, name: true } },
  invoice: { select: { id: true, invoiceNumber: true, total: true } },
  sparePart: true,
  spareRequestedAt: true,
  rwrReason: true,
  rwrNote: true,
  rwrAt: true,
  transfers: {
    where: { status: 'PENDING' },
    select: {
      id: true,
      reason: true,
      createdAt: true,
      fromEngineer: { select: { id: true, name: true } },
      toEngineer: { select: { id: true, name: true } },
    },
    take: 1,
  },
  parts: { select: jobPartSelect, orderBy: { requestedAt: 'asc' } },
  estimateLines: {
    select: {
      id: true,
      description: true,
      priceLabel: true,
      amount: true,
      fault: { select: { id: true, name: true } },
      part: { select: { id: true, code: true, name: true } },
    },
    orderBy: { sortOrder: 'asc' },
  },
  estimatedAmount: true,
  faults: {
    select: { priceLabel: true, price: true, fault: { select: { id: true, name: true } } },
    orderBy: { fault: { name: 'asc' } },
  },
  payments: {
    select: { id: true, kind: true, mode: true, amount: true, reference: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  photos: { select: { id: true, kind: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.JobSelect;

/** Loads a job's branch and enforces branch isolation. */
export async function loadForAccess(id: string, actor: Actor) {
  const job = await prisma.job.findUnique({
    where: { id },
    select: { id: true, branchId: true, currentBranchId: true, location: true, status: true, assignedEngineerId: true },
  });
  if (!job) throw HttpError.notFound('Job not found');
  if (!canSeeBranch(actor, job)) throw HttpError.forbidden();
  if (isEngineer(actor) && job.assignedEngineerId !== actor.sub) {
    // The receiving engineer may look at a job offered to them before accepting.
    const offered = await prisma.jobTransfer.count({ where: { jobId: id, toEngineerId: actor.sub, status: 'PENDING' } });
    if (!offered) throw HttpError.forbidden('This job is not assigned to you');
  }
  return job;
}

export async function get(id: string, actor: Actor): Promise<JobDto> {
  await loadForAccess(id, actor);
  const j = await prisma.job.findUniqueOrThrow({ where: { id }, select: detailSelect });
  const {
    deviceModel,
    faults,
    photos,
    payments,
    createdAt,
    assignedAt,
    estimatedAmount,
    diagnosedAt,
    quotedAmount,
    approvedAmount,
    approvedAt,
    repairedAt,
    readyAt,
    estimateLines,
    spareRequestedAt,
    rwrAt,
    transfers,
    parts,
    deliveredAt,
    invoice,
    movements,
    ...rest
  } = j;
  const pending = transfers[0];
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const visiblePhotos = isEngineer(actor) ? photos.filter((p) => ENGINEER_VISIBLE_PHOTO_KINDS.includes(p.kind)) : photos;
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    assignedAt: iso(assignedAt),
    diagnosedAt: iso(diagnosedAt),
    approvedAt: iso(approvedAt),
    repairedAt: iso(repairedAt),
    readyAt: iso(readyAt),
    spareRequestedAt: iso(spareRequestedAt),
    rwrAt: iso(rwrAt),
    deliveredAt: iso(deliveredAt),
    movements: movements.map((m) => ({
      id: m.id,
      direction: m.direction,
      from: m.fromBranch,
      to: m.toBranch,
      reason: m.reason,
      sentBy: m.sentBy.name,
      sentAt: m.sentAt.toISOString(),
      receivedBy: m.receivedBy?.name ?? null,
      receivedAt: iso(m.receivedAt),
      receiveNote: m.receiveNote,
    })),
    invoice: invoice && { ...invoice, total: invoice.total.toNumber() },
    pendingTransfer: pending
      ? { id: pending.id, from: pending.fromEngineer, to: pending.toEngineer, reason: pending.reason, createdAt: pending.createdAt.toISOString() }
      : null,
    model: deviceModel,
    estimatedAmount: estimatedAmount?.toNumber() ?? null,
    quotedAmount: quotedAmount?.toNumber() ?? null,
    approvedAmount: approvedAmount?.toNumber() ?? null,
    estimateLines: estimateLines.map((l) => ({ ...l, amount: l.amount.toNumber() })),
    parts: parts.map(toJobPartDto),
    faults: faults.map((f) => ({ ...f.fault, priceLabel: f.priceLabel, price: f.price?.toNumber() ?? null })),
    payments: payments.map((p) => ({ ...p, amount: p.amount.toNumber(), createdAt: p.createdAt.toISOString() })),
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
  const prepared = preparePhotos({ [kind]: files });

  return withStoredPhotos(prepared, () =>
    prisma.$transaction(async (tx) => {
      const created = await createPhotoRows(tx, jobId, prepared, actor);
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
    }),
  );
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
  if (job.location !== 'AT_BRANCH') throw HttpError.conflict('The phone is in transit — receive it before assigning an engineer');
  if (actor.branchId && actor.branchId !== job.currentBranchId) {
    throw HttpError.forbidden('Only the branch that has the phone can assign its engineer');
  }

  const engineer = await findBranchEngineer(job.currentBranchId, engineerId);

  return prisma.$transaction(async (tx) => {
    // Guard against a concurrent assignment/status change since we read the job.
    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: job.status, assignedEngineerId: job.assignedEngineerId },
      data: { assignedEngineerId: engineer.id, assignedAt: new Date(), status: 'ASSIGNED' },
    });
    if (count === 0) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    await tx.jobTransfer.updateMany({ where: { jobId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });

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

/**
 * Counts by status for jobs physically handled by the branch (engineers: their own jobs), plus how many of the
 * branch's own jobs are away at / travelling to or from the main office.
 */
export async function stats(actor: Actor, branchId?: string): Promise<JobStatsDto> {
  const branch = actor.branchId ?? branchId;
  const where: Prisma.JobWhereInput = isEngineer(actor)
    ? { assignedEngineerId: actor.sub }
    : branch
      ? { currentBranchId: branch }
      : {};
  const [groups, atL4] = await Promise.all([
    prisma.job.groupBy({ by: ['status'], where, _count: { _all: true } }),
    branch && !isEngineer(actor)
      ? prisma.job.count({ where: { branchId: branch, OR: [{ currentBranchId: { not: branch } }, { location: { not: 'AT_BRANCH' } }] } })
      : Promise.resolve(0),
  ]);
  const byStatus = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
  for (const g of groups) byStatus[g.status] = g._count._all;
  return { byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0), atL4 };
}
