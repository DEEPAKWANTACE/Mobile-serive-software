import { z } from 'zod';
import { ROLES, type Role } from '../roles.js';
import { businessDate } from './accounts.js';

/** Branch Manager insight reports (read-only; Super Admin can look at any branch). */
export const MANAGER_ROLES: readonly Role[] = [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER];

const base = { branchId: z.uuid().optional() };

export const pendingJobsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(15),
  status: z.string().trim().max(40).optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
  ...base,
});
export type PendingJobsQuery = z.output<typeof pendingJobsQuerySchema>;

export const managerRangeQuerySchema = z.object({ from: businessDate, to: businessDate, ...base });
export type ManagerRangeQuery = z.output<typeof managerRangeQuerySchema>;

export type PendingJobRowDto = {
  id: string;
  jobNumber: string;
  customer: string;
  model: string;
  imei: string | null;
  loginDate: string;
  status: string;
  pendingDays: number;
  engineer: string | null;
  branchCode: string;
};

export type DiagnosisPendingRowDto = {
  id: string;
  jobNumber: string;
  loginDate: string;
  engineer: string | null;
  customer: string;
  model: string;
  status: string;
  /** SAME_DAY = logged today, not yet diagnosed; CARRIED_OVER = an earlier day's job still undiagnosed. */
  kind: 'SAME_DAY' | 'CARRIED_OVER';
  /** Latest Branch Manager remark on why it is not diagnosed. */
  remark: string | null;
  daysOpen: number;
  /** Why it is not diagnosed, as far as the system can tell. */
  reason: string;
  branchCode: string;
};

export type PoRowDto = {
  partId: string;
  partCode: string;
  product: string;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
  quantity: number;
  unitCost: number;
  amount: number;
};

export type ProfitLossRowDto = { key: string; label: string; quantity: number; purchase: number; selling: number; profit: number };

export type ProfitLossDto = {
  partsConsumed: number;
  purchaseValue: number;
  sellingValue: number;
  grossProfit: number;
  expenses: number;
  discounts: number;
  refunds: number;
  netProfit: number;
  byBrand: ProfitLossRowDto[];
  byCategory: ProfitLossRowDto[];
  byModel: ProfitLossRowDto[];
  byPartCode: ProfitLossRowDto[];
  byEngineer: ProfitLossRowDto[];
};

// ─── Alerts ─────────────────────────────────────────────────────────────────

export type AlertPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type ManagerAlertDto = { key: string; label: string; count: number; priority: AlertPriority; link: string };

// ─── Overview (dashboard) ───────────────────────────────────────────────────

export type ManagerOverviewDto = {
  from: string;
  to: string;
  jobsReceived: number;
  jobsCompleted: number;
  jobsPending: number;
  collection: { cash: number; online: number; total: number };
  expenses: number;
  pendingPayments: number;
  pendingApprovals: number;
  stock: { items: number; units: number; value: number; lowCount: number };
  engineers: { name: string; assigned: number; completed: number; open: number }[];
  ccos: { name: string; jobSheets: number; calls: number }[];
};

// ─── Calling / happy calling ────────────────────────────────────────────────

export type CallingReportRowDto = {
  id: string;
  jobId: string;
  jobNumber: string;
  customer: string;
  phone: string;
  at: string;
  cco: string;
  purpose: string;
  outcome: string;
  /** true when the customer actually picked up. */
  connected: boolean;
  discussion: string | null;
  feedback: string | null;
  satisfaction: number | null;
  nextFollowUpAt: string | null;
  source: string;
};

export type CallingPendingRowDto = { jobId: string; jobNumber: string; customer: string; phone: string; status: string; daysWaiting: number; branchCode: string };

export type CallingReportDto = {
  summary: { assigned: number; attempted: number; connected: number; notConnected: number; avgSatisfaction: number | null; followUpDue: number; pending: number };
  rows: CallingReportRowDto[];
  pending: CallingPendingRowDto[];
};

// ─── Purchase orders ────────────────────────────────────────────────────────

