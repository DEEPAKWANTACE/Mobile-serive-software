import type {
  ModelCreateData,
  ModelDto,
  ModelListQuery,
  ModelPriceDto,
  ModelPricesUpdateData,
  ModelUpdateData,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
import type { Actor } from '../../lib/request-context.ts';
import { contains, pageArgs, toPage } from '../../lib/pagination.ts';
import { prisma } from '../../lib/prisma.ts';
import { recordAudit } from '../audit/audit.service.ts';

const select = {
  id: true,
  name: true,
  isActive: true,
  brand: { select: { id: true, name: true } },
  _count: { select: { prices: true } },
} satisfies Prisma.DeviceModelSelect;

type Row = Prisma.DeviceModelGetPayload<{ select: typeof select }>;

const toDto = ({ _count, ...m }: Row): ModelDto => ({ ...m, priceCount: _count.prices });

export async function list(query: ModelListQuery) {
  const where: Prisma.DeviceModelWhereInput = {
    isActive: query.isActive,
    brandId: query.brandId,
    ...(query.search && { OR: [{ name: contains(query.search) }, { brand: { name: contains(query.search) } }] }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.deviceModel.findMany({
      where,
      select,
      orderBy: [{ brand: { name: 'asc' } }, { name: 'asc' }],
      ...pageArgs(query),
    }),
    prisma.deviceModel.count({ where }),
  ]);
  return toPage(rows.map(toDto), total, query);
}

export async function create(data: ModelCreateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.deviceModel.create({ data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'model.created', entityType: 'device_model', entityId: row.id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}

export async function update(id: string, data: ModelUpdateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.deviceModel.update({ where: { id }, data, select });
    await recordAudit(
      { actorId: actor.sub, action: 'model.updated', entityType: 'device_model', entityId: id, metadata: data, ip: actor.ip },
      tx,
    );
    return toDto(row);
  });
}

// ─── Pricing ────────────────────────────────────────────────────────────────

async function assertModelExists(db: Prisma.TransactionClient | typeof prisma, id: string) {
  const exists = await db.deviceModel.count({ where: { id } });
  if (!exists) throw HttpError.notFound('Model not found');
}

async function readPrices(db: Prisma.TransactionClient | typeof prisma, deviceModelId: string): Promise<ModelPriceDto[]> {
  const rows = await db.servicePrice.findMany({ where: { deviceModelId }, select: { faultId: true, price: true } });
  return rows.map((r) => ({ faultId: r.faultId, price: r.price.toNumber() }));
}

export async function getPrices(deviceModelId: string) {
  await assertModelExists(prisma, deviceModelId);
  return readPrices(prisma, deviceModelId);
}

/** Apply a model's price list: set/update the given prices, remove those sent as null. Faults not listed are untouched. */
export async function setPrices(deviceModelId: string, { prices }: ModelPricesUpdateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await assertModelExists(tx, deviceModelId);
    const before = new Map((await readPrices(tx, deviceModelId)).map((p) => [p.faultId, p.price]));

    const changes: { faultId: string; from: number | null; to: number | null }[] = [];
    for (const { faultId, price } of prices) {
      const from = before.get(faultId) ?? null;
      if (from === price) continue;
      changes.push({ faultId, from, to: price });

      if (price === null) {
        await tx.servicePrice.delete({ where: { deviceModelId_faultId: { deviceModelId, faultId } } });
      } else {
        await tx.servicePrice.upsert({
          where: { deviceModelId_faultId: { deviceModelId, faultId } },
          create: { deviceModelId, faultId, price },
          update: { price },
        });
      }
    }

    if (changes.length) {
      await recordAudit(
        {
          actorId: actor.sub,
          action: 'model.prices_updated',
          entityType: 'device_model',
          entityId: deviceModelId,
          metadata: { changes },
          ip: actor.ip,
        },
        tx,
      );
    }
    return readPrices(tx, deviceModelId);
  });
}
