import type { CatalogListQuery, FaultCategoryCreateData, FaultCategoryDto, FaultCategoryUpdateData } from '@msm/shared';
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
  sortOrder: true,
  isActive: true,
  _count: { select: { faults: true } },
} satisfies Prisma.FaultCategorySelect;

type Row = Prisma.FaultCategoryGetPayload<{ select: typeof select }>;

const toDto = ({ _count, ...c }: Row): FaultCategoryDto => ({ ...c, faultCount: _count.faults, isGlobal: c.branchId === null });

export async function list(query: CatalogListQuery, actor: Actor) {
  const where: Prisma.FaultCategoryWhereInput = {
    ...catalogWhere(actor, query),
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
  const branchId = writeCatalogBranch(actor, data.branchId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.faultCategory.create({ data: { name: data.name, sortOrder: data.sortOrder, branchId }, select });
    await recordAudit(
      { actorId: actor.sub, action: 'fault_category.created', entityType: 'fault_category', entityId: row.id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}

export async function update(id: string, data: FaultCategoryUpdateData, actor: Actor) {
  const current = await prisma.faultCategory.findUniqueOrThrow({ where: { id }, select: { branchId: true } });
  assertCatalogRow(actor, current.branchId);
  const { branchId: _ignored, ...changes } = data;
  return prisma.$transaction(async (tx) => {
    const row = await tx.faultCategory.update({ where: { id }, data: changes, select });
    await recordAudit(
      { actorId: actor.sub, action: 'fault_category.updated', entityType: 'fault_category', entityId: id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}
