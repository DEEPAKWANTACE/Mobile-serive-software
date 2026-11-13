import { randomUUID } from 'node:crypto';
import {
  DEFAULT_JOB_LIST_COLUMNS,
  JOB_LIST_COLUMNS,
  ROLE_VALUES,
  type AccessoryOptionDto,
  type BranchWarrantyData,
  type DiagnosisFindingDto,
  type DiagnosisFindingSubcategoryDto,
  type DiagnosisFindingTypeDto,
  type JobListColumn,
  type JobListColumnsData,
  type JobListColumnsDto,
  type ShopSettingsData,
  type ShopSettingsDto,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
import { detectImageType } from '../../lib/image-type.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { storage } from '../../lib/storage.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { assertCatalogRow, catalogWhere, writeCatalogBranch } from '../../lib/catalog-scope.ts';

const ID = 'default';
const DEFAULT_NAME = 'Dattagaru Mobile';
const DEFAULT_EMAIL = 'dattagurumobile12345@gmail.com';

export async function get(): Promise<ShopSettingsDto> {
  const s = await prisma.shopSettings.findUnique({ where: { id: ID } });
  return {
    shopName: s?.shopName ?? DEFAULT_NAME,
    legalName: s?.legalName ?? null,
    gstin: s?.gstin ?? null,
    address: s?.address ?? null,
    phone: s?.phone ?? null,
    email: s?.email ?? DEFAULT_EMAIL,
    invoiceTerms: s?.invoiceTerms ?? null,
    hasLogo: !!s?.logoKey,
    logoVersion: s?.logoKey ? s.updatedAt.getTime().toString(36) : null,
  };
}

export async function update(data: ShopSettingsData, actor: Actor) {
  await prisma.$transaction(async (tx) => {
    await tx.shopSettings.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
    await recordAudit({ actorId: actor.sub, action: 'settings.updated', entityType: 'settings', entityId: ID, metadata: { ...data }, ip: actor.ip }, tx);
  });
  return get();
}

export async function setLogo(file: Express.Multer.File | undefined, actor: Actor) {
  if (!file) throw HttpError.badRequest('No logo uploaded');
  const type = detectImageType(file.buffer);
  if (!type) throw HttpError.badRequest('Logo must be a JPEG, PNG or WebP image');
  const key = `settings/logo-${randomUUID()}.${type.ext}`;
  await storage.put(key, file.buffer);
  const prev = await prisma.shopSettings.findUnique({ where: { id: ID }, select: { logoKey: true } });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.shopSettings.upsert({ where: { id: ID }, create: { id: ID, shopName: DEFAULT_NAME, logoKey: key }, update: { logoKey: key } });
      await recordAudit({ actorId: actor.sub, action: 'settings.logo_updated', entityType: 'settings', entityId: ID, ip: actor.ip }, tx);
    });
  } catch (err) {
    await storage.delete(key);
    throw err;
  }
  if (prev?.logoKey) await storage.delete(prev.logoKey).catch(() => undefined);
  return get();
}

