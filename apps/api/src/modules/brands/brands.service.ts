import type { BrandCreateData, BrandDto, BrandUpdateData, ListQuery } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { Actor } from '../../lib/request-context.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import { recordAudit } from '../audit/audit.service.ts';

const select = {
  id: true,
  name: true,
  isActive: true,
  _count: { select: { models: true } },
} satisfies Prisma.BrandSelect;

type Row = Prisma.BrandGetPayload<{ select: typeof select }>;

const toDto = ({ _count, ...b }: Row): BrandDto => ({ ...b, modelCount: _count.models });

export async function list(query: ListQuery) {
  const where: Prisma.BrandWhereInput = {
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
  return prisma.$transaction(async (tx) => {
    const row = await tx.brand.create({ data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'brand.created', entityType: 'brand', entityId: row.id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}

export async function update(id: string, data: BrandUpdateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.brand.update({ where: { id }, data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'brand.updated', entityType: 'brand', entityId: id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}
