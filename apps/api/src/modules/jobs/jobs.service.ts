import { randomUUID } from 'node:crypto';
import {
  ADMIN_REASSIGNABLE_STATUSES,
  ASSIGNABLE_STATUSES,
  CANCELLABLE_STATUSES,
  CLOSED_STATUSES,
  ENGINEER_OPEN_STATUSES,
  ENGINEER_VISIBLE_PHOTO_KINDS,
  JOB_STATUSES,
  ROLES,
  roundMoney,
  type EngineerWorkloadDto,
  type JobStatsDto,
  type JobTrendDto,
  type JobStatus,
} from '@msm/shared';
import { Prisma } from '../../generated/prisma/client.ts';
import type {
  JobCancelData,
  JobPaymentData,
  RepairNotesData,
  JobCreateData,
  JobDeviceUpdateData,
  JobDto,
  JobHistoryEntryDto,
  JobListItemDto,
  JobListQuery,
  JobPhotoDto,
  PhotoKind,
} from '@msm/shared';
import { assertBranchAccess, branchScope } from '../../lib/access.ts';
import { HttpError } from '../../lib/http-error.ts';
import { detectImageType } from '../../lib/image-type.ts';
import { logger } from '../../lib/logger.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { storage } from '../../lib/storage.ts';
import { businessRange, businessToday, startOfBusinessDay } from '../../lib/business-date.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { jobPartSelect, toJobPartDto } from '../inventory/job-part.ts';
import { nextJobNumber } from './job-number.ts';
import { encryptSecret, decryptSecret } from '../../lib/secret-box.ts';
import { endAssignment, recordStatus, startAssignment } from './history.ts';

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

/** Staff who may be recorded as having taken the phone in (counter roles of the branch, or a Super Admin). */
async function findInwardStaff(branchId: string, userId: string) {
  const u = await prisma.user.findFirst({
    where: {
      id: userId,
      isActive: true,
      OR: [{ role: ROLES.SUPER_ADMIN }, { branchId, role: { in: [ROLES.CCO, ROLES.BRANCH_MANAGER] } }],
    },
    select: { id: true },
  });
  if (!u) throw HttpError.badRequest('Invalid request', { inwardById: ['Select a CCO / manager of this branch'] });
  return u;
}

export async function findBranchEngineer(branchId: string, engineerId: string) {
  const engineer = await prisma.user.findFirst({
    where: { id: engineerId, role: ROLES.ENGINEER, isActive: true, branchId },
    select: { id: true, name: true },
  });
  if (!engineer) throw HttpError.badRequest('Invalid request', { engineerId: ['Select an active engineer of this branch'] });
  return engineer;
}

// ─── Money ──────────────────────────────────────────────────────────────────

type MoneySource = {
  status: JobStatus;
  invoice: { total: Prisma.Decimal } | null;
  quotedAmount: Prisma.Decimal | null;
  estimatedAmount: Prisma.Decimal | null;
  payments: { kind: 'ADVANCE' | 'FINAL' | 'REFUND'; amount: Prisma.Decimal }[];
};

/** Total = invoice (delivered) → engineer estimate → intake estimate; Balance = Total − Paid (negative = refund due). */
export function jobMoney(j: MoneySource) {
  const total = j.status === 'CANCELLED' ? 0 : (j.invoice?.total ?? j.quotedAmount ?? j.estimatedAmount)?.toNumber() ?? 0;
  const paid = roundMoney(j.payments.reduce((s, p) => s + (p.kind === 'REFUND' ? -1 : 1) * p.amount.toNumber(), 0));
  return { totalAmount: roundMoney(total), paidAmount: paid, balance: roundMoney(total - paid) };
}

// ─── Create ─────────────────────────────────────────────────────────────────

/**
 * Creates a job sheet together with its photos in one request, so rules that depend on both
 * (Aadhaar required for flagged faults) are enforced and a job never exists without its photos.
 */
