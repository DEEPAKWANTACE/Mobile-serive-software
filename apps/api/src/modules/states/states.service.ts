import type { ListQuery, StateCreateData, StateDto, StateUpdateData } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { Actor } from '../../lib/request-context.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import { recordAudit } from '../audit/audit.service.ts';

const select = {
  id: true,
  name: true,
  code: true,
  isActive: true,
  _count: { select: { cities: true } },
} satisfies Prisma.StateSelect;

type Row = Prisma.StateGetPayload<{ select: typeof select }>;

const toDto = ({ _count, ...s }: Row): StateDto => ({ ...s, cityCount: _count.cities });

export async function list(query: ListQuery) {
  const where: Prisma.StateWhereInput = {
    isActive: query.isActive,
    ...(query.search && { OR: [{ name: contains(query.search) }, { code: contains(query.search) }] }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.state.findMany({ where, select, orderBy: { name: 'asc' }, ...pageArgs(query) }),
    prisma.state.count({ where }),
  ]);
  return toPage(rows.map(toDto), total, query);
}

export async function create(data: StateCreateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.state.create({ data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'state.created', entityType: 'state', entityId: row.id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}

export async function update(id: string, data: StateUpdateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.state.update({ where: { id }, data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'state.updated', entityType: 'state', entityId: id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}
