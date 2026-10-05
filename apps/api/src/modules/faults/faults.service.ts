import type { FaultCreateData, FaultDto, FaultUpdateData, ListQuery } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { Actor } from '../../lib/request-context.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import { recordAudit } from '../audit/audit.service.ts';

const select = { id: true, name: true, description: true, isActive: true } satisfies Prisma.FaultSelect;

export async function list(query: ListQuery) {
  const where: Prisma.FaultWhereInput = {
    isActive: query.isActive,
    ...(query.search && { name: contains(query.search) }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.fault.findMany({ where, select, orderBy: { name: 'asc' }, ...pageArgs(query) }),
    prisma.fault.count({ where }),
  ]);
  return toPage<FaultDto>(rows, total, query);
}

export async function create(data: FaultCreateData, actor: Actor): Promise<FaultDto> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.fault.create({ data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'fault.created', entityType: 'fault', entityId: row.id, metadata: data, ip: actor.ip },
      tx,
    );
    return row;
  });
}

export async function update(id: string, data: FaultUpdateData, actor: Actor): Promise<FaultDto> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.fault.update({ where: { id }, data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'fault.updated', entityType: 'fault', entityId: id, metadata: data, ip: actor.ip },
      tx,
    );
    return row;
  });
}