export async function create(data: JobCreateData, photos: IncomingPhotos, actor: Actor) {
  // Branch staff create jobs for their own branch; Super Admin picks the branch.
  const branchId = actor.branchId ?? data.branchId;
  if (!branchId) throw HttpError.badRequest('Invalid request', { branchId: ['Select the branch'] });
  const faultIds = data.faults.map((f) => f.faultId);
  const priceIds = data.faults.flatMap((f) => (f.priceId ? [f.priceId] : []));

  const [branch, model, faultRows, priceRows] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, code: true, isActive: true } }),
    prisma.deviceModel.findUnique({ where: { id: data.deviceModelId }, select: { brandId: true, isActive: true } }),
    prisma.fault.findMany({ where: { id: { in: faultIds }, isActive: true }, select: { id: true, name: true, requiresIdProof: true } }),
    prisma.servicePrice.findMany({
      where: { id: { in: priceIds } },
      select: { id: true, faultId: true, deviceModelId: true, label: true, price: true },
    }),
  ]);
  if (!branch || !branch.isActive) throw HttpError.badRequest('Invalid request', { branchId: ['Select an active branch'] });
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
  // A total typed by the counter wins; otherwise the sum of the chosen price options.
  const estimatedAmount =
    data.totalAmount !== undefined && data.totalAmount !== null
      ? data.totalAmount
      : priced.length
        ? priced.reduce((sum, l) => sum + l.price!.toNumber(), 0)
        : null;

  const engineer = data.engineerId ? await findBranchEngineer(branch.id, data.engineerId) : null;
  const inwardById = data.inwardById ? (await findInwardStaff(branch.id, data.inwardById)).id : actor.sub;
  const prepared = preparePhotos(photos);
  const {
    customer,
    faults: _faults,
    engineerId: _e,
    advance,
    branchId: _b,
    inwardById: _i,
    devicePassword,
    totalAmount: _t,
    ...jobFields
  } = data;

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
          inwardById,
          devicePasswordEnc: devicePassword ? encryptSecret(devicePassword) : null,
          ...(engineer && { assignedEngineerId: engineer.id, assignedAt: new Date(), status: 'ASSIGNED' as const }),
          faults: { create: lines },
        },
        select: { id: true, jobNumber: true, status: true },
      });
      await recordStatus(tx, { jobId: job.id, from: null, to: job.status, actorId: actor.sub, engineerId: engineer?.id ?? null, remark: 'Job sheet created' });
      if (engineer) await startAssignment(tx, { jobId: job.id, engineerId: engineer.id, byId: actor.sub, endReason: 'REASSIGNED', note: 'Assigned at intake' });

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
  if (CLOSED_STATUSES.includes(job.status)) throw HttpError.conflict('This job is closed — device details can no longer be changed');
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
  customer: { select: { name: true, phone: true, city: true } },
  brand: { select: { name: true } },
  deviceModel: { select: { name: true } },
  branch: { select: { id: true, code: true, name: true } },
  currentBranch: { select: { id: true, code: true } },
  location: true,
  assignedEngineer: { select: { id: true, name: true, username: true } },
  assignedAt: true,
  quotedAmount: true,
  sparePart: true,
  assignments: { select: { engineer: { select: { name: true } }, endReason: true }, orderBy: { assignedAt: 'asc' } },
  serialNumber: true,
  customerComplaint: true,
  retailer: true,
  estimatedAmount: true,
  repairedAt: true,
  readyAt: true,
  deliveredAt: true,
  deliveryNote: true,
  invoice: { select: { total: true } },
  inwardBy: { select: { name: true } },
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
  if (query.open) and.push({ status: { notIn: ['DELIVERED', 'CANCELLED'] } });
  if (query.minAgeDays !== undefined) and.push({ createdAt: { lte: new Date(Date.now() - query.minAgeDays * 86_400_000) } });
  if (query.from || query.to) {
    const r = businessRange(query.from ?? '2000-01-01', query.to ?? businessToday());
    // "Out" lists are by delivery date (matches the dashboard's Total Out); everything else by intake date.
    and.push(query.delivered ? { deliveredAt: r } : { createdAt: r });
  }
  if (query.product) {
    and.push({ OR: [{ brand: { name: contains(query.product) } }, { deviceModel: { name: contains(query.product) } }] });
  }
  if (query.delivered) and.push({ status: 'DELIVERED' });
  if (query.balanceDue) and.push({ id: { in: await jobIdsWithBalanceDue() } });
  if (s) {
    and.push({
      OR: [
        { jobNumber: contains(s) },
        { customer: { city: contains(s) } },
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
    customer: { name: j.customer.name, phone: j.customer.phone },
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
    assignmentChain: [
      ...j.assignments.map((a) => a.engineer.name),
      ...(j.assignments.at(-1)?.endReason === 'UNASSIGNED' ? ['Admin'] : j.assignments.at(-1)?.endReason === 'SENT_TO_L4' ? ['L4'] : []),
    ].join(' → '),
    paid: jobMoney(j).paidAmount,
    totalAmount: jobMoney(j).totalAmount,
    balance: jobMoney(j).balance,
    city: j.customer.city,
    serialNumber: j.serialNumber,
    remark: j.customerComplaint,
    retailer: j.retailer,
    inwardBy: j.inwardBy?.name ?? null,
    repairedAt: j.repairedAt?.toISOString() ?? null,
    readyAt: j.readyAt?.toISOString() ?? null,
    deliveredAt: j.deliveredAt?.toISOString() ?? null,
    deliveryNote: j.deliveryNote,
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
  customer: { select: { id: true, name: true, phone: true, city: true, altPhone: true, email: true, address: true } },
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
  retailer: true,
  phoneDamaged: true,
  warranty: true,
  devicePasswordEnc: true,
  repairRemark: true,
  testingRemark: true,
  testingAt: true,
  cancelledAt: true,
  cancelReason: true,
  inwardBy: { select: { id: true, name: true } },
  statusHistory: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      remark: true,
      changedAt: true,
      engineer: { select: { name: true } },
      changedBy: { select: { name: true } },
    },
    orderBy: { id: 'asc' },
  },
  assignments: {
    select: {
      id: true,
      assignedAt: true,
      endedAt: true,
      endReason: true,
      note: true,
      engineer: { select: { id: true, name: true } },
      assignedBy: { select: { name: true } },
    },
    orderBy: { assignedAt: 'asc' },
  },
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
    devicePasswordEnc,
    testingAt,
    cancelledAt,
    statusHistory,
    assignments,
    ...rest
  } = j;
  // Unlock code: counter staff of the job's branches, or the engineer working on it — never an offered-only engineer.
  const mayReadPassword = !isEngineer(actor) || j.assignedEngineer?.id === actor.sub;
  const money = jobMoney({ status: j.status, invoice, quotedAmount, estimatedAmount, payments });
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
    testingAt: iso(testingAt),
    cancelledAt: iso(cancelledAt),
    devicePassword: mayReadPassword ? decryptSecret(devicePasswordEnc) : null,
    ...money,
    statusHistory: statusHistory.map((h) => ({
      id: String(h.id),
      from: h.fromStatus,
      to: h.toStatus,
      engineer: h.engineer?.name ?? null,
      by: h.changedBy?.name ?? null,
      remark: h.remark,
      at: h.changedAt.toISOString(),
    })),
    assignments: assignments.map((a) => ({
      id: a.id,
      engineer: a.engineer,
      assignedBy: a.assignedBy?.name ?? null,
      assignedAt: a.assignedAt.toISOString(),
      endedAt: iso(a.endedAt),
      endReason: a.endReason,
      note: a.note,
    })),
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
  const isManager = actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.BRANCH_MANAGER;
  // Counter staff assign before work starts; Admin / Branch Manager may also move a job that is already in progress.
  const allowed = isManager ? ADMIN_REASSIGNABLE_STATUSES : ASSIGNABLE_STATUSES;
  if (!allowed.includes(job.status)) throw HttpError.conflict('The engineer can no longer be changed at this stage');
  if (job.assignedEngineerId === engineerId) throw HttpError.badRequest('Job is already assigned to this engineer');
  if (job.location !== 'AT_BRANCH') throw HttpError.conflict('The phone is in transit — receive it before assigning an engineer');
  if (actor.branchId && actor.branchId !== job.currentBranchId) {
    throw HttpError.forbidden('Only the branch that has the phone can assign its engineer');
  }

  const engineer = await findBranchEngineer(job.currentBranchId, engineerId);
  const newStatus: JobStatus = job.status === 'RECEIVED' ? 'ASSIGNED' : job.status;

  return prisma.$transaction(async (tx) => {
    // Guard against a concurrent assignment/status change since we read the job.
    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: job.status, assignedEngineerId: job.assignedEngineerId },
      data: { assignedEngineerId: engineer.id, assignedAt: new Date(), status: newStatus },
    });
    if (count === 0) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    await tx.jobTransfer.updateMany({ where: { jobId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });

    const previous = job.assignedEngineerId
      ? await tx.user.findUnique({ where: { id: job.assignedEngineerId }, select: { id: true, name: true } })
      : null;
    await startAssignment(tx, { jobId, engineerId: engineer.id, byId: actor.sub, endReason: 'REASSIGNED', note: previous ? `Reassigned from ${previous.name}` : null });
    await recordStatus(tx, { jobId, from: job.status, to: newStatus, actorId: actor.sub, engineerId: engineer.id, remark: `Assigned to ${engineer.name}` });
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

/** Take the job back from its engineer (before diagnosis) — it returns to the "awaiting assignment" queue. */
export async function unassign(jobId: string, note: string | null | undefined, actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  if (actor.branchId && actor.branchId !== job.currentBranchId) throw HttpError.forbidden();
  if (job.status !== 'ASSIGNED' || !job.assignedEngineerId) {
    throw HttpError.conflict('Only a job not yet diagnosed can be taken back; otherwise reassign it to another engineer');
  }
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: 'ASSIGNED', assignedEngineerId: job.assignedEngineerId },
      data: { status: 'RECEIVED', assignedEngineerId: null, assignedAt: null },
    });
    if (!count) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    await tx.jobTransfer.updateMany({ where: { jobId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
    await endAssignment(tx, jobId, 'UNASSIGNED');
    await recordStatus(tx, { jobId, from: 'ASSIGNED', to: 'RECEIVED', actorId: actor.sub, engineerId: null, remark: note ?? 'Taken back from engineer' });
    await recordAudit({ actorId: actor.sub, action: 'job.unassigned', entityType: 'job', entityId: jobId, branchId: job.branchId, metadata: { note: note ?? null }, ip: actor.ip }, tx);
  });
}

