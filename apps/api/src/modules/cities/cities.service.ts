import type { CityCreateData, CityDto, CityListQuery, CityUpdateData } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { Actor } from '../../lib/request-context.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import { recordAudit } from '../audit/audit.service.ts';

const select = {
  id: true,
  name: true,
  isActive: true,
  state: { select: { id: true, name: true, code: true } },
  _count: { select: { branches: true } },
} satisfies Prisma.CitySelect;

type Row = Prisma.CityGetPayload<{ select: typeof select }>;

const toDto = ({ _count, ...c }: Row): CityDto => ({ ...c, branchCount: _count.branches });

export async function list(query: CityListQuery) {
  const where: Prisma.CityWhereInput = {
    isActive: query.isActive,
    stateId: query.stateId,
    ...(query.search && { name: contains(query.search) }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.city.findMany({ where, select, orderBy: [{ state: { name: 'asc' } }, { name: 'asc' }], ...pageArgs(query) }),
    prisma.city.count({ where }),
  ]);
  return toPage(rows.map(toDto), total, query);
}

export async function create(data: CityCreateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.city.create({ data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'city.created', entityType: 'city', entityId: row.id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}

export async function update(id: string, data: CityUpdateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.city.update({ where: { id }, data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'city.updated', entityType: 'city', entityId: id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}
