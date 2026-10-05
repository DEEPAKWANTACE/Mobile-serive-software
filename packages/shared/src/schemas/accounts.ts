import { z } from 'zod';
import { ROLES, type Role } from '../roles.js';
import { PAYMENT_MODES, type PaymentMode } from './jobs.js';

/** Roles that see money (day book) and record expenses. */
export const ACCOUNTS_ROLES: readonly Role[] = [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.ACCOUNTS, ROLES.CCO];
/** Roles that may void an expense. */
export const EXPENSE_VOID_ROLES: readonly Role[] = [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.ACCOUNTS];

export const EXPENSE_CATEGORIES = [
  'Tea / snacks',
  'Travel / conveyance',
  'Courier',
  'Stationery',
  'Electricity',
  'Rent',
  'Salary / advance',
  'Spare purchase (cash)',
  'Repairs & maintenance',
  'Other',
] as const;

/** Business date, YYYY-MM-DD. */
export const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const expenseCreateSchema = z.object({
  branchId: z.uuid().nullish(), // required for Super Admin
  category: z.enum(EXPENSE_CATEGORIES, 'Select a category'),
  description: z.string().trim().min(2, 'Describe the expense').max(200),
  amount: z.coerce.number('Enter amount').min(0.01, 'Enter amount').max(10_000_000).multipleOf(0.01, 'Max 2 decimal places'),
  mode: z.enum(PAYMENT_MODES).default('CASH'),
  expenseDate: businessDate.optional(), // defaults to today
});
export type ExpenseCreateInput = z.input<typeof expenseCreateSchema>;
export type ExpenseCreateData = z.output<typeof expenseCreateSchema>;

export const expenseVoidSchema = z.object({ reason: z.string().trim().min(3, 'Enter a reason').max(200) });

/** Date range in business days (inclusive). Defaults to today. */
export const dayBookQuerySchema = z.object({
  branchId: z.uuid().optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
});
export type DayBookQuery = z.output<typeof dayBookQuerySchema>;

export type ExpenseDto = {
  id: string;
  category: string;
  description: string;
  amount: number;
  mode: PaymentMode;
  expenseDate: string;
  createdAt: string;
  createdBy: { id: string; name: string };
  voided: { at: string; by: string; reason: string | null } | null;
  branch: { code: string };
};

export type ModeTotals = Record<PaymentMode, number>;

export type DayBookDto = {
  from: string;
  to: string;
  /** Money received (advances + final payments), by mode. */
  received: ModeTotals & { total: number };
  refunds: ModeTotals & { total: number };
  expenses: ModeTotals & { total: number };
  /** received − refunds − expenses */
  net: number;
  /** Cash received − cash refunds − cash expenses: what should be in the drawer. */
  cashInHand: number;
  deliveredCount: number;
  invoicedTotal: number;
  payments: {
    id: string;
    kind: 'ADVANCE' | 'FINAL' | 'REFUND';
    mode: PaymentMode;
    amount: number;
    reference: string | null;
    createdAt: string;
    job: { id: string; jobNumber: string; customer: string };
    receivedBy: string;
  }[];
  expenseItems: ExpenseDto[];
};
