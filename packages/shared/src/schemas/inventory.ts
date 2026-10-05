import { z } from 'zod';
import { ROLES, type Role } from '../roles.js';
import { priceAmount } from './catalog.js';
import { listQuerySchema, optionalText } from './common.js';

/** Roles that run a branch store (receive, adjust, issue parts). */
export const STORE_ROLES: readonly Role[] = [ROLES.STOREKEEPER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN];

export const partCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,20}$/, 'Code: up to 20 letters/digits, e.g. 105');

// ─── Parts master ───────────────────────────────────────────────────────────

export const partCreateSchema = z.object({
  code: partCode,
  name: z.string().trim().min(2, 'Enter part name').max(150),
  brandId: z.uuid().nullish(),
  deviceModelId: z.uuid().nullish(),
  sellingPrice: priceAmount,
  costPrice: z.preprocess((v) => (v === '' ? null : v), priceAmount.nullable()).optional(),
  reorderLevel: z.coerce.number().int().min(0).max(100_000).default(1),
});
export const partUpdateSchema = partCreateSchema.partial().extend({ isActive: z.boolean().optional() });
export const partListQuerySchema = listQuerySchema.extend({
  brandId: z.uuid().optional(),
  deviceModelId: z.uuid().optional(),
});
export type PartCreateInput = z.input<typeof partCreateSchema>;
export type PartCreateData = z.output<typeof partCreateSchema>;
export type PartUpdateData = z.output<typeof partUpdateSchema>;
export type PartListQuery = z.output<typeof partListQuerySchema>;

export type PartDto = {
  id: string;
  code: string;
  name: string;
  brand: { id: string; name: string } | null;
  model: { id: string; name: string } | null;
  sellingPrice: number;
  costPrice: number | null;
  reorderLevel: number;
  isActive: boolean;
};

/** Part looked up by code, with stock at the caller's (or requested) branch. */
export type PartLookupDto = PartDto & { stock: number | null };

export const partLookupQuerySchema = z.object({ code: partCode, branchId: z.uuid().optional() });

// ─── Stock ──────────────────────────────────────────────────────────────────

export const stockListQuerySchema = listQuerySchema.extend({
  branchId: z.uuid().optional(),
  lowOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type StockListQuery = z.output<typeof stockListQuerySchema>;

export type StockRowDto = {
  part: { id: string; code: string; name: string; reorderLevel: number; sellingPrice: number };
  quantity: number;
  low: boolean;
};

export const stockReceiptSchema = z.object({
  branchId: z.uuid().nullish(), // required for Super Admin
  partId: z.uuid('Select a part'),
  quantity: z.coerce.number('Enter quantity').int('Whole number').min(1, 'At least 1').max(100_000),
  unitCost: z.preprocess((v) => (v === '' ? null : v), priceAmount.nullable()).optional(),
  reference: optionalText(100),
  note: optionalText(300),
});
export type StockReceiptInput = z.input<typeof stockReceiptSchema>;
export type StockReceiptData = z.output<typeof stockReceiptSchema>;

export const stockAdjustmentSchema = z.object({
  branchId: z.uuid().nullish(),
  partId: z.uuid('Select a part'),
  /** Signed change, e.g. -1 for a damaged part. */
  quantity: z.coerce
    .number('Enter quantity')
    .int('Whole number')
    .min(-100_000)
    .max(100_000)
    .refine((v) => v !== 0, 'Cannot be zero'),
  note: z.string().trim().min(3, 'Enter a reason').max(300),
});
export type StockAdjustmentInput = z.input<typeof stockAdjustmentSchema>;
export type StockAdjustmentData = z.output<typeof stockAdjustmentSchema>;

export const STOCK_MOVEMENT_TYPES = ['RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  RECEIPT: 'Stock in',
  ISSUE: 'Issued to job',
  RETURN: 'Returned from job',
  ADJUSTMENT: 'Adjustment',
  TRANSFER_OUT: 'Sent to branch',
  TRANSFER_IN: 'Received from branch',
};

export const movementListQuerySchema = listQuerySchema.extend({
  branchId: z.uuid().optional(),
  partId: z.uuid().optional(),
  type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
});
export type MovementListQuery = z.output<typeof movementListQuerySchema>;

export type StockMovementDto = {
  id: string;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  unitCost: number | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
  part: { id: string; code: string; name: string };
  job: { id: string; jobNumber: string } | null;
  createdBy: { id: string; name: string };
};

// ─── Job parts (engineer requests, store issues) ────────────────────────────

/** Statuses in which the assigned engineer can request parts. */
export const PART_REQUEST_JOB_STATUSES = ['ASSIGNED', 'IN_REPAIR', 'TESTING', 'SPARE_PENDING'] as const;

export const partRequestSchema = z.object({
  code: partCode,
  quantity: z.coerce.number().int().min(1).max(20).default(1),
  note: optionalText(300),
});
export type PartRequestInput = z.input<typeof partRequestSchema>;
export type PartRequestData = z.output<typeof partRequestSchema>;

export const JOB_PART_STATUSES = ['REQUESTED', 'ISSUED', 'NOT_AVAILABLE', 'RETURNED', 'CANCELLED'] as const;
export type JobPartStatus = (typeof JOB_PART_STATUSES)[number];
export const JOB_PART_STATUS_LABELS: Record<JobPartStatus, string> = {
  REQUESTED: 'Requested',
  ISSUED: 'Issued',
  NOT_AVAILABLE: 'Not available',
  RETURNED: 'Returned to stock',
  CANCELLED: 'Cancelled',
};

export const partRequestActionSchema = z.object({ note: optionalText(300) });

export const partRequestListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  status: z.enum(['open', ...JOB_PART_STATUSES]).default('open'), // open = REQUESTED + NOT_AVAILABLE
});
export type PartRequestListQuery = z.output<typeof partRequestListQuerySchema>;

export type JobPartDto = {
  id: string;
  part: { id: string; code: string; name: string };
  quantity: number;
  unitPrice: number;
  status: JobPartStatus;
  note: string | null;
  requestedBy: { id: string; name: string };
  requestedAt: string;
  handledBy: { id: string; name: string } | null;
  handledAt: string | null;
};

/** Store queue row: a job part with its job context and current stock. */
export type PartRequestDto = JobPartDto & {
  job: { id: string; jobNumber: string; device: string; status: string; engineer: string | null };
  stock: number;
};

// ─── Stock transfers between branches ───────────────────────────────────────

export const stockTransferCreateSchema = z.object({
  fromBranchId: z.uuid().nullish(), // required for Super Admin
  toBranchId: z.uuid('Select the receiving branch'),
  partId: z.uuid('Select a part'),
  quantity: z.coerce.number('Enter quantity').int('Whole number').min(1, 'At least 1').max(100_000),
  note: optionalText(300),
});
export type StockTransferCreateData = z.output<typeof stockTransferCreateSchema>;

export const stockTransferListQuerySchema = z.object({
  view: z.enum(['incoming', 'outgoing', 'all']).default('incoming'),
  branchId: z.uuid().optional(),
});
export type StockTransferListQuery = z.output<typeof stockTransferListQuerySchema>;

export type StockTransferDto = {
  id: string;
  part: { id: string; code: string; name: string };
  from: { id: string; code: string; name: string };
  to: { id: string; code: string; name: string };
  quantity: number;
  status: 'SENT' | 'RECEIVED' | 'CANCELLED';
  note: string | null;
  sentBy: string;
  sentAt: string;
  receivedBy: string | null;
  receivedAt: string | null;
};
