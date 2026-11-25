import {
  roundMoney,
  ROLES,
  type CentralOverviewDto,
  type ManualPoData,
  type PoProgressDto,
  type PoRowDto,
  type PoStage,
  type PurchaseOrderDto,
  type SupplyCreateData,
  type SupplyDto,
  type SupplyListQuery,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { businessRange, businessToday } from '../../lib/business-date.ts';
import { HttpError } from '../../lib/http-error.ts';
import { assertCan } from '../../lib/permissions.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { applyMovement } from '../inventory/stock.ts';

/**
 * Branch purchase orders and the Central Store that supplies them. A dispatch is a supply challan whose lines
 * are ordinary stock transfers: stock leaves Central on dispatch and reaches the branch when it counts it in.
 */

const isCentral = (actor: Actor) => actor.role === ROLES.CENTRAL_STOREKEEPER;
/** The supplier side: the Central Storekeeper (or Super Admin). */
const seesAllOrders = (actor: Actor) => isCentral(actor) || actor.role === ROLES.SUPER_ADMIN;

function assertSupplier(actor: Actor) {
  if (!seesAllOrders(actor)) throw HttpError.forbidden('Only the Central Storekeeper can do this');
}

export async function centralStore() {
  const store = await prisma.branch.findFirst({ where: { type: 'CENTRAL_STORE', isActive: true }, select: { id: true, code: true, name: true } });
  if (!store) throw HttpError.conflict('No Central Store yet — the Super Admin must add a branch of type "Central Store"');
  return store;
}

/** A branch orders for itself; Super Admin says which branch. The Central Store does not order from itself. */
export function orderingBranch(actor: Actor, requested?: string) {
  if (isCentral(actor)) throw HttpError.forbidden('The Central Store receives purchase orders; it does not raise them');
  const branchId = actor.branchId ?? requested;
  if (!branchId) throw HttpError.badRequest('Invalid request', { branchId: ['Select a branch'] });
  return branchId;
}

export async function nextPoNumber(tx: Prisma.TransactionClient, branchId: string) {
  const { code } = await tx.branch.findUniqueOrThrow({ where: { id: branchId }, select: { code: true } });
  const prefix = `PO-${code}-${businessToday().slice(2, 7).replace('-', '')}-`;
  const seq = (await tx.purchaseOrder.count({ where: { branchId, poNumber: { startsWith: prefix } } })) + 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// ─── Reading ────────────────────────────────────────────────────────────────

const supplySelect = {
  id: true,
  challanNumber: true,
  note: true,
  createdAt: true,
  createdBy: { select: { name: true } },
  toBranch: { select: { id: true, code: true, name: true } },
  purchaseOrder: { select: { poNumber: true } },
  lines: {
    select: {
      id: true,
      partId: true,
      quantity: true,
      unitRate: true,
      status: true,
      receivedQuantity: true,
      discrepancyNote: true,
      part: { select: { code: true, name: true } },
    },
    orderBy: { part: { code: 'asc' } },
  },
} satisfies Prisma.StockSupplySelect;

function toSupplyDto(s: Prisma.StockSupplyGetPayload<{ select: typeof supplySelect }>): SupplyDto {
  const lines = s.lines.map((l) => {
    const rate = l.unitRate?.toNumber() ?? 0;
    return {
      transferId: l.id,
      partId: l.partId,
      partCode: l.part.code,
      product: l.part.name,
      quantity: l.quantity,
      rate,
      amount: roundMoney(l.quantity * rate),
      status: l.status,
      receivedQuantity: l.receivedQuantity,
      discrepancyNote: l.discrepancyNote,
    };
  });
  const live = lines.filter((l) => l.status !== 'CANCELLED');
  return {
    id: s.id,
    challanNumber: s.challanNumber,
    poNumber: s.purchaseOrder?.poNumber ?? null,
    branch: s.toBranch,
    note: s.note,
    createdBy: s.createdBy.name,
    createdAt: s.createdAt.toISOString(),
    lines,
    totalQuantity: live.reduce((n, l) => n + l.quantity, 0),
    totalAmount: roundMoney(live.reduce((n, l) => n + l.amount, 0)),
  };
}

export const poSelect = {
  id: true,
  poNumber: true,
  branchId: true,
  fromDate: true,
  toDate: true,
  status: true,
  source: true,
  note: true,
  centralNote: true,
  lines: true,
  createdAt: true,
  forwardedAt: true,
  branch: { select: { code: true, name: true } },
  createdBy: { select: { name: true } },
  supplies: { select: supplySelect, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PurchaseOrderSelect;

type PoRecord = Prisma.PurchaseOrderGetPayload<{ select: typeof poSelect }>;

/** A short receipt puts the missing quantity back on the pending list; a cancelled line was never supplied. */
function progressOf(lines: PoRowDto[], supplies: SupplyDto[]): PoProgressDto[] {
  const sent = supplies.flatMap((s) => s.lines).filter((l) => l.status !== 'CANCELLED');
  return lines.map((line) => {
    const mine = sent.filter((l) => l.partId === line.partId);
    const supplied = mine.reduce((n, l) => n + (l.status === 'RECEIVED' ? (l.receivedQuantity ?? l.quantity) : l.quantity), 0);
    const received = mine.reduce((n, l) => n + (l.status === 'RECEIVED' ? (l.receivedQuantity ?? l.quantity) : 0), 0);
    return { partId: line.partId, ordered: line.quantity, supplied, received, pending: Math.max(0, line.quantity - supplied) };
  });
}

function stageOf(status: PoRecord['status'], progress: PoProgressDto[]): PoStage {
  if (status === 'DRAFT' || status === 'REJECTED' || status === 'CLOSED') return status;
  if (status === 'FORWARDED') return 'SENT';
  if (progress.every((p) => p.pending === 0)) return progress.every((p) => p.received >= p.ordered) ? 'COMPLETED' : 'IN_TRANSIT';
  return progress.some((p) => p.supplied > 0) ? 'PART_SUPPLIED' : 'ACCEPTED';
}

export function toPoDto(r: PoRecord): PurchaseOrderDto {
  const lines = r.lines as unknown as PoRowDto[];
  const supplies = r.supplies.map(toSupplyDto);
  const progress = progressOf(lines, supplies);
  return {
    id: r.id,
    poNumber: r.poNumber,
    branchId: r.branchId,
    branchCode: r.branch.code,
    branchName: r.branch.name,
    from: r.fromDate,
    to: r.toDate,
    status: r.status,
    source: r.source,
    stage: stageOf(r.status, progress),
    note: r.note,
    centralNote: r.centralNote,
    createdBy: r.createdBy.name,
    createdAt: r.createdAt.toISOString(),
    forwardedAt: r.forwardedAt?.toISOString() ?? null,
    lines,
    progress,
    supplies,
    totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
    totalAmount: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
  };
}

/** Branches see their own orders; the Central Store sees every order that has been sent to it. */
export async function list(actor: Actor, requested?: string): Promise<PurchaseOrderDto[]> {
  const where: Prisma.PurchaseOrderWhereInput = seesAllOrders(actor)
    ? { ...(requested && { branchId: requested }), ...(isCentral(actor) && { status: { not: 'DRAFT' } }) }
    : { branchId: orderingBranch(actor) };
  const rows = await prisma.purchaseOrder.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, select: poSelect });
  return rows.map(toPoDto);
}

async function loadPo(id: string, db: Prisma.TransactionClient = prisma) {
  const po = await db.purchaseOrder.findUnique({ where: { id }, select: poSelect });
  if (!po) throw HttpError.notFound('Purchase order not found');
  return toPoDto(po);
}

// ─── Branch side ────────────────────────────────────────────────────────────

export async function createManual(data: ManualPoData, actor: Actor) {
  await assertCan(actor, 'manage_po');
  const branchId = orderingBranch(actor, data.branchId);
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { type: true } });
  if (!branch || branch.type === 'CENTRAL_STORE') throw HttpError.badRequest('Invalid request', { branchId: ['Select a branch store'] });
  const parts = await prisma.part.findMany({
    where: { id: { in: data.lines.map((l) => l.partId) }, isActive: true, OR: [{ branchId: null }, { branchId }] },
    select: { id: true, code: true, name: true, category: true, subcategory: true, color: true, costPrice: true, brand: { select: { name: true } }, deviceModel: { select: { name: true } } },
  });
  const byId = new Map(parts.map((p) => [p.id, p]));
  const lines: PoRowDto[] = data.lines.map(({ partId, quantity }) => {
    const p = byId.get(partId);
    if (!p) throw HttpError.badRequest('Invalid request', { lines: ['Select active parts of this branch'] });
    const unitCost = p.costPrice?.toNumber() ?? 0;
    return {
      partId, partCode: p.code, product: p.name, category: p.category, subcategory: p.subcategory, color: p.color,
      brand: p.brand?.name ?? null, model: p.deviceModel?.name ?? null, quantity, unitCost, amount: roundMoney(quantity * unitCost),
    };
  });
  const today = businessToday();

  return prisma.$transaction(async (tx) => {
    const poNumber = await nextPoNumber(tx, branchId);
    const po = await tx.purchaseOrder.create({
      data: {
        poNumber, branchId, source: 'MANUAL', fromDate: today, toDate: today, note: data.note || null, lines, createdById: actor.sub,
        ...(data.send && { status: 'FORWARDED', forwardedAt: new Date() }),
      },
      select: poSelect,
    });
    await recordAudit({ actorId: actor.sub, action: data.send ? 'po.forwarded' : 'po.created', entityType: 'purchase_order', entityId: po.id, branchId, metadata: { poNumber, lines: lines.length, manual: true }, ip: actor.ip }, tx);
    return toPoDto(po);
  });
}