// ─── Cancel / delete ────────────────────────────────────────────────────────

const isCounterRole = (actor: Actor) => actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.BRANCH_MANAGER || actor.role === ROLES.CCO;

/** Cancel a job that has not been repaired; any advance must be refunded in the same step. */
export async function cancel(jobId: string, data: JobCancelData, actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  if (!isCounterRole(actor) || (actor.branchId && actor.branchId !== job.branchId)) throw HttpError.forbidden('Only the branch that took in the phone can cancel it');
  if (!CANCELLABLE_STATUSES.includes(job.status)) throw HttpError.conflict('This job can no longer be cancelled — deliver it or return it without repair');
  if (job.location !== 'AT_BRANCH' || job.currentBranchId !== job.branchId) throw HttpError.conflict('The phone is not at the branch');
  const payments = await prisma.payment.findMany({ where: { jobId }, select: { kind: true, amount: true } });
  const paid = roundMoney(payments.reduce((s, p) => s + (p.kind === 'REFUND' ? -1 : 1) * p.amount.toNumber(), 0));
  if (paid > 0 && !data.refundMode) throw HttpError.badRequest('Invalid request', { refundMode: [`Refund ₹${paid.toFixed(2)} advance — choose how`] });

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: job.status },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: data.reason, statusBeforeHold: null },
    });
    if (!count) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    if (paid > 0) {
      await tx.payment.create({ data: { jobId, branchId: job.branchId, kind: 'REFUND', mode: data.refundMode!, amount: paid, reference: 'Job cancelled', receivedById: actor.sub } });
    }
    await tx.jobTransfer.updateMany({ where: { jobId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
    await tx.jobPart.updateMany({
      where: { jobId, status: { in: ['REQUESTED', 'NOT_AVAILABLE'] } },
      data: { status: 'CANCELLED', handledById: actor.sub, handledAt: new Date(), note: 'Job cancelled' },
    });
    await endAssignment(tx, jobId, 'CLOSED');
    await recordStatus(tx, { jobId, from: job.status, to: 'CANCELLED', actorId: actor.sub, remark: data.reason });
    await recordAudit(
      { actorId: actor.sub, action: 'job.cancelled', entityType: 'job', entityId: jobId, branchId: job.branchId, metadata: { reason: data.reason, refund: paid }, ip: actor.ip },
      tx,
    );
  });
}

