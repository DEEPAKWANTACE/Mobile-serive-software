import type { BranchCreateData, BranchDto, BranchListQuery, BranchUpdateData } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
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

/** There is a single Central Store; a branch with job sheets or branch staff cannot become one (or stop being one). */
async function assertCentralStoreRules(next: { type?: string; isActive?: boolean }, id?: string) {
  const current = id ? await prisma.branch.findUniqueOrThrow({ where: { id }, select: { type: true, isActive: true } }) : null;
  const type = next.type ?? current?.type;
  const active = next.isActive ?? current?.isActive ?? true;
  if (type === 'CENTRAL_STORE' && active) {
    const other = await prisma.branch.findFirst({ where: { type: 'CENTRAL_STORE', isActive: true, ...(id && { id: { not: id } }) }, select: { name: true } });
    if (other) throw HttpError.badRequest('Invalid request', { type: [`There is already a Central Store: ${other.name}`] });
  }
  if (!id || !current || (type === 'CENTRAL_STORE') === (current.type === 'CENTRAL_STORE')) return;
  const [jobs, users] = await Promise.all([
    prisma.job.count({ where: { OR: [{ branchId: id }, { currentBranchId: id }] } }),
    prisma.user.count({ where: { branchId: id } }),
  ]);
  if (jobs || users) throw HttpError.badRequest('Invalid request', { type: ['A branch with job sheets or staff cannot change to or from Central Store — add a new branch instead'] });
}

export async function create(data: BranchCreateData, actor: Actor) {
  await assertCentralStoreRules(data);
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
  await assertCentralStoreRules(data, id);
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