export async function send(id: string, actor: Actor) {
  await assertCan(actor, 'manage_po');
  const po = await loadPo(id);
  if (orderingBranch(actor, po.branchId) !== po.branchId) throw HttpError.forbidden();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.purchaseOrder.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'FORWARDED', forwardedAt: new Date() } });
    if (!count) throw HttpError.conflict('This purchase order was already sent');
    await recordAudit({ actorId: actor.sub, action: 'po.forwarded', entityType: 'purchase_order', entityId: id, branchId: po.branchId, metadata: { poNumber: po.poNumber }, ip: actor.ip }, tx);
  });
}

// ─── Central side ───────────────────────────────────────────────────────────

export async function accept(id: string, actor: Actor) {
  assertSupplier(actor);
  const po = await loadPo(id);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.purchaseOrder.updateMany({ where: { id, status: 'FORWARDED' }, data: { status: 'ACCEPTED', decidedAt: new Date() } });
    if (!count) throw HttpError.conflict('Only a newly sent purchase order can be accepted');
    await recordAudit({ actorId: actor.sub, action: 'po.accepted', entityType: 'purchase_order', entityId: id, branchId: po.branchId, metadata: { poNumber: po.poNumber }, ip: actor.ip }, tx);
  });
}

/** Reject an order nothing has been sent against; its job parts become available to order again. */
export async function reject(id: string, reason: string, actor: Actor) {
  assertSupplier(actor);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.purchaseOrder.updateMany({ where: { id, status: { in: ['FORWARDED', 'ACCEPTED'] } }, data: { status: 'REJECTED', centralNote: reason, decidedAt: new Date() } });
    if (!count) throw HttpError.conflict('This purchase order can no longer be rejected');
    // Checked after the update has locked the row, so a dispatch cannot slip in between.
    const po = await loadPo(id, tx);
    if (po.progress.some((p) => p.supplied > 0)) throw HttpError.conflict('Parts were already sent against this order — close it short instead');
    await tx.jobPart.updateMany({ where: { poId: id }, data: { poId: null } });
    await recordAudit({ actorId: actor.sub, action: 'po.rejected', entityType: 'purchase_order', entityId: id, branchId: po.branchId, metadata: { poNumber: po.poNumber, reason }, ip: actor.ip }, tx);
  });
}

