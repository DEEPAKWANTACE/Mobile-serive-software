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

type Db = Prisma.TransactionClient | typeof prisma;

async function assertModelExists(db: Db, id: string) {
  const exists = await db.deviceModel.count({ where: { id } });
  if (!exists) throw HttpError.notFound('Model not found');
}

async function readPrices(db: Db, deviceModelId: string): Promise<ModelPriceDto[]> {
  const rows = await db.servicePrice.findMany({
    where: { deviceModelId },
    select: { id: true, faultId: true, label: true, price: true },
    orderBy: [{ faultId: 'asc' }, { price: 'asc' }],
  });
  return rows.map((r) => ({ ...r, price: r.price.toNumber() }));
}

export async function getPrices(deviceModelId: string) {
  await assertModelExists(prisma, deviceModelId);
  return readPrices(prisma, deviceModelId);
}

const optionsKey = (opts: { label: string; price: number }[]) =>
  JSON.stringify([...opts].map((o) => [o.label, o.price]).sort());

/**
 * Replace the price options of each listed fault. Options whose label is unchanged keep their id
 * (so references stay stable); others are added/removed. Faults not listed are untouched.
 */
export async function setPrices(deviceModelId: string, { prices }: ModelPricesUpdateData, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await assertModelExists(tx, deviceModelId);
    const existing = await readPrices(tx, deviceModelId);

    const changes: { faultId: string; from: { label: string; price: number }[]; to: { label: string; price: number }[] }[] = [];
    for (const { faultId, options } of prices) {
      const current = existing.filter((p) => p.faultId === faultId);
      const from = current.map(({ label, price }) => ({ label, price }));
      if (optionsKey(from) === optionsKey(options)) continue;
      changes.push({ faultId, from, to: options });

      const keep = new Set(options.map((o) => o.label));
      await tx.servicePrice.deleteMany({ where: { deviceModelId, faultId, label: { notIn: [...keep] } } });
      for (const o of options) {
        await tx.servicePrice.upsert({
          where: { deviceModelId_faultId_label: { deviceModelId, faultId, label: o.label } },
          create: { deviceModelId, faultId, label: o.label, price: o.price },
          update: { price: o.price },
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