export const poCreateSchema = z.object({ from: businessDate, to: businessDate, branchId: z.uuid().optional(), note: z.string().trim().max(300).optional() });
export type PoCreateData = z.output<typeof poCreateSchema>;
export const poListQuerySchema = z.object({ branchId: z.uuid().optional() });
export type PoLineDto = PoRowDto;
export type PurchaseOrderDto = {
  id: string;
  poNumber: string;
  branchCode: string;
  from: string;
  to: string;
  status: PoStatus;
  source: 'CONSUMPTION' | 'MANUAL';
  /** Where the order stands, including supply progress. */
  stage: PoStage;
  branchId: string;
  branchName: string;
  /** Central Store's reason for rejecting or closing short. */
  centralNote: string | null;
  /** Per ordered part: dispatched (not cancelled), counted in by the branch, and still to be sent. */
  progress: PoProgressDto[];
  supplies: SupplyDto[];
  note: string | null;
  createdBy: string;
  createdAt: string;
  forwardedAt: string | null;
  lines: PoRowDto[];
  totalQuantity: number;
  totalAmount: number;
};

export const PO_STATUSES = ['DRAFT', 'FORWARDED', 'ACCEPTED', 'REJECTED', 'CLOSED'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export const PO_STAGE_LABELS = {
  DRAFT: 'Draft',
  SENT: 'Sent to Central',
  ACCEPTED: 'Accepted',
  PART_SUPPLIED: 'Part supplied',
  IN_TRANSIT: 'Supplied · in transit',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  CLOSED: 'Closed short',
} as const;
export type PoStage = keyof typeof PO_STAGE_LABELS;
export type PoProgressDto = { partId: string; ordered: number; supplied: number; received: number; pending: number };

export type SupplyLineDto = {
  transferId: string;
  partId: string;
  partCode: string;
  product: string;
  quantity: number;
  rate: number;
  amount: number;
  status: 'SENT' | 'RECEIVED' | 'CANCELLED';
  receivedQuantity: number | null;
  discrepancyNote: string | null;
};
export type SupplyDto = {
  id: string;
  challanNumber: string;
  poNumber: string | null;
  branch: { id: string; code: string; name: string };
  note: string | null;
  createdBy: string;
  createdAt: string;
  lines: SupplyLineDto[];
  /** Cancelled lines are not counted. */
  totalQuantity: number;
  totalAmount: number;
};

const orderQuantity = z.coerce.number('Enter quantity').int('Whole number').min(1, 'At least 1').max(100_000);

/** A branch orders parts it picks itself (e.g. low stock), as a draft or straight to the Central Store. */
export const manualPoSchema = z.object({
  branchId: z.uuid().optional(),
  note: z.string().trim().max(300).optional(),
  send: z.boolean().default(false),
  lines: z
    .array(z.object({ partId: z.uuid(), quantity: orderQuantity }))
    .min(1, 'Add at least one part')
    .max(200)
    .refine((l) => new Set(l.map((x) => x.partId)).size === l.length, 'A part is listed twice'),
});
export type ManualPoData = z.output<typeof manualPoSchema>;

export const poDecisionSchema = z.object({ reason: z.string().trim().min(3, 'Enter the reason').max(300) });

const supplyLines = z
  .array(z.object({ partId: z.uuid(), quantity: orderQuantity, rate: z.coerce.number('Enter rate').min(0).max(10_000_000).multipleOf(0.01, 'Max 2 decimal places') }))
  .min(1, 'Add at least one part')
  .max(200)
  .refine((l) => new Set(l.map((x) => x.partId)).size === l.length, 'A part is listed twice');

/** Central Store dispatch: against a purchase order, or direct to a branch. */
export const supplyCreateSchema = z.object({
  purchaseOrderId: z.uuid().optional(),
  toBranchId: z.uuid().optional(),
  note: z.string().trim().max(300).optional(),
  lines: supplyLines,
});
export type SupplyCreateData = z.output<typeof supplyCreateSchema>;

export const supplyListQuerySchema = z.object({ from: businessDate, to: businessDate, branchId: z.uuid().optional() });
export type SupplyListQuery = z.output<typeof supplyListQuerySchema>;

export type CentralOverviewDto = {
  newOrders: number;
  ordersToSupply: number;
  linesInTransit: number;
  recallsInTransit: number;
  central: { id: string; items: number; units: number; value: number; low: number };
  branches: { id: string; code: string; name: string; items: number; units: number; value: number; low: number; openOrders: number; inTransit: number }[];
};

export const managerRemarkSchema = z.object({ jobId: z.uuid(), remark: z.string().trim().min(2, 'Enter a remark').max(500) });

export type StockOverviewDto = {
  items: number;
  units: number;
  value: number;
  low: { partId: string; code: string; name: string; color: string | null; quantity: number; reorderLevel: number }[];
};

// ─── Branch Manager permission switches (Super Admin) ───────────────────────

export const MANAGER_PERMISSIONS = [
  { key: 'approve_l4', label: 'Approve / reject L4 transfer requests' },
  { key: 'approve_return_note', label: 'Approve / reject engineer Return Notes' },
  { key: 'approve_expense', label: 'Approve expenses' },
  { key: 'void_expense', label: 'Void expenses' },
  { key: 'manage_po', label: 'Create and forward purchase orders' },
  { key: 'close_day', label: 'Close the day (Day Book)' },
  { key: 'manager_remarks', label: 'Add diagnosis remarks' },
  { key: 'view_pnl', label: 'See Profit & Loss' },
] as const;
export type ManagerPermissionKey = (typeof MANAGER_PERMISSIONS)[number]['key'];
export const MANAGER_PERMISSION_KEYS = MANAGER_PERMISSIONS.map((p) => p.key) as [ManagerPermissionKey, ...ManagerPermissionKey[]];
export const permissionUpdateSchema = z.object({ key: z.enum(MANAGER_PERMISSION_KEYS), allowed: z.boolean() });
export type ManagerPermissionsDto = { key: ManagerPermissionKey; label: string; allowed: boolean }[];

// ─── Return Note (engineer confirms what was really used) ───────────────────

export const returnNoteSubmitSchema = z.object({
  lines: z.array(z.object({ jobPartId: z.uuid(), usedQuantity: z.coerce.number().int('Whole number').min(0) })).min(1),
});
export const returnNoteDecisionSchema = z.object({ remark: z.string().trim().max(300).optional() });
export const returnNoteListQuerySchema = z.object({
  status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']).default('SUBMITTED'),
  branchId: z.uuid().optional(),
});
export type ReturnNoteListQuery = z.output<typeof returnNoteListQuerySchema>;
export type ReturnNoteDto = {
  jobId: string;
  jobNumber: string;
  customer: string;
  device: string;
  engineer: string | null;
  branchCode: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedAt: string | null;
  remark: string | null;
  lines: { jobPartId: string; code: string; name: string; color: string | null; quantity: number; usedQuantity: number | null }[];
};

// ─── Day closing ────────────────────────────────────────────────────────────

export const dayClosingSchema = z.object({
  branchId: z.uuid().optional(),
  date: businessDate.optional(),
  countedCash: z.coerce.number().min(0).max(100_000_000).nullish(),
  note: z.string().trim().max(300).optional(),
});
export const dayClosingQuerySchema = z.object({ branchId: z.uuid().optional(), date: businessDate.optional() });
export type DayClosingDto = { date: string; expectedCash: number; countedCash: number | null; variance: number | null; note: string | null; closedBy: string; closedAt: string };
export type DayClosingStatusDto = { date: string; expectedCash: number; closing: DayClosingDto | null };

// ─── Part categories ────────────────────────────────────────────────────────

export const categoryQuerySchema = z.object({ scope: z.enum(['effective', 'branch', 'global']).default('effective'), branchId: z.uuid().optional() });
export type CategoryQuery = z.output<typeof categoryQuerySchema>;
const catName = z.string().trim().min(2, 'At least 2 characters').max(100);
export const categoryCreateSchema = z.object({ name: catName, parent: catName.optional(), branchId: z.uuid().nullish() });
export const categoryRenameSchema = z.object({ from: catName, to: catName, parent: catName.optional(), branchId: z.uuid().nullish() });
export const categoryDeleteSchema = z.object({ name: catName, parent: catName.optional(), branchId: z.uuid().nullish() });
export type PartCategoryDto = { name: string; count: number; subcategories: { name: string; count: number }[] };
