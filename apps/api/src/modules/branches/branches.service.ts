import type { BranchCreateData, BranchDto, BranchListQuery, BranchUpdateData } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { Actor } from '../../lib/request-context.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import { recordAudit } from '../audit/audit.service.ts';

const select = {
  id: true,
  code: true,
  name: true,
  type: true,
  address: true,
  phone: true,
  isActive: true,
  city: { select: { id: true, name: true, state: { select: { id: true, name: true, code: true } } } },
  _count: { select: { users: true } },
} satisfies Prisma.BranchSelect;

type Row = Prisma.BranchGetPayload<{ select: typeof select }>;

const toDto = ({ _count, ...b }: Row): BranchDto => ({ ...b, userCount: _count.users });

export async function list(query: BranchListQuery) {
  const where: Prisma.BranchWhereInput = {
    isActive: query.isActive,
    type: query.type,
    cityId: query.cityId,
    ...(query.stateId && { city: { stateId: query.stateId } }),
    ...(query.search && { OR: [{ name: contains(query.search) }, { code: contains(query.search) }] }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.branch.findMany({ where, select, orderBy: { name: 'asc' }, ...pageArgs(query) }),
    prisma.branch.count({ where }),
  ]);
  return toPage(rows.map(toDto), total, query);
}

export async function create(data: BranchCreateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.branch.create({ data, select });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'branch.created',
        entityType: 'branch',
        entityId: row.id,
        branchId: row.id,
        metadata: data,
        ip: actor.ip,
      },
      tx,
    );
    return toDto(row);
  });
}

export async function update(id: string, data: BranchUpdateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.branch.update({ where: { id }, data, select });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'branch.updated',
        entityType: 'branch',
        entityId: id,
        branchId: id,
        metadata: data,
        ip: actor.ip,
      },
      tx,
    );
    return toDto(row);
  });
}