export async function logo() {
  const s = await prisma.shopSettings.findUnique({ where: { id: ID }, select: { logoKey: true } });
  if (!s?.logoKey) throw HttpError.notFound('No logo');
  const ext = s.logoKey.split('.').pop();
  return { stream: await storage.get(s.logoKey), mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
}

export async function branchWarranty(actor: Actor, requested?: string) {
  const branchId = actor.branchId ?? requested;
  if (!branchId) throw HttpError.badRequest('Select a branch');
  const row = await prisma.branch.findUniqueOrThrow({ where: { id: branchId }, select: { defaultWarrantyPeriod: true, defaultWarrantyTerms: true } });
  return { warrantyPeriod: row.defaultWarrantyPeriod, warrantyTerms: row.defaultWarrantyTerms };
}

export async function updateBranchWarranty(data: BranchWarrantyData, actor: Actor) {
  if (!actor.branchId) throw HttpError.forbidden('Branch Manager account required');
  await prisma.branch.update({
    where: { id: actor.branchId },
    data: { defaultWarrantyPeriod: data.warrantyPeriod, defaultWarrantyTerms: data.warrantyTerms },
  });
  return branchWarranty(actor);
}

const accessorySelect = { id: true, name: true, sortOrder: true, isActive: true, branchId: true } as const;
const accessoryDto = (r: { id: string; name: string; sortOrder: number; isActive: boolean; branchId: string | null }): AccessoryOptionDto => ({ ...r, isGlobal: r.branchId === null });

export async function accessoryOptions(query: { branchId?: string; scope: 'effective' | 'branch' | 'global' }, actor: Actor) {
  const rows = await prisma.accessoryOption.findMany({
    where: catalogWhere(actor, { ...query, page: 1, pageSize: 100, sort: undefined, search: undefined, isActive: undefined } as never),
    select: accessorySelect,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return rows.map(accessoryDto);
}

export async function createAccessoryOption(data: { name: string; sortOrder: number; branchId?: string | null }, actor: Actor) {
  const branchId = writeCatalogBranch(actor, data.branchId);
  return accessoryDto(await prisma.accessoryOption.create({ data: { name: data.name, sortOrder: data.sortOrder, branchId }, select: accessorySelect }));
}

export async function updateAccessoryOption(id: string, data: { name?: string; sortOrder?: number; isActive?: boolean }, actor: Actor) {
  const current = await prisma.accessoryOption.findUniqueOrThrow({ where: { id }, select: { branchId: true } });
  assertCatalogRow(actor, current.branchId);
  return accessoryDto(await prisma.accessoryOption.update({ where: { id }, data, select: accessorySelect }));
}

const findingTypeSelect = { id: true, name: true, sortOrder: true, isActive: true } as const;

export async function diagnosisFindingTypes(includeInactive: boolean, actor: Actor): Promise<DiagnosisFindingTypeDto[]> {
  const all = includeInactive && actor.role === 'SUPER_ADMIN';
  return prisma.diagnosisFindingType.findMany({
    where: all ? {} : { isActive: true },
    select: findingTypeSelect,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function createDiagnosisFindingType(data: { name: string; sortOrder: number }, actor: Actor): Promise<DiagnosisFindingTypeDto> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.diagnosisFindingType.create({ data, select: findingTypeSelect });
    await recordAudit({ actorId: actor.sub, action: 'diagnosis_finding_type.created', entityType: 'diagnosis_finding_type', entityId: row.id, metadata: data, ip: actor.ip }, tx);
    return row;
  });
}

export async function updateDiagnosisFindingType(id: string, data: { name?: string; sortOrder?: number; isActive?: boolean }, actor: Actor): Promise<DiagnosisFindingTypeDto> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.diagnosisFindingType.update({ where: { id }, data, select: findingTypeSelect });
    await recordAudit({ actorId: actor.sub, action: 'diagnosis_finding_type.updated', entityType: 'diagnosis_finding_type', entityId: id, metadata: data, ip: actor.ip }, tx);
    return row;
  });
}

const subcategorySelect = { id: true, name: true, typeId: true, sortOrder: true, isActive: true } as const;

