import type { BrandCreateData, BrandDto, BrandUpdateData, CatalogListQuery } from '@msm/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
import type { Actor } from '../../lib/request-context.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { assertCatalogRow, catalogWhere, writeCatalogBranch } from '../../lib/catalog-scope.ts';

const select = {
  id: true,
  branchId: true,
  name: true,
  isActive: true,
  _count: { select: { models: true } },
} satisfies Prisma.BrandSelect;

type Row = Prisma.BrandGetPayload<{ select: typeof select }>;

const toDto = ({ _count, ...b }: Row): BrandDto => ({ ...b, modelCount: _count.models, isGlobal: b.branchId === null });

export async function list(query: CatalogListQuery, actor: Actor) {
  const where: Prisma.BrandWhereInput = {
    ...catalogWhere(actor, query),
    isActive: query.isActive,
    ...(query.search && { name: contains(query.search) }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.brand.findMany({ where, select, orderBy: { name: 'asc' }, ...pageArgs(query) }),
    prisma.brand.count({ where }),
  ]);
  return toPage(rows.map(toDto), total, query);
}

export async function create(data: BrandCreateData, actor: Actor) {
  const branchId = writeCatalogBranch(actor, data.branchId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.brand.create({ data: { name: data.name, branchId }, select });
    await recordAudit(
      { actorId: actor.sub, action: 'brand.created', entityType: 'brand', entityId: row.id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}

export async function update(id: string, data: BrandUpdateData, actor: Actor) {
  const current = await prisma.brand.findUniqueOrThrow({ where: { id }, select: { branchId: true } });
  assertCatalogRow(actor, current.branchId);
  const { branchId: _ignored, ...changes } = data;
  return prisma.$transaction(async (tx) => {
    const row = await tx.brand.update({ where: { id }, data: changes, select });
    await recordAudit(
      { actorId: actor.sub, action: 'brand.updated', entityType: 'brand', entityId: id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Move a branch-only brand (and its models) into the Super Admin global defaults so every branch sees it.
 * If a global brand with the same name already exists, the models are merged into it; a model that already
 * exists there by name stays on the branch copy (old job sheets keep pointing at it).
 */
export async function promoteBrandToGlobal(db: Db, brandId: string) {
  const brand = await db.brand.findUniqueOrThrow({ where: { id: brandId }, select: { id: true, name: true, branchId: true } });
  if (brand.branchId === null) return { brand: brand.name, moved: 0, kept: 0, merged: false };
  const global = await db.brand.findFirst({ where: { branchId: null, name: { equals: brand.name, mode: 'insensitive' } }, select: { id: true } });
  if (!global) {
    await db.brand.update({ where: { id: brand.id }, data: { branchId: null } });
    const moved = await db.deviceModel.count({ where: { brandId: brand.id } });
    return { brand: brand.name, moved, kept: 0, merged: false };
  }
  const existing = new Set(
    (await db.deviceModel.findMany({ where: { brandId: global.id }, select: { name: true } })).map((m) => m.name.toLowerCase()),
  );
  const models = await db.deviceModel.findMany({ where: { brandId: brand.id }, select: { id: true, name: true } });
  let moved = 0;
  for (const m of models) {
    if (existing.has(m.name.toLowerCase())) continue;
    await db.deviceModel.update({ where: { id: m.id }, data: { brandId: global.id } });
    await db.part.updateMany({ where: { deviceModelId: m.id, brandId: brand.id }, data: { brandId: global.id } });
    existing.add(m.name.toLowerCase());
    moved += 1;
  }
  return { brand: brand.name, moved, kept: models.length - moved, merged: true };
}

/** Super Admin: make one brand, or every brand of a branch, part of the global defaults. */
export async function makeGlobal(target: { brandId?: string; branchId?: string }, actor: Actor) {
  const ids = target.brandId
    ? [target.brandId]
    : target.branchId
      ? (await prisma.brand.findMany({ where: { branchId: target.branchId }, select: { id: true } })).map((b) => b.id)
      : [];
  if (!ids.length) throw HttpError.badRequest('No branch brands to move');
  const results = [];
  for (const id of ids) {
    results.push(await prisma.$transaction((tx) => promoteBrandToGlobal(tx, id)));
  }
  await recordAudit({ actorId: actor.sub, action: 'brand.made_global', entityType: 'brand', entityId: target.brandId ?? target.branchId ?? '', metadata: { results }, ip: actor.ip });
  return { brands: results.length, models: results.reduce((s, r) => s + r.moved, 0), results };
}