/**
 * Permanently delete a job entered by mistake. Only allowed when nothing financial or physical depends on it
 * (no payments, invoice, issued parts, L4 movement); otherwise the job must be cancelled instead.
 */
export async function remove(jobId: string, actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  if (!(actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.BRANCH_MANAGER) || (actor.branchId && actor.branchId !== job.branchId)) {
    throw HttpError.forbidden('Only an Admin or the Branch Manager can delete a job');
  }
  const j = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      jobNumber: true,
      invoice: { select: { id: true } },
      photos: { select: { storageKey: true } },
      _count: { select: { payments: true, movements: true, parts: { where: { status: { in: ['ISSUED', 'RETURNED'] } } } } },
    },
  });
  if (j.invoice || j._count.payments || j._count.movements || j._count.parts) {
    throw HttpError.conflict('This job has payments, an invoice, issued parts or L4 movements — cancel it instead of deleting');
  }
  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.updateMany({ where: { jobId }, data: { jobId: null } });
    await tx.job.delete({ where: { id: jobId } });
    await recordAudit({ actorId: actor.sub, action: 'job.deleted', entityType: 'job', entityId: jobId, branchId: job.branchId, metadata: { jobNumber: j.jobNumber }, ip: actor.ip }, tx);
  });
  await Promise.all(j.photos.map((p) => storage.delete(p.storageKey).catch((err) => logger.warn({ err, key: p.storageKey }, 'photo cleanup failed'))));
}

