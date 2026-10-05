import type { FaultCategoryCreateData, FaultCategoryDto, FaultCategoryUpdateData, ListQuery } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { Actor } from '../../lib/request-context.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import { recordAudit } from '../audit/audit.service.ts';

const select = {
  id: true,
  name: true,
  sortOrder: true,
  isActive: true,
  _count: { select: { faults: true } },
} satisfies Prisma.FaultCategorySelect;

type Row = Prisma.FaultCategoryGetPayload<{ select: typeof select }>;

const toDto = ({ _count, ...c }: Row): FaultCategoryDto => ({ ...c, faultCount: _count.faults });

export async function list(query: ListQuery) {
  const where: Prisma.FaultCategoryWhereInput = {
    isActive: query.isActive,
    ...(query.search && { name: contains(query.search) }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.faultCategory.findMany({ where, select, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], ...pageArgs(query) }),
    prisma.faultCategory.count({ where }),
  ]);
  return toPage(rows.map(toDto), total, query);
}

export async function create(data: FaultCategoryCreateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.faultCategory.create({ data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'fault_category.created', entityType: 'fault_category', entityId: row.id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}

export async function update(id: string, data: FaultCategoryUpdateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.faultCategory.update({ where: { id }, data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'fault_category.updated', entityType: 'fault_category', entityId: id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}
