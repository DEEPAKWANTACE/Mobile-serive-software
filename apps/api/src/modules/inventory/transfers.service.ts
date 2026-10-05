import { STORE_ROLES, type StockTransferCreateData, type StockTransferDto, type StockTransferListQuery } from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { assertBranchAccess } from '../../lib/access.ts';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { applyMovement } from './stock.ts';

/** Parts moving between branch stores: stock leaves on send, arrives on receive, returns on cancel. */

const select = {
  id: true,
  quantity: true,
  status: true,
  note: true,
  sentAt: true,
  receivedAt: true,
  part: { select: { id: true, code: true, name: true } },
  fromBranch: { select: { id: true, code: true, name: true } },
  toBranch: { select: { id: true, code: true, name: true } },
  sentBy: { select: { name: true } },
  receivedBy: { select: { name: true } },
} satisfies Prisma.StockTransferSelect;

const toDto = (t: Prisma.StockTransferGetPayload<{ select: typeof select }>): StockTransferDto => ({
  id: t.id,
  part: t.part,
  from: t.fromBranch,
  to: t.toBranch,
  quantity: t.quantity,
  status: t.status,
  note: t.note,
  sentBy: t.sentBy.name,
  sentAt: t.sentAt.toISOString(),
  receivedBy: t.receivedBy?.name ?? null,
  receivedAt: t.receivedAt?.toISOString() ?? null,
});

function assertStore(actor: Actor, branchId: string) {
  if (!STORE_ROLES.includes(actor.role)) throw HttpError.forbidden();
  assertBranchAccess(actor, branchId);
}

export async function send(data: StockTransferCreateData, actor: Actor) {
  const fromBranchId = actor.branchId ?? data.fromBranchId;
  if (!fromBranchId) throw HttpError.badRequest('Invalid request', { fromBranchId: ['Select the sending branch'] });
  assertStore(actor, fromBranchId);
  if (data.toBranchId === fromBranchId) throw HttpError.badRequest('Invalid request', { toBranchId: ['Choose a different branch'] });
  const [to, part] = await Promise.all([
    prisma.branch.findUnique({ where: { id: data.toBranchId }, select: { id: true, code: true, isActive: true } }),
    prisma.part.findUnique({ where: { id: data.partId }, select: { id: true, code: true, isActive: true } }),
  ]);
  if (!to?.isActive) throw HttpError.badRequest('Invalid request', { toBranchId: ['Select an active branch'] });
  if (!part?.isActive) throw HttpError.badRequest('Invalid request', { partId: ['Select an active part'] });

  return prisma.$transaction(async (tx) => {
    const row = await tx.stockTransfer.create({
      data: { partId: part.id, fromBranchId, toBranchId: to.id, quantity: data.quantity, note: data.note ?? null, sentById: actor.sub },
      select,
    });
    const m = await applyMovement(tx, {
      partId: part.id,
      branchId: fromBranchId,
      type: 'TRANSFER_OUT',
      quantity: -data.quantity,
      reference: `To ${to.code}`,
      note: data.note,
      actorId: actor.sub,
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'stock.transfer_sent',
        entityType: 'part',
        entityId: part.id,
        branchId: fromBranchId,
        metadata: { code: part.code, quantity: data.quantity, to: to.code, transferId: row.id, stockAfter: m.balanceAfter },
        ip: actor.ip,
      },
      tx,
    );
    return toDto(row);
  });
}

async function loadSent(id: string) {
  const t = await prisma.stockTransfer.findUnique({
    where: { id },
    select: { id: true, status: true, partId: true, quantity: true, fromBranchId: true, toBranchId: true, fromBranch: { select: { code: true } }, toBranch: { select: { code: true } }, part: { select: { code: true } } },
  });
  if (!t) throw HttpError.notFound('Transfer not found');
  if (t.status !== 'SENT') throw HttpError.conflict('This transfer was already received or cancelled');
  return t;
}

async function close(id: string, status: 'RECEIVED' | 'CANCELLED', actor: Actor) {
  const t = await loadSent(id);
  const receiving = status === 'RECEIVED';
  // Receiving branch confirms receipt; the sending branch may cancel while it is still in transit.
  assertStore(actor, receiving ? t.toBranchId : t.fromBranchId);

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.stockTransfer.updateMany({
      where: { id, status: 'SENT' },
      data: { status, receivedById: receiving ? actor.sub : null, receivedAt: new Date() },
    });
    if (!count) throw HttpError.conflict('This transfer was already received or cancelled');
    const m = await applyMovement(tx, {
      partId: t.partId,
      branchId: receiving ? t.toBranchId : t.fromBranchId,
      type: 'TRANSFER_IN',
      quantity: t.quantity,
      reference: receiving ? `From ${t.fromBranch.code}` : `Cancelled transfer to ${t.toBranch.code}`,
      actorId: actor.sub,
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: receiving ? 'stock.transfer_received' : 'stock.transfer_cancelled',
        entityType: 'part',
        entityId: t.partId,
        branchId: receiving ? t.toBranchId : t.fromBranchId,
        metadata: { code: t.part.code, quantity: t.quantity, transferId: id, stockAfter: m.balanceAfter },
        ip: actor.ip,
      },
      tx,
    );
    return { stockAfter: m.balanceAfter };
  });
}

export const receive = (id: string, actor: Actor) => close(id, 'RECEIVED', actor);
export const cancel = (id: string, actor: Actor) => close(id, 'CANCELLED', actor);

export async function list(query: StockTransferListQuery, actor: Actor) {
  if (!STORE_ROLES.includes(actor.role)) throw HttpError.forbidden();
  const branch = actor.branchId ?? query.branchId;
  const where: Prisma.StockTransferWhereInput =
    query.view === 'incoming'
      ? { status: 'SENT', ...(branch && { toBranchId: branch }) }
      : query.view === 'outgoing'
        ? { status: 'SENT', ...(branch && { fromBranchId: branch }) }
        : branch
          ? { OR: [{ fromBranchId: branch }, { toBranchId: branch }] }
          : {};
  const rows = await prisma.stockTransfer.findMany({ where, select, orderBy: { sentAt: 'desc' }, take: 200 });
  return rows.map(toDto);
}