// ─── Extra payment before delivery ──────────────────────────────────────────

export async function addPayment(jobId: string, data: JobPaymentData, actor: Actor) {
  const access = await loadForAccess(jobId, actor);
  if (!isCounterRole(actor) || (actor.branchId && actor.branchId !== access.branchId)) throw HttpError.forbidden('Only the counter of the owning branch takes payments');
  if (CLOSED_STATUSES.includes(access.status)) throw HttpError.conflict('This job is closed');
  const j = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { status: true, invoice: { select: { total: true } }, quotedAmount: true, estimatedAmount: true, payments: { select: { kind: true, amount: true } } },
  });
  const { totalAmount, balance } = jobMoney(j);
  // Without an estimate the amount is open-ended (advance); with one, never take more than what is due.
  if (totalAmount > 0 && data.amount > balance) {
    throw HttpError.badRequest('Invalid request', { amount: [balance > 0 ? `Balance is only ₹${balance.toFixed(2)}` : 'Nothing is due on this job'] });
  }
  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: { jobId, branchId: access.branchId, kind: 'ADVANCE', mode: data.mode, amount: data.amount, reference: data.reference ?? null, receivedById: actor.sub },
    });
    await recordAudit(
      { actorId: actor.sub, action: 'payment.received', entityType: 'job', entityId: jobId, branchId: access.branchId, metadata: { kind: 'ADVANCE', mode: data.mode, amount: data.amount }, ip: actor.ip },
      tx,
    );
  });
  return jobMoney({ ...j, payments: [...j.payments, { kind: 'ADVANCE', amount: new Prisma.Decimal(data.amount) }] });
}