export async function closeShort(id: string, reason: string, actor: Actor) {
  assertSupplier(actor);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.purchaseOrder.updateMany({ where: { id, status: 'ACCEPTED' }, data: { status: 'CLOSED', centralNote: reason, decidedAt: new Date() } });
    if (!count) throw HttpError.conflict('Only an accepted purchase order can be closed short');
    const po = await loadPo(id, tx);
    if (po.progress.every((p) => p.pending === 0)) throw HttpError.conflict('Nothing is pending on this order');
    await recordAudit({ actorId: actor.sub, action: 'po.closed_short', entityType: 'purchase_order', entityId: id, branchId: po.branchId, metadata: { poNumber: po.poNumber, reason }, ip: actor.ip }, tx);
  });
}

/** Dispatch parts from Central on a new challan. Against an order, never more than what is still pending. */
export async function supply(data: SupplyCreateData, actor: Actor): Promise<SupplyDto> {
  assertSupplier(actor);
  const central = await centralStore();

  return prisma.$transaction(async (tx) => {
    let toBranchId = data.toBranchId;
    if (data.purchaseOrderId) {
      // Updating first locks the order row, so two dispatches cannot both fill the same pending quantity.
      const { count } = await tx.purchaseOrder.updateMany({
        where: { id: data.purchaseOrderId, status: { in: ['FORWARDED', 'ACCEPTED'] } },
        data: { status: 'ACCEPTED', decidedAt: new Date() },
      });
      if (!count) throw HttpError.conflict('This purchase order is not open for supply');
      const po = await loadPo(data.purchaseOrderId, tx);
      const pending = new Map(po.progress.map((p) => [p.partId, p.pending]));
      for (const line of data.lines) {
        const left = pending.get(line.partId);
        if (left === undefined) throw HttpError.badRequest('Invalid request', { lines: ['A part is not on this purchase order'] });
        if (line.quantity > left) {
          const code = po.lines.find((l) => l.partId === line.partId)?.partCode ?? '';
          throw HttpError.badRequest('Invalid request', { lines: [`${code}: only ${left} pending on this order`] });
        }
      }
      toBranchId = po.branchId;
    }
    if (!toBranchId) throw HttpError.badRequest('Invalid request', { toBranchId: ['Select the branch'] });
    const to = await tx.branch.findUnique({ where: { id: toBranchId }, select: { id: true, code: true, isActive: true } });
    if (!to?.isActive || to.id === central.id) throw HttpError.badRequest('Invalid request', { toBranchId: ['Select an active branch'] });

    const parts = await tx.part.findMany({ where: { id: { in: data.lines.map((l) => l.partId) }, isActive: true }, select: { id: true, code: true, branchId: true } });
    const byId = new Map(parts.map((p) => [p.id, p]));
    const prefix = `CH-${businessToday().slice(2, 7).replace('-', '')}-`;
    const challanNumber = `${prefix}${String((await tx.stockSupply.count({ where: { challanNumber: { startsWith: prefix } } })) + 1).padStart(4, '0')}`;
    const challan = await tx.stockSupply.create({
      data: { challanNumber, purchaseOrderId: data.purchaseOrderId ?? null, toBranchId: to.id, note: data.note || null, createdById: actor.sub },
      select: { id: true },
    });

    for (const line of data.lines) {
      const part = byId.get(line.partId);
      if (!part || (part.branchId && part.branchId !== to.id)) {
        throw HttpError.badRequest('Invalid request', { lines: ['A part is inactive or belongs to another branch'] });
      }
      await tx.stockTransfer.create({
        data: { partId: part.id, fromBranchId: central.id, toBranchId: to.id, quantity: line.quantity, unitRate: line.rate, supplyId: challan.id, note: challanNumber, sentById: actor.sub },
      });
      try {
        await applyMovement(tx, { partId: part.id, branchId: central.id, type: 'TRANSFER_OUT', quantity: -line.quantity, unitCost: line.rate, reference: `${challanNumber} to ${to.code}`, actorId: actor.sub });
      } catch (err) {
        if (err instanceof HttpError) throw HttpError.conflict(`Not enough stock of ${part.code} in the Central Store`);
        throw err;
      }
    }
    await recordAudit({ actorId: actor.sub, action: 'supply.dispatched', entityType: 'stock_supply', entityId: challan.id, branchId: to.id, metadata: { challanNumber, lines: data.lines.length, to: to.code }, ip: actor.ip }, tx);
    return toSupplyDto(await tx.stockSupply.findUniqueOrThrow({ where: { id: challan.id }, select: supplySelect }));
  });
}

