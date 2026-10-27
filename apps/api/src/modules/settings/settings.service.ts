import { randomUUID } from 'node:crypto';
import type { AccessoryOptionDto, BranchWarrantyData, ShopSettingsData, ShopSettingsDto } from '@msm/shared';
import { HttpError } from '../../lib/http-error.ts';
import { detectImageType } from '../../lib/image-type.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { storage } from '../../lib/storage.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { assertCatalogRow, catalogWhere, writeCatalogBranch } from '../../lib/catalog-scope.ts';

const ID = 'default';
const DEFAULT_NAME = 'Dattagaru Mobile Shopee';
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
