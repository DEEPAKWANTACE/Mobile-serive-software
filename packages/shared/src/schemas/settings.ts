import { z } from 'zod';
import { optionalText } from './common.js';
import type { Role } from '../roles.js';

/** 15-character GSTIN: 2-digit state code, PAN, entity no., 'Z', checksum character. */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const shopSettingsSchema = z.object({
  shopName: z.string().trim().min(2, 'Enter the shop name').max(100),
  legalName: optionalText(150),
  gstin: optionalText(15)
    .transform((v) => v?.toUpperCase() ?? null)
    .refine((v) => !v || GSTIN_PATTERN.test(v), 'Enter a valid 15-character GSTIN'),
  address: optionalText(300),
  phone: optionalText(30),
  email: optionalText(150).refine((v) => !v || z.email().safeParse(v).success, 'Invalid email'),
  invoiceTerms: optionalText(1000),
});
export type ShopSettingsInput = z.input<typeof shopSettingsSchema>;
export type ShopSettingsData = z.output<typeof shopSettingsSchema>;

export type ShopSettingsDto = {
  shopName: string;
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  invoiceTerms: string | null;
  hasLogo: boolean;
  /** Changes whenever the logo is replaced (cache-busting). */
  logoVersion: string | null;
};

export const branchWarrantySchema = z.object({
  warrantyPeriod: optionalText(60),
  warrantyTerms: optionalText(1000),
});
export type BranchWarrantyData = z.output<typeof branchWarrantySchema>;

export const accessoryOptionSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(100),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  branchId: z.uuid().nullish(),
});
export const accessoryOptionUpdateSchema = accessoryOptionSchema.partial().extend({ isActive: z.boolean().optional() });
export const accessoryOptionsQuerySchema = z.object({
  branchId: z.uuid().optional(),
  scope: z.enum(['effective', 'branch', 'global']).default('effective'),
});
export type AccessoryOptionDto = { id: string; name: string; sortOrder: number; isActive: boolean; branchId: string | null; isGlobal: boolean };

/** Problem types (e.g. Hardware, Software) grouping the diagnosis presets — Super Admin managed. */
export const diagnosisFindingTypeSchema = z.object({
  name: z.string().trim().min(2, 'Enter a type name').max(60),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
export const diagnosisFindingTypeUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Enter a type name').max(60).optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});
export type DiagnosisFindingTypeDto = { id: string; name: string; sortOrder: number; isActive: boolean };

/** Preset findings shown in the engineer's diagnosis popup. */
export const diagnosisFindingSchema = z.object({
  label: z.string().trim().min(2, 'Enter a finding').max(200),
  typeId: z.uuid('Select a type'),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
export const diagnosisFindingUpdateSchema = z.object({
  label: z.string().trim().min(2, 'Enter a finding').max(200).optional(),
  typeId: z.uuid('Select a type').optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});
export type DiagnosisFindingDto = { id: string; label: string; type: { id: string; name: string }; sortOrder: number; isActive: boolean };

// ─── Job sheet list columns (Super Admin matrix) ────────────────────────────

/** Every column the job sheet list can show. Job Sheet ID is always shown and is not listed here. */
export const JOB_LIST_COLUMNS = [
  'status',
  'date',
  'customerName',
  'customerMobile',
  'device',
  'problem',
  'engineer',
  'pendingWith',
  'estimate',
  'payment',
  'imei',
  'city',
  'branch',
  'inwardBy',
  'ageDays',
  'approval',
] as const;
export type JobListColumn = (typeof JOB_LIST_COLUMNS)[number];
export const JOB_LIST_COLUMN_LABELS: Record<JobListColumn, string> = {
  status: 'Status',
  date: 'Date received',
  customerName: 'Customer name',
  customerMobile: 'Customer mobile',
  device: 'Model / device',
  problem: 'Problem',
  engineer: 'Engineer',
  pendingWith: 'Pending with',
  estimate: 'Estimate amount',
  payment: 'Payment / balance',
  imei: 'IMEI / serial',
  city: 'City',
  branch: 'Branch',
  inwardBy: 'Inward by',
  ageDays: 'Days open',
  approval: 'Action buttons (Approve / Deliver)',
};
export const JOB_LIST_COLUMN_HINTS: Partial<Record<JobListColumn, string>> = {
  approval: '“Approval” on jobs awaiting customer approval and “Deliver” on jobs ready for pickup (CCO / Branch Manager only)',
  payment: 'Amount paid and balance due',
};

const COUNTER_COLUMNS: JobListColumn[] = ['status', 'date', 'customerName', 'customerMobile', 'device', 'problem', 'engineer', 'approval'];
export const DEFAULT_JOB_LIST_COLUMNS: Record<Role, JobListColumn[]> = {
  SUPER_ADMIN: ['status', 'date', 'customerName', 'customerMobile', 'device', 'problem', 'engineer', 'branch'],
  BRANCH_MANAGER: COUNTER_COLUMNS,
  CCO: COUNTER_COLUMNS,
  ENGINEER: ['status', 'date', 'customerName', 'customerMobile', 'device', 'problem'],
  STOREKEEPER: ['status', 'date', 'customerName', 'device', 'problem', 'engineer'],
  ACCOUNTS: ['status', 'date', 'customerName', 'customerMobile', 'device', 'problem', 'payment'],
};
export type JobListColumnsDto = Record<Role, JobListColumn[]>;
const columnList = z.array(z.enum(JOB_LIST_COLUMNS)).max(JOB_LIST_COLUMNS.length).transform((cols) => [...new Set(cols)]);
export const jobListColumnsSchema = z.object({
  SUPER_ADMIN: columnList,
  BRANCH_MANAGER: columnList,
  CCO: columnList,
  ENGINEER: columnList,
  STOREKEEPER: columnList,
  ACCOUNTS: columnList,
});
export type JobListColumnsData = z.output<typeof jobListColumnsSchema>;
