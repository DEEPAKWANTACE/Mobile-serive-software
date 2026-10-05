import { z } from 'zod';
import { listQuerySchema, optionalText } from './common.js';

// ─── Constants ──────────────────────────────────────────────────────────────

export const JOB_STATUSES = ['RECEIVED', 'ASSIGNED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  RECEIVED: 'Awaiting assignment',
  ASSIGNED: 'Assigned',
};

/** Statuses in which the engineer can still be (re)assigned. */
export const ASSIGNABLE_STATUSES: readonly JobStatus[] = ['RECEIVED', 'ASSIGNED'];

/** Statuses that count as an engineer's open workload. Extended as workflow steps are added. */
export const ENGINEER_OPEN_STATUSES: readonly JobStatus[] = ['ASSIGNED'];

export const ACCESSORIES = [
  'Charger',
  'Cable',
  'Battery',
  'Back Cover',
  'SIM Tray',
  'SIM Card',
  'Memory Card',
  'Earphones',
  'Box',
] as const;
export type Accessory = (typeof ACCESSORIES)[number];

export const PHOTO_KINDS = ['CUSTOMER', 'ID_PROOF', 'DEVICE'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];
export const PHOTO_KIND_LABELS: Record<PhotoKind, string> = {
  CUSTOMER: 'Customer photo',
  ID_PROOF: 'Aadhaar / ID proof',
  DEVICE: 'Phone photos',
};

/** Engineers only need device photos; customer photo and ID proof are hidden from them. */
export const ENGINEER_VISIBLE_PHOTO_KINDS: readonly PhotoKind[] = ['DEVICE'];

export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_MAX_PER_UPLOAD = 10;

// ─── Validation helpers ─────────────────────────────────────────────────────

/** IMEI: 15 digits with a valid Luhn check digit. */
export function isValidImei(value: string) {
  if (!/^\d{15}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(value[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export const mobileNumber = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');

// ─── Job sheet ──────────────────────────────────────────────────────────────

export const jobCustomerSchema = z.object({
  phone: mobileNumber,
  name: z.string().trim().min(2, 'Enter customer name').max(100),
  altPhone: optionalText(10).refine((v) => !v || /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number'),
  email: optionalText(150).refine((v) => !v || z.email().safeParse(v).success, 'Invalid email'),
  address: optionalText(300),
});

export const jobCreateSchema = z
  .object({
    customer: jobCustomerSchema,
    brandId: z.uuid('Select a brand'),
    deviceModelId: z.uuid('Select a model'),
    imei: optionalText(15).refine((v) => !v || isValidImei(v), 'Invalid IMEI (must be 15 digits)'),
    serialNumber: optionalText(30).refine((v) => !v || /^[A-Za-z0-9-]{4,30}$/.test(v), 'Invalid serial number'),
    color: optionalText(30),
    faultIds: z.array(z.uuid()).min(1, 'Select at least one fault').max(20),
    customerComplaint: optionalText(1000),
    accessories: z.array(z.enum(ACCESSORIES)).max(ACCESSORIES.length).default([]),
    accessoriesOther: optionalText(200),
    conditionNotes: optionalText(1000),
  })
  .refine((v) => v.imei || v.serialNumber, { message: 'Enter IMEI or serial number', path: ['imei'] });

export type JobCreateInput = z.input<typeof jobCreateSchema>;
export type JobCreateData = z.output<typeof jobCreateSchema>;

export const jobListQuerySchema = listQuerySchema.extend({
  status: z.enum(JOB_STATUSES).optional(),
  branchId: z.uuid().optional(),
  /** Filter by engineer; "none" = unassigned jobs. Engineers always see only their own jobs. */
  engineerId: z.union([z.uuid(), z.literal('none')]).optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});
export type JobListQuery = z.output<typeof jobListQuerySchema>;

export const jobAssignSchema = z.object({ engineerId: z.uuid('Select an engineer') });
export type JobAssignInput = z.input<typeof jobAssignSchema>;

/** Branch is required for Super Admin; branch staff always get their own branch. */
export const engineerListQuerySchema = z.object({ branchId: z.uuid().optional() });

export const jobStatsQuerySchema = z.object({ branchId: z.uuid().optional() });

export const customerLookupQuerySchema = z.object({ phone: mobileNumber });

export const photoUploadSchema = z.object({ kind: z.enum(PHOTO_KINDS) });

// ─── DTOs ───────────────────────────────────────────────────────────────────

export type CustomerDto = {
  id: string;
  name: string;
  phone: string;
  altPhone: string | null;
  email: string | null;
  address: string | null;
};

export type JobListItemDto = {
  id: string;
  jobNumber: string;
  status: JobStatus;
  createdAt: string;
  customer: { name: string; phone: string };
  device: string; // "Samsung Galaxy S24"
  imei: string | null;
  faults: string[];
  branch: { id: string; code: string; name: string };
  assignedEngineer: { id: string; name: string } | null;
};

export type JobPhotoDto = { id: string; kind: PhotoKind; createdAt: string };

export type JobDto = {
  id: string;
  jobNumber: string;
  status: JobStatus;
  createdAt: string;
  branch: { id: string; code: string; name: string };
  customer: CustomerDto;
  brand: { id: string; name: string };
  model: { id: string; name: string };
  imei: string | null;
  serialNumber: string | null;
  color: string | null;
  faults: { id: string; name: string }[];
  customerComplaint: string | null;
  accessories: string[];
  accessoriesOther: string | null;
  conditionNotes: string | null;
  createdBy: { id: string; name: string };
  assignedEngineer: { id: string; name: string } | null;
  assignedAt: string | null;
  photos: JobPhotoDto[];
};

export type EngineerWorkloadDto = { id: string; name: string; openJobs: number };

/** Job counts by status within the caller's scope (engineers: their own jobs). */
export type JobStatsDto = { byStatus: Record<JobStatus, number>; total: number };

export type JobHistoryEntryDto = {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
  metadata: unknown;
};
