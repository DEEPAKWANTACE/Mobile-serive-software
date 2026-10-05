import type { PartCreateData, PartDto, PartListQuery, PartLookupDto, PartUpdateData } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';

export const partSelect = {
  id: true,
  code: true,
  name: true,
  sellingPrice: true,
  costPrice: true,
  reorderLevel: true,
  isActive: true,
  brand: { select: { id: true, name: true } },
  deviceModel: { select: { id: true, name: true } },
} satisfies Prisma.PartSelect;

type Row = Prisma.PartGetPayload<{ select: typeof partSelect }>;

export const toPartDto = ({ deviceModel, sellingPrice, costPrice, ...p }: Row): PartDto => ({
  ...p,
  model: deviceModel,
  sellingPrice: sellingPrice.toNumber(),
  costPrice: costPrice?.toNumber() ?? null,
});

export async function list(query: PartListQuery) {
  const where: Prisma.PartWhereInput = {
    isActive: query.isActive,
    brandId: query.brandId,
    deviceModelId: query.deviceModelId,
    ...(query.search && { OR: [{ code: contains(query.search) }, { name: contains(query.search) }] }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.part.findMany({ where, select: partSelect, orderBy: { code: 'asc' }, ...pageArgs(query) }),
    prisma.part.count({ where }),
  ]);
  return toPage(rows.map(toPartDto), total, query);
}

/** Find an active part by its code, with stock at a branch (caller's own branch unless given). */
export async function lookup(code: string, actor: Actor, branchId?: string): Promise<PartLookupDto> {
  const part = await prisma.part.findUnique({ where: { code }, select: partSelect });
  if (!part || !part.isActive) throw HttpError.notFound(`No active part with code ${code}`);
  const branch = actor.branchId ?? branchId;
  const stock = branch
    ? ((await prisma.partStock.findUnique({ where: { partId_branchId: { partId: part.id, branchId: branch } }, select: { quantity: true } }))
        ?.quantity ?? 0)
    : null;
  return { ...toPartDto(part), stock };
}

async function assertModelMatchesBrand(data: { brandId?: string | null; deviceModelId?: string | null }) {
  if (!data.deviceModelId) return;
  const model = await prisma.deviceModel.findUnique({ where: { id: data.deviceModelId }, select: { brandId: true } });
  if (!model || (data.brandId && model.brandId !== data.brandId)) {
    throw HttpError.badRequest('Invalid request', { deviceModelId: ['Model does not belong to the selected brand'] });
  }
}

export async function create(data: PartCreateData, actor: Actor) {
  await assertModelMatchesBrand(data);
  return prisma.$transaction(async (tx) => {
    const row = await tx.part.create({ data, select: partSelect });
    await recordAudit(
      { actorId: actor.sub, action: 'part.created', entityType: 'part', entityId: row.id, metadata: { ...data }, ip: actor.ip },
      tx,
    );
    return toPartDto(row);
  });
}

export async function update(id: string, data: PartUpdateData, actor: Actor) {
  await assertModelMatchesBrand(data);
  return prisma.$transaction(async (tx) => {
    const row = await tx.part.update({ where: { id }, data, select: partSelect });
    await recordAudit(
      { actorId: actor.sub, action: 'part.updated', entityType: 'part', entityId: id, metadata: { ...data }, ip: actor.ip },
      tx,
    );
    return toPartDto(row);
  });
}
