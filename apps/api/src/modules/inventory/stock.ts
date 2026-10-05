import type { StockMovementType } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';

type Movement = {
  partId: string;
  branchId: string;
  type: StockMovementType;
  /** Signed: negative takes stock out. */
  quantity: number;
  actorId: string;
  unitCost?: number | null;
  jobId?: string | null;
  reference?: string | null;
  note?: string | null;
};

/**
 * The only way stock changes: updates the branch quantity and appends a ledger row in the caller's transaction.
 * Outgoing movements use a conditional update, so stock can never go negative even under concurrent issues.
 */
export async function applyMovement(tx: Prisma.TransactionClient, m: Movement) {
  const key = { partId_branchId: { partId: m.partId, branchId: m.branchId } };
  await tx.partStock.upsert({ where: key, create: { partId: m.partId, branchId: m.branchId, quantity: 0 }, update: {} });

  if (m.quantity < 0) {
    const { count } = await tx.partStock.updateMany({
      where: { partId: m.partId, branchId: m.branchId, quantity: { gte: -m.quantity } },
      data: { quantity: { increment: m.quantity } },
    });
    if (!count) throw HttpError.conflict('Not enough stock for this part at this branch');
  } else {
    await tx.partStock.update({ where: key, data: { quantity: { increment: m.quantity } } });
  }
  const { quantity: balanceAfter } = await tx.partStock.findUniqueOrThrow({ where: key, select: { quantity: true } });

  return tx.stockMovement.create({
    data: {
      partId: m.partId,
      branchId: m.branchId,
      type: m.type,
      quantity: m.quantity,
      balanceAfter,
      unitCost: m.unitCost ?? null,
      jobId: m.jobId ?? null,
      reference: m.reference ?? null,
      note: m.note ?? null,
      createdById: m.actorId,
    },
  });
}