/** Challans in a period: the supply report, and each branch's received history. */
export async function supplies(query: SupplyListQuery, actor: Actor): Promise<SupplyDto[]> {
  const branchId = seesAllOrders(actor) ? query.branchId : orderingBranch(actor);
  const rows = await prisma.stockSupply.findMany({
    where: { createdAt: businessRange(query.from, query.to), ...(branchId && { toBranchId: branchId }) },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    select: supplySelect,
  });
  return rows.map(toSupplyDto);
}

export async function overview(actor: Actor): Promise<CentralOverviewDto> {
  assertSupplier(actor);
  const central = await centralStore();
  const [branches, parts, stocks, orders, transit] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true, type: { not: 'CENTRAL_STORE' } }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.part.findMany({ where: { isActive: true }, select: { id: true, branchId: true, reorderLevel: true, costPrice: true } }),
    prisma.partStock.findMany({ where: { part: { isActive: true } }, select: { partId: true, branchId: true, quantity: true } }),
    prisma.purchaseOrder.findMany({ where: { status: { in: ['FORWARDED', 'ACCEPTED'] } }, select: poSelect }),
    prisma.stockTransfer.findMany({ where: { status: 'SENT', OR: [{ fromBranchId: central.id }, { toBranchId: central.id }] }, select: { fromBranchId: true, toBranchId: true } }),
  ]);
  const open = orders.map(toPoDto).filter((p) => p.stage !== 'COMPLETED');
  const partById = new Map(parts.map((p) => [p.id, p]));
  const summary = (branchId: string) => {
    const mine = stocks.filter((s) => s.branchId === branchId);
    // "Low" covers parts the store has stocked before, so a new branch is not flagged for the whole catalogue.
    return {
      items: mine.filter((s) => s.quantity > 0).length,
      units: mine.reduce((n, s) => n + s.quantity, 0),
      value: roundMoney(mine.reduce((n, s) => n + s.quantity * (partById.get(s.partId)?.costPrice?.toNumber() ?? 0), 0)),
      low: mine.filter((s) => s.quantity <= (partById.get(s.partId)?.reorderLevel ?? 0)).length,
    };
  };
  return {
    newOrders: open.filter((p) => p.stage === 'SENT').length,
    ordersToSupply: open.filter((p) => p.stage === 'ACCEPTED' || p.stage === 'PART_SUPPLIED').length,
    linesInTransit: transit.filter((t) => t.fromBranchId === central.id).length,
    recallsInTransit: transit.filter((t) => t.toBranchId === central.id).length,
    central: { id: central.id, ...summary(central.id) },
    branches: branches.map((b) => ({
      ...b,
      ...summary(b.id),
      openOrders: open.filter((p) => p.branchId === b.id).length,
      inTransit: transit.filter((t) => t.toBranchId === b.id).length,
    })),
  };
}
