import { DEVICE_EDITABLE_STATUSES, ROLES, type ImeiCheckDto, type JobEditData } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { storage } from '../../lib/storage.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { loadForAccess } from './jobs.service.ts';

/** Counter staff of the owning branch (or Super Admin) may correct a job sheet. */
async function loadForCounterEdit(id: string, actor: Actor) {
  const job = await loadForAccess(id, actor);
  const counter = actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.BRANCH_MANAGER || actor.role === ROLES.CCO;
  if (!counter || (actor.branchId && actor.branchId !== job.branchId)) throw HttpError.forbidden('Only the branch that took in the phone can edit the job sheet');
  if (job.status === 'DELIVERED') throw HttpError.conflict('This job is delivered — the job sheet can no longer be changed');
  return job;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function edit(id: string, data: JobEditData, actor: Actor) {
  const access = await loadForCounterEdit(id, actor);
  const cur = await prisma.job.findUniqueOrThrow({
    where: { id },
    select: {
      brandId: true,
      deviceModelId: true,
      color: true,
      customerComplaint: true,
      accessories: true,
      accessoriesOther: true,
      conditionNotes: true,
      diagnosedAt: true,
      customer: { select: { id: true, phone: true, name: true, altPhone: true, email: true, address: true } },
      faults: { select: { faultId: true, priceLabel: true, price: true, fault: { select: { name: true } } } },
      photos: { where: { kind: 'ID_PROOF' }, select: { id: true } },
    },
  });

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const jobData: Prisma.JobUncheckedUpdateInput = {};
  const track = (field: string, from: unknown, to: unknown) => {
    if (to !== undefined && !same(from, to)) changes[field] = { from: from ?? null, to: to ?? null };
  };

  // ── Device & faults (only before diagnosis) ──
  const brandId = data.brandId ?? cur.brandId;
  const deviceModelId = data.deviceModelId ?? cur.deviceModelId;
  const deviceChanged = brandId !== cur.brandId || deviceModelId !== cur.deviceModelId;
  if ((deviceChanged || data.faults) && (!DEVICE_EDITABLE_STATUSES.includes(access.status) || cur.diagnosedAt)) {
    throw HttpError.conflict('Device and faults can only be changed before the engineer diagnoses the phone');
  }
  let newFaults: { faultId: string; priceLabel: string | null; price: number | null }[] | null = null;
  if (deviceChanged) {
    const model = await prisma.deviceModel.findUnique({ where: { id: deviceModelId }, select: { brandId: true, isActive: true } });
    if (!model || !model.isActive || model.brandId !== brandId) {
      throw HttpError.badRequest('Invalid request', { deviceModelId: ['Select a valid model for this brand'] });
    }
    if (!data.faults) throw HttpError.badRequest('Invalid request', { faults: ['Re-select the faults (prices depend on the model)'] });
    jobData.brandId = brandId;
    jobData.deviceModelId = deviceModelId;
    track('device', { brandId: cur.brandId, deviceModelId: cur.deviceModelId }, { brandId, deviceModelId });
  }
  if (data.faults) {
    const faultIds = data.faults.map((f) => f.faultId);
    const priceIds = data.faults.flatMap((f) => (f.priceId ? [f.priceId] : []));
    const [faultRows, priceRows] = await Promise.all([
      prisma.fault.findMany({ where: { id: { in: faultIds }, isActive: true }, select: { id: true, name: true, requiresIdProof: true } }),
      prisma.servicePrice.findMany({ where: { id: { in: priceIds } }, select: { id: true, faultId: true, deviceModelId: true, label: true, price: true } }),
    ]);
    if (faultRows.length !== faultIds.length) throw HttpError.badRequest('Invalid request', { faults: ['One or more selected faults are invalid'] });
    const needsId = faultRows.filter((f) => f.requiresIdProof);
    if (needsId.length && !cur.photos.length) {
      throw HttpError.badRequest('Invalid request', {
        faults: [`Add the Aadhaar / ID proof photo first — required for: ${needsId.map((f) => f.name).join(', ')}`],
      });
    }
    const byId = new Map(priceRows.map((p) => [p.id, p]));
    newFaults = data.faults.map(({ faultId, priceId }) => {
      if (!priceId) return { faultId, priceLabel: null, price: null };
      const p = byId.get(priceId);
      if (!p || p.faultId !== faultId || p.deviceModelId !== deviceModelId) {
        throw HttpError.badRequest('Invalid request', { faults: ['A selected price is not valid for this model'] });
      }
      return { faultId, priceLabel: p.label, price: p.price.toNumber() };
    });
    const priced = newFaults.filter((f) => f.price !== null);
    jobData.estimatedAmount = priced.length ? priced.reduce((s, f) => s + f.price!, 0) : null;
    const names = new Map(faultRows.map((f) => [f.id, f.name]));
    track(
      'faults',
      cur.faults.map((f) => `${f.fault.name}${f.priceLabel ? ` (${f.priceLabel})` : ''}`),
      newFaults.map((f) => `${names.get(f.faultId)}${f.priceLabel ? ` (${f.priceLabel})` : ''}`),
    );
  }

  // ── Simple fields ──
  for (const field of ['color', 'customerComplaint', 'accessoriesOther', 'conditionNotes'] as const) {
    if (data[field] !== undefined) {
      track(field, cur[field], data[field]);
      jobData[field] = data[field];
    }
  }
  if (data.accessories) {
    track('accessories', cur.accessories, data.accessories);
    jobData.accessories = data.accessories;
  }

  // ── Customer ──
  const c = data.customer;
  const customerUpdate: Prisma.CustomerUpdateInput = {};
  if (c) {
    for (const field of ['name', 'altPhone', 'email', 'address'] as const) {
      if (c[field] !== undefined) {
        track(`customer.${field}`, cur.customer[field], c[field]);
        if (!same(cur.customer[field], c[field])) customerUpdate[field] = c[field] as string;
      }
    }
    if (c.phone && c.phone !== cur.customer.phone) track('customer.phone', cur.customer.phone, c.phone);
  }

  if (!Object.keys(changes).length) return { changed: 0 };

  await prisma.$transaction(async (tx) => {
    if (c?.phone && c.phone !== cur.customer.phone) {
      // Wrong mobile number entered: link the job to the right customer (creating it if new).
      const target = await tx.customer.upsert({
        where: { phone: c.phone },
        create: { phone: c.phone, name: c.name ?? cur.customer.name, altPhone: c.altPhone ?? null, email: c.email ?? null, address: c.address ?? null },
        update: customerUpdate,
        select: { id: true },
      });
      jobData.customerId = target.id;
    } else if (Object.keys(customerUpdate).length) {
      await tx.customer.update({ where: { id: cur.customer.id }, data: customerUpdate });
    }
    const { count } = await tx.job.updateMany({ where: { id, status: access.status }, data: jobData as Prisma.JobUncheckedUpdateManyInput });
    if (!count) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    if (newFaults) {
      await tx.jobFault.deleteMany({ where: { jobId: id } });
      await tx.jobFault.createMany({ data: newFaults.map((f) => ({ ...f, jobId: id })) });
    }
    await recordAudit(
      { actorId: actor.sub, action: 'job.edited', entityType: 'job', entityId: id, branchId: access.branchId, metadata: { changes } as Prisma.InputJsonValue, ip: actor.ip },
      tx,
    );
  });
  return { changed: Object.keys(changes).length };
}

// ─── Remove a wrongly uploaded photo ────────────────────────────────────────

export async function deletePhoto(jobId: string, photoId: string, reason: string, actor: Actor) {
  const access = await loadForCounterEdit(jobId, actor);
  const photo = await prisma.jobPhoto.findFirst({ where: { id: photoId, jobId }, select: { id: true, kind: true, storageKey: true } });
  if (!photo) throw HttpError.notFound('Photo not found');
  if (photo.kind === 'RWR') throw HttpError.conflict('RWR photos are proof of the returned condition and cannot be removed');
  if (photo.kind === 'ID_PROOF') {
    const [idPhotos, needsId] = await Promise.all([
      prisma.jobPhoto.count({ where: { jobId, kind: 'ID_PROOF' } }),
      prisma.jobFault.count({ where: { jobId, fault: { requiresIdProof: true } } }),
    ]);
    if (needsId && idPhotos <= 1) throw HttpError.conflict('This job needs an Aadhaar / ID proof — upload the correct photo before removing this one');
  }
  await prisma.$transaction(async (tx) => {
    await tx.jobPhoto.delete({ where: { id: photo.id } });
    await recordAudit(
      { actorId: actor.sub, action: 'job.photo_deleted', entityType: 'job', entityId: jobId, branchId: access.branchId, metadata: { kind: photo.kind, reason }, ip: actor.ip },
      tx,
    );
  });
  await storage.delete(photo.storageKey).catch((err) => logger.warn({ err, key: photo.storageKey }, 'photo file cleanup failed'));
}

// ─── Same IMEI elsewhere ────────────────────────────────────────────────────

/** Open jobs and earlier repairs of the same phone, across all branches (job number and branch only). */
export async function imeiCheck(imei: string, excludeJobId?: string): Promise<ImeiCheckDto> {
  const rows = await prisma.job.findMany({
    where: { imei, ...(excludeJobId && { id: { not: excludeJobId } }) },
    select: { id: true, jobNumber: true, status: true, createdAt: true, deliveredAt: true, rwrAt: true, branch: { select: { code: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return {
    open: rows
      .filter((r) => r.status !== 'DELIVERED')
      .map((r) => ({ id: r.id, jobNumber: r.jobNumber, branchCode: r.branch.code, status: r.status, createdAt: r.createdAt.toISOString() })),
    previous: rows
      .filter((r) => r.status === 'DELIVERED')
      .slice(0, 5)
      .map((r) => ({ id: r.id, jobNumber: r.jobNumber, branchCode: r.branch.code, deliveredAt: r.deliveredAt?.toISOString() ?? null, rwr: !!r.rwrAt })),
  };
}
