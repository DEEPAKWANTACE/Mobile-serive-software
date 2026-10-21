import type { FaultCreateData, FaultDto, FaultListQuery, FaultUpdateData } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { Actor } from '../../lib/request-context.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { assertCatalogRow, catalogWhere, writeCatalogBranch } from '../../lib/catalog-scope.ts';

const select = {
  id: true,
  branchId: true,
  name: true,
  description: true,
  requiresIdProof: true,
  isActive: true,
  category: { select: { id: true, name: true } },
} satisfies Prisma.FaultSelect;

const toDto = (row: Prisma.FaultGetPayload<{ select: typeof select }>): FaultDto => ({ ...row, isGlobal: row.branchId === null });

export async function list(query: FaultListQuery, actor: Actor) {
  const where: Prisma.FaultWhereInput = {
    ...catalogWhere(actor, query),
    isActive: query.isActive,
    categoryId: query.categoryId,
    ...(query.search && { name: contains(query.search) }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.fault.findMany({
      where,
      select,
      orderBy: [{ category: { sortOrder: 'asc' } }, { category: { name: 'asc' } }, { name: 'asc' }],
      ...pageArgs(query),
    }),
    prisma.fault.count({ where }),
  ]);
  return toPage<FaultDto>(rows.map(toDto), total, query);
}

export async function create(data: FaultCreateData, actor: Actor): Promise<FaultDto> {
  const branchId = writeCatalogBranch(actor, data.branchId);
  const { branchId: _ignored, ...fields } = data;
  return prisma.$transaction(async (tx) => {
    const row = await tx.fault.create({ data: { ...fields, branchId }, select });
    await recordAudit(
      { actorId: actor.sub, action: 'fault.created', entityType: 'fault', entityId: row.id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}

export async function update(id: string, data: FaultUpdateData, actor: Actor): Promise<FaultDto> {
  const current = await prisma.fault.findUniqueOrThrow({ where: { id }, select: { branchId: true } });
  assertCatalogRow(actor, current.branchId);
  const { branchId: _ignored, ...changes } = data;
  return prisma.$transaction(async (tx) => {
    const row = await tx.fault.update({ where: { id }, data: changes, select });
    await recordAudit(
      { actorId: actor.sub, action: 'fault.updated', entityType: 'fault', entityId: id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}
