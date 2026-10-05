import { randomUUID } from 'node:crypto';
import type { ShopSettingsData, ShopSettingsDto } from '@msm/shared';
import { HttpError } from '../../lib/http-error.ts';
import { detectImageType } from '../../lib/image-type.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { storage } from '../../lib/storage.ts';
import { recordAudit } from '../audit/audit.service.ts';

const ID = 'default';
const DEFAULT_NAME = 'Mobile Service Centre';

export async function get(): Promise<ShopSettingsDto> {
  const s = await prisma.shopSettings.findUnique({ where: { id: ID } });
  return {
    shopName: s?.shopName ?? DEFAULT_NAME,
    legalName: s?.legalName ?? null,
    gstin: s?.gstin ?? null,
    address: s?.address ?? null,
    phone: s?.phone ?? null,
    email: s?.email ?? null,
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
