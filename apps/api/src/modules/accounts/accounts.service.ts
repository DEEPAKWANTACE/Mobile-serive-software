import {
  EXPENSE_VOID_ROLES,

  roundMoney,
  type DayBookDto,
  type DayBookQuery,
  type ExpenseCreateData,
  type ExpenseDto,
  type ModeTotals,
  type PaymentMode,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { assertBranchAccess, branchScope } from '../../lib/access.ts';
import { businessRange, businessToday } from '../../lib/business-date.ts';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';

const emptyTotals = (): ModeTotals & { total: number } => ({ CASH: 0, UPI: 0, CARD: 0, total: 0 });
const add = (t: ModeTotals & { total: number }, mode: PaymentMode, amount: number) => {
  t[mode] = roundMoney(t[mode] + amount);
  t.total = roundMoney(t.total + amount);
};

const expenseSelect = {
  id: true,
  category: true,
  description: true,
  amount: true,
  mode: true,
  expenseDate: true,
  createdAt: true,
  voidedAt: true,
  voidReason: true,
  createdBy: { select: { id: true, name: true } },
  voidedBy: { select: { name: true } },
  branch: { select: { code: true } },
} satisfies Prisma.ExpenseSelect;

type ExpenseRow = Prisma.ExpenseGetPayload<{ select: typeof expenseSelect }>;

const toExpenseDto = ({ voidedAt, voidedBy, voidReason, amount, createdAt, ...e }: ExpenseRow): ExpenseDto => ({
  ...e,
  amount: amount.toNumber(),
  createdAt: createdAt.toISOString(),
  voided: voidedAt ? { at: voidedAt.toISOString(), by: voidedBy?.name ?? '', reason: voidReason } : null,
});

export async function createExpense(data: ExpenseCreateData, actor: Actor) {
  const branchId = actor.branchId ?? data.branchId;
  if (!branchId) throw HttpError.badRequest('Invalid request', { branchId: ['Select a branch'] });
  assertBranchAccess(actor, branchId);
  const today = businessToday();
  const expenseDate = data.expenseDate ?? today;
  if (expenseDate > today) throw HttpError.badRequest('Invalid request', { expenseDate: ['Date cannot be in the future'] });

  return prisma.$transaction(async (tx) => {
    const row = await tx.expense.create({
      data: { branchId, category: data.category, description: data.description, amount: data.amount, mode: data.mode, expenseDate, createdById: actor.sub },
      select: expenseSelect,
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'expense.created',
        entityType: 'expense',
        entityId: row.id,
        branchId,
        metadata: { category: data.category, amount: data.amount, mode: data.mode, expenseDate },
        ip: actor.ip,
      },
      tx,
    );
    return toExpenseDto(row);
  });
}

export async function voidExpense(id: string, reason: string, actor: Actor) {
  if (!EXPENSE_VOID_ROLES.includes(actor.role)) throw HttpError.forbidden();
  const exp = await prisma.expense.findUnique({ where: { id }, select: { branchId: true, voidedAt: true, amount: true } });
  if (!exp) throw HttpError.notFound('Expense not found');
  assertBranchAccess(actor, exp.branchId);
  if (exp.voidedAt) throw HttpError.conflict('This expense is already voided');

  await prisma.$transaction(async (tx) => {
    await tx.expense.update({ where: { id }, data: { voidedAt: new Date(), voidedById: actor.sub, voidReason: reason } });
    await recordAudit(
      { actorId: actor.sub, action: 'expense.voided', entityType: 'expense', entityId: id, branchId: exp.branchId, metadata: { reason, amount: exp.amount.toNumber() }, ip: actor.ip },
      tx,
    );
  });
}

/** Money in/out for a branch (or all branches for Super Admin) over business dates. */
export async function dayBook(query: DayBookQuery, actor: Actor): Promise<DayBookDto> {
  const from = query.from ?? businessToday();
  const to = query.to ?? from;
  if (from > to) throw HttpError.badRequest('Invalid request', { from: ['From date is after To date'] });
  const branch: { branchId?: string } = actor.branchId ? branchScope(actor) : query.branchId ? { branchId: query.branchId } : {};
  const range = businessRange(from, to);

  const [payments, expenses, invoices] = await Promise.all([
    prisma.payment.findMany({
      where: { ...branch, createdAt: range },
      select: {
        id: true,
        kind: true,
        mode: true,
        amount: true,
        reference: true,
        createdAt: true,
        receivedBy: { select: { name: true } },
        job: { select: { id: true, jobNumber: true, customer: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.expense.findMany({ where: { ...branch, expenseDate: { gte: from, lte: to } }, select: expenseSelect, orderBy: { createdAt: 'asc' } }),
    prisma.invoice.aggregate({ where: { ...branch, createdAt: range }, _count: { _all: true }, _sum: { total: true } }),
  ]);

  const received = emptyTotals();
  const refunds = emptyTotals();
  const spent = emptyTotals();
  for (const p of payments) add(p.kind === 'REFUND' ? refunds : received, p.mode, p.amount.toNumber());
  const expenseItems = expenses.map(toExpenseDto);
  for (const e of expenseItems) if (!e.voided) add(spent, e.mode, e.amount);

  return {
    from,
    to,
    received,
    refunds,
    expenses: spent,
    net: roundMoney(received.total - refunds.total - spent.total),
    cashInHand: roundMoney(received.CASH - refunds.CASH - spent.CASH),
    deliveredCount: invoices._count._all,
    invoicedTotal: invoices._sum.total?.toNumber() ?? 0,
    payments: payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      mode: p.mode,
      amount: p.amount.toNumber(),
      reference: p.reference,
      createdAt: p.createdAt.toISOString(),
      job: { id: p.job.id, jobNumber: p.job.jobNumber, customer: p.job.customer.name },
      receivedBy: p.receivedBy.name,
    })),
    expenseItems,
  };
}