export async function diagnosisFindingSubcategories(includeInactive: boolean, actor: Actor): Promise<DiagnosisFindingSubcategoryDto[]> {
  const all = includeInactive && actor.role === 'SUPER_ADMIN';
  return prisma.diagnosisFindingSubcategory.findMany({
    where: all ? {} : { isActive: true, type: { isActive: true } },
    select: subcategorySelect,
    orderBy: [{ type: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function createDiagnosisFindingSubcategory(data: { name: string; typeId: string; sortOrder: number }, actor: Actor): Promise<DiagnosisFindingSubcategoryDto> {
  return prisma.$transaction(async (tx) => {
    await assertType(tx, data.typeId);
    const row = await tx.diagnosisFindingSubcategory.create({ data, select: subcategorySelect });
    await recordAudit({ actorId: actor.sub, action: 'diagnosis_finding_subcategory.created', entityType: 'diagnosis_finding_subcategory', entityId: row.id, metadata: data, ip: actor.ip }, tx);
    return row;
  });
}

export async function updateDiagnosisFindingSubcategory(id: string, data: { name?: string; sortOrder?: number; isActive?: boolean }, actor: Actor): Promise<DiagnosisFindingSubcategoryDto> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.diagnosisFindingSubcategory.update({ where: { id }, data, select: subcategorySelect });
    await recordAudit({ actorId: actor.sub, action: 'diagnosis_finding_subcategory.updated', entityType: 'diagnosis_finding_subcategory', entityId: id, metadata: data, ip: actor.ip }, tx);
    return row;
  });
}

const diagnosisFindingSelect = {
  id: true,
  label: true,
  sortOrder: true,
  isActive: true,
  type: { select: { id: true, name: true } },
  subcategory: { select: { id: true, name: true } },
} as const;

export async function diagnosisFindings(includeInactive: boolean, actor: Actor): Promise<DiagnosisFindingDto[]> {
  const all = includeInactive && actor.role === 'SUPER_ADMIN';
  return prisma.diagnosisFinding.findMany({
    // Engineers only see active presets under active types (and active sub categories).
    where: all ? {} : { isActive: true, type: { isActive: true }, OR: [{ subcategoryId: null }, { subcategory: { isActive: true } }] },
    select: diagnosisFindingSelect,
    orderBy: [{ type: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { label: 'asc' }],
  });
}

async function assertType(tx: Prisma.TransactionClient, typeId: string | undefined) {
  if (typeId && !(await tx.diagnosisFindingType.count({ where: { id: typeId } }))) throw HttpError.badRequest('Invalid request', { typeId: ['Select a valid type'] });
}

/** A finding's sub category must belong to the finding's type. */
async function assertSubcategory(tx: Prisma.TransactionClient, subcategoryId: string | null | undefined, typeId: string) {
  if (!subcategoryId) return;
  if (!(await tx.diagnosisFindingSubcategory.count({ where: { id: subcategoryId, typeId } }))) {
    throw HttpError.badRequest('Invalid request', { subcategoryId: ['Select a sub category of this type'] });
  }
}

export async function createDiagnosisFinding(data: { label: string; typeId: string; subcategoryId?: string | null; sortOrder: number }, actor: Actor): Promise<DiagnosisFindingDto> {
  return prisma.$transaction(async (tx) => {
    await assertType(tx, data.typeId);
    await assertSubcategory(tx, data.subcategoryId, data.typeId);
    const row = await tx.diagnosisFinding.create({ data, select: diagnosisFindingSelect });
    await recordAudit({ actorId: actor.sub, action: 'diagnosis_finding.created', entityType: 'diagnosis_finding', entityId: row.id, metadata: data, ip: actor.ip }, tx);
    return row;
  });
}

export async function updateDiagnosisFinding(id: string, data: { label?: string; typeId?: string; subcategoryId?: string | null; sortOrder?: number; isActive?: boolean }, actor: Actor): Promise<DiagnosisFindingDto> {
  return prisma.$transaction(async (tx) => {
    await assertType(tx, data.typeId);
    const current = await tx.diagnosisFinding.findUniqueOrThrow({ where: { id }, select: { typeId: true, subcategoryId: true } });
    const typeId = data.typeId ?? current.typeId;
    // Moving a finding to another type drops a sub category that belongs to the old type.
    if (data.subcategoryId === undefined && data.typeId && data.typeId !== current.typeId) data = { ...data, subcategoryId: null };
    await assertSubcategory(tx, data.subcategoryId, typeId);
    const row = await tx.diagnosisFinding.update({ where: { id }, data, select: diagnosisFindingSelect });
    await recordAudit({ actorId: actor.sub, action: 'diagnosis_finding.updated', entityType: 'diagnosis_finding', entityId: id, metadata: data, ip: actor.ip }, tx);
    return row;
  });
}

// ─── Job sheet list columns (per role) ──────────────────────────────────────

/** Saved matrix merged over the defaults; unknown keys from older versions are dropped. */
export async function jobListColumns(): Promise<JobListColumnsDto> {
  const row = await prisma.shopSettings.findUnique({ where: { id: ID }, select: { jobListColumns: true } });
  const saved = (row?.jobListColumns ?? {}) as Partial<Record<string, unknown>>;
  return Object.fromEntries(
    ROLE_VALUES.map((role) => {
      const value = saved[role];
      const columns = Array.isArray(value)
        ? value.filter((key): key is JobListColumn => JOB_LIST_COLUMNS.includes(key as JobListColumn))
        : DEFAULT_JOB_LIST_COLUMNS[role];
      return [role, columns];
    }),
  ) as JobListColumnsDto;
}

export async function updateJobListColumns(data: JobListColumnsData, actor: Actor): Promise<JobListColumnsDto> {
  await prisma.$transaction(async (tx) => {
    await tx.shopSettings.upsert({
      where: { id: ID },
      create: { id: ID, shopName: DEFAULT_NAME, email: DEFAULT_EMAIL, jobListColumns: data },
      update: { jobListColumns: data },
    });
    await recordAudit({ actorId: actor.sub, action: 'settings.job_list_columns', entityType: 'settings', entityId: ID, metadata: { ...data }, ip: actor.ip }, tx);
  });
  return jobListColumns();
}