// ─── Repair / testing notes (engineer) ──────────────────────────────────────

export async function updateRepairNotes(jobId: string, data: RepairNotesData, actor: Actor) {
  const job = await loadForAccess(jobId, actor);
  const isManager = actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.BRANCH_MANAGER;
  if (job.assignedEngineerId !== actor.sub && !isManager) throw HttpError.forbidden('Only the assigned engineer can update repair notes');
  if (CLOSED_STATUSES.includes(job.status)) throw HttpError.conflict('This job is closed');
  const current = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { repairRemark: true, testingRemark: true, testingAt: true } });
  await prisma.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: jobId },
      data: {
        ...(data.repairRemark !== undefined && { repairRemark: data.repairRemark }),
        ...(data.testingRemark !== undefined && { testingRemark: data.testingRemark, ...(data.testingRemark && !current.testingAt && { testingAt: new Date() }) }),
      },
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.repair_notes',
        entityType: 'job',
        entityId: jobId,
        branchId: job.branchId,
        metadata: { repairRemark: data.repairRemark ?? null, testingRemark: data.testingRemark ?? null },
        ip: actor.ip,
      },
      tx,
    );
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

// ─── Dashboard trend ────────────────────────────────────────────────────────

/** Jobs received vs delivered per business day for the caller's branch (or the chosen / all branches for Super Admin). */
export async function trend(actor: Actor, days: number, branchId?: string): Promise<JobTrendDto> {
  const branch = actor.branchId ?? branchId;
  const today = businessToday();
  const dates = Array.from({ length: days }, (_, i) => businessToday(new Date(startOfBusinessDay(today).getTime() - (days - 1 - i) * 86_400_000 + 43_200_000)));
  const range = businessRange(dates[0]!, today);
  const scope = branch ? { branchId: branch } : {};
  const [received, delivered] = await Promise.all([
    prisma.job.findMany({ where: { ...scope, createdAt: range }, select: { createdAt: true } }),
    prisma.job.findMany({ where: { ...scope, deliveredAt: range }, select: { deliveredAt: true } }),
  ]);
  const rows = new Map(dates.map((d) => [d, { date: d, received: 0, delivered: 0 }]));
  for (const j of received) {
    const r = rows.get(businessToday(j.createdAt));
    if (r) r.received++;
  }
  for (const j of delivered) {
    const r = rows.get(businessToday(j.deliveredAt!));
    if (r) r.delivered++;
  }
  return [...rows.values()];
}

/** Open jobs whose bill total is more than what has been paid (amount still to collect). */
async function jobIdsWithBalanceDue(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT j.id FROM jobs j
    LEFT JOIN invoices i ON i.job_id = j.id
    LEFT JOIN (
      SELECT job_id, SUM(CASE WHEN kind = 'REFUND' THEN -amount ELSE amount END) AS paid FROM payments GROUP BY job_id
    ) p ON p.job_id = j.id
    WHERE j.status NOT IN ('DELIVERED', 'CANCELLED')
      AND COALESCE(i.total, j.quoted_amount, j.estimated_amount, 0) - COALESCE(p.paid, 0) > 0`;
  return rows.map((r) => r.id);
}

/** Counter staff (CCO / Branch Manager) of a branch — choices for "inward by" on the job sheet. */
export async function inwardStaff(actor: Actor, requestedBranchId?: string) {
  const branchId = resolveBranchId(actor, requestedBranchId);
  return prisma.user.findMany({
    where: { branchId, isActive: true, role: { in: [ROLES.CCO, ROLES.BRANCH_MANAGER] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
}
