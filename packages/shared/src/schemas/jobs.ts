import { z } from 'zod';
import { listQuerySchema, optionalText } from './common.js';
import type { JobPartDto } from './inventory.js';

// ─── Constants ──────────────────────────────────────────────────────────────

export const JOB_STATUSES = [
  'RECEIVED',
  'ASSIGNED',
  'AWAITING_APPROVAL',
  'IN_REPAIR',
  'CUSTOMER_REJECTED',
  'REPAIRED',
  'TESTING',
  'READY_FOR_DELIVERY',
  'SPARE_PENDING',
  'RWR',
  'DELIVERED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  RECEIVED: 'Awaiting assignment',
  ASSIGNED: 'Pending diagnosis',
  AWAITING_APPROVAL: 'Awaiting customer approval',
  IN_REPAIR: 'Approved – in repair',
  CUSTOMER_REJECTED: 'Customer rejected',
  REPAIRED: 'Repaired (done)',
  TESTING: 'Testing',
  READY_FOR_DELIVERY: 'Ready – returned OK',
  SPARE_PENDING: 'Spare not available',
  RWR: 'Returned without repair (RWR)',
  DELIVERED: 'Delivered',
};

/** Statuses in which the engineer can still be (re)assigned. */
export const ASSIGNABLE_STATUSES: readonly JobStatus[] = ['RECEIVED', 'ASSIGNED'];

/** Statuses that count as an engineer's open workload (phone is with the engineer). */
export const ENGINEER_OPEN_STATUSES: readonly JobStatus[] = [
  'ASSIGNED',
  'AWAITING_APPROVAL',
  'IN_REPAIR',
  'REPAIRED',
  'TESTING',
  'SPARE_PENDING',
];

/** Engineer can hand the job to another engineer in these statuses. */
export const TRANSFERABLE_STATUSES: readonly JobStatus[] = ['ASSIGNED', 'AWAITING_APPROVAL', 'IN_REPAIR', 'REPAIRED', 'TESTING', 'SPARE_PENDING'];

/** Engineer can put the job on hold for a spare part from these statuses. */
export const SPARE_HOLD_STATUSES: readonly JobStatus[] = ['ASSIGNED', 'IN_REPAIR'];

/** Engineer can return the phone without repair from these statuses. */
export const RWR_STATUSES: readonly JobStatus[] = ['ASSIGNED', 'IN_REPAIR', 'SPARE_PENDING', 'CUSTOMER_REJECTED', 'TESTING'];

export const JOB_LOCATIONS = ['AT_BRANCH', 'TO_L4', 'TO_BRANCH'] as const;
export type JobLocation = (typeof JOB_LOCATIONS)[number];

/** Owning branch (or the engineer) can send the phone to the main office (L4) in these statuses. */
export const L4_SENDABLE_STATUSES: readonly JobStatus[] = ['RECEIVED', 'ASSIGNED', 'AWAITING_APPROVAL', 'IN_REPAIR', 'SPARE_PENDING'];
/** L4 sends the phone back once it is repaired or returned without repair. */
export const L4_RETURNABLE_STATUSES: readonly JobStatus[] = ['READY_FOR_DELIVERY', 'RWR'];

export const RWR_REASONS = ['SPARE_NOT_AVAILABLE', 'NOT_REPAIRABLE', 'CUSTOMER_REJECTED', 'OTHER'] as const;
export type RwrReason = (typeof RWR_REASONS)[number];
export const RWR_REASON_LABELS: Record<RwrReason, string> = {
  SPARE_NOT_AVAILABLE: 'Spare part not available',
  NOT_REPAIRABLE: 'Not repairable / already tampered',
  CUSTOMER_REJECTED: 'Customer rejected the estimate',
  OTHER: 'Other',
};
export const RWR_MIN_PHOTOS = 1;

/** Engineer may (re)submit the diagnosis/quote in these statuses. */
export const DIAGNOSABLE_STATUSES: readonly JobStatus[] = ['ASSIGNED', 'AWAITING_APPROVAL', 'IN_REPAIR'];

/** Work-progress moves the assigned engineer can make, with the button label for each. */
export const ENGINEER_TRANSITIONS: Partial<Record<JobStatus, { to: JobStatus; label: string; noteRequired?: boolean }[]>> = {
  IN_REPAIR: [{ to: 'REPAIRED', label: 'Mark repaired (done)' }],
  REPAIRED: [
    { to: 'TESTING', label: 'Start testing' },
    { to: 'IN_REPAIR', label: 'Back to repair', noteRequired: true },
  ],
  TESTING: [
    { to: 'READY_FOR_DELIVERY', label: 'Testing OK – return to counter' },
    { to: 'IN_REPAIR', label: 'Testing failed – back to repair', noteRequired: true },
  ],
};

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

export const PHOTO_KINDS = ['CUSTOMER', 'ID_PROOF', 'DEVICE', 'RWR'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];
export const PHOTO_KIND_LABELS: Record<PhotoKind, string> = {
  CUSTOMER: 'Customer photo',
  ID_PROOF: 'Aadhaar / ID proof',
  DEVICE: 'Phone photos',
  RWR: 'RWR / motherboard photos',
};
/** Photo kinds the counter uploads at intake (RWR photos come only with an RWR). */
export const INTAKE_PHOTO_KINDS: readonly PhotoKind[] = ['CUSTOMER', 'ID_PROOF', 'DEVICE'];

/** Engineers only need device photos; customer photo and ID proof are hidden from them. */
export const ENGINEER_VISIBLE_PHOTO_KINDS: readonly PhotoKind[] = ['DEVICE', 'RWR'];

export const PAYMENT_MODES = ['CASH', 'UPI', 'CARD'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };

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

const imeiField = optionalText(15).refine((v) => !v || isValidImei(v), 'Invalid IMEI (must be 15 digits)');
const serialField = optionalText(30).refine((v) => !v || /^[A-Za-z0-9-]{4,30}$/.test(v), 'Invalid serial number');

/**
 * Job sheet. IMEI/serial are optional at intake (a dead phone may not show them) and are
 * enforced at delivery instead.
 */
export const jobCreateSchema = z
  .object({
    customer: jobCustomerSchema,
    brandId: z.uuid('Select a brand'),
    deviceModelId: z.uuid('Select a model'),
    imei: imeiField,
    serialNumber: serialField,
    color: optionalText(30),
    /** Each reported fault, optionally with the chosen price option (null = cost to be decided). */
    faults: z
      .array(z.object({ faultId: z.uuid(), priceId: z.uuid().nullish() }))
      .min(1, 'Select at least one fault')
      .max(20)
      .refine((f) => new Set(f.map((x) => x.faultId)).size === f.length, 'Duplicate fault'),
    customerComplaint: optionalText(1000),
    accessories: z.array(z.enum(ACCESSORIES)).max(ACCESSORIES.length).default([]),
    accessoriesOther: optionalText(200),
    conditionNotes: optionalText(1000),
    /** Optional: assign straight away at intake. */
    engineerId: z.uuid().nullish(),
    advance: z
      .object({
        amount: z.coerce.number('Enter a valid amount').min(0).max(10_000_000).multipleOf(0.01, 'Max 2 decimal places'),
        mode: z.enum(PAYMENT_MODES),
        reference: optionalText(60),
      })
      .nullish(),
  })
  .refine((v) => !v.advance || v.advance.amount > 0, { message: 'Enter the advance amount', path: ['advance', 'amount'] });

/** Device & faults can be corrected only until the engineer has diagnosed (estimate depends on them). */
export const DEVICE_EDITABLE_STATUSES: readonly JobStatus[] = ['RECEIVED', 'ASSIGNED'];

/** Correct a job sheet after saving. Omitted fields are unchanged. */
export const jobEditSchema = z.object({
  customer: jobCustomerSchema.partial().optional(),
  brandId: z.uuid().optional(),
  deviceModelId: z.uuid().optional(),
  color: optionalText(30),
  faults: z
    .array(z.object({ faultId: z.uuid(), priceId: z.uuid().nullish() }))
    .min(1, 'Select at least one fault')
    .max(20)
    .refine((f) => new Set(f.map((x) => x.faultId)).size === f.length, 'Duplicate fault')
    .optional(),
  customerComplaint: optionalText(1000),
  accessories: z.array(z.enum(ACCESSORIES)).max(ACCESSORIES.length).optional(),
  accessoriesOther: optionalText(200),
  conditionNotes: optionalText(1000),
});
export type JobEditInput = z.input<typeof jobEditSchema>;
export type JobEditData = z.output<typeof jobEditSchema>;

export const photoDeleteSchema = z.object({ reason: z.string().trim().min(3, 'Why is this photo being removed?').max(200) });

export const imeiCheckQuerySchema = z.object({ imei: z.string().regex(/^\d{15}$/), excludeJobId: z.uuid().optional() });

/** Other jobs with the same IMEI across all branches. */
export type ImeiCheckDto = {
  open: { id: string; jobNumber: string; branchCode: string; status: JobStatus; createdAt: string }[];
  previous: { id: string; jobNumber: string; branchCode: string; deliveredAt: string | null; rwr: boolean }[];
};

export type JobCreateInput = z.input<typeof jobCreateSchema>;
export type JobCreateData = z.output<typeof jobCreateSchema>;

export const jobListQuerySchema = listQuerySchema.extend({
  status: z.enum(JOB_STATUSES).optional(),
  branchId: z.uuid().optional(),
  /** Filter by engineer; "none" = unassigned jobs. Engineers always see only their own jobs. */
  engineerId: z.union([z.uuid(), z.literal('none')]).optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  /** true = only phones physically at my branch (excludes my jobs that are at L4). */
  here: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** true = only jobs whose customer belongs to my branch (approvals, collection). */
  owned: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** true = everything not yet delivered. */
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Only jobs received at least this many days ago (overdue view). */
  minAgeDays: z.coerce.number().int().min(0).max(3650).optional(),
});
export type JobListQuery = z.output<typeof jobListQuerySchema>;

export const jobAssignSchema = z.object({ engineerId: z.uuid('Select an engineer') });
export type JobAssignInput = z.input<typeof jobAssignSchema>;

/** Branch is required for Super Admin; branch staff always get their own branch. */
export const engineerListQuerySchema = z.object({ branchId: z.uuid().optional() });

export const jobStatsQuerySchema = z.object({ branchId: z.uuid().optional() });

// ─── Diagnosis, approval, work status ───────────────────────────────────────

/**
 * One quote line: a fault from the master (optionally with one of the model's price options),
 * or a custom item. Amount is taken from the price option when one is chosen.
 */
export const estimateLineSchema = z
  .object({
    faultId: z.uuid().nullish(),
    priceId: z.uuid().nullish(),
    partId: z.uuid().nullish(),
    description: optionalText(200),
    // Blank input means "not entered" (not ₹0); type 0 explicitly for a free item.
    amount: z
      .preprocess(
        (v) => (v === '' || v === null || v === undefined ? null : v),
        z.coerce.number('Enter amount').min(0).max(10_000_000).multipleOf(0.01, 'Max 2 decimal places').nullable(),
      )
      .optional(),
  })
  .refine((l) => l.faultId || l.partId || l.description, { message: 'Select a fault or describe the work', path: ['description'] })
  .refine((l) => l.priceId || l.partId || (l.amount !== null && l.amount !== undefined), { message: 'Enter amount', path: ['amount'] });

export const diagnosisSchema = z.object({
  notes: z.string().trim().min(3, 'Describe what you found').max(2000),
  lines: z.array(estimateLineSchema).min(1, 'Add at least one item').max(30),
});
export type DiagnosisInput = z.input<typeof diagnosisSchema>;
export type DiagnosisData = z.output<typeof diagnosisSchema>;

export const approvalSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: optionalText(500),
  })
  .refine((v) => v.decision === 'APPROVED' || v.note, { message: 'Enter the customer\'s reason', path: ['note'] });
export type ApprovalInput = z.input<typeof approvalSchema>;
export type ApprovalData = z.output<typeof approvalSchema>;

export const statusChangeSchema = z.object({
  status: z.enum(JOB_STATUSES),
  note: optionalText(500),
});
export type StatusChangeData = z.output<typeof statusChangeSchema>;

// ─── Transfer, spare hold, RWR ──────────────────────────────────────────────

export const transferRequestSchema = z.object({
  toEngineerId: z.uuid('Select an engineer'),
  reason: z.string().trim().min(3, 'Enter a reason').max(500),
});
export type TransferRequestInput = z.input<typeof transferRequestSchema>;
export type TransferRequestData = z.output<typeof transferRequestSchema>;

export const transferResponseSchema = z
  .object({ decision: z.enum(['ACCEPTED', 'REJECTED']), note: optionalText(500) })
  .refine((v) => v.decision === 'ACCEPTED' || v.note, { message: 'Enter a reason', path: ['note'] });
export type TransferResponseData = z.output<typeof transferResponseSchema>;

export const transferListQuerySchema = z.object({
  direction: z.enum(['incoming', 'outgoing', 'all']).default('incoming'),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED']).default('PENDING'),
});
export type TransferListQuery = z.output<typeof transferListQuerySchema>;

export const spareHoldSchema = z.object({
  part: z.string().trim().min(2, 'Enter the part needed').max(200),
  note: optionalText(500),
});
export type SpareHoldInput = z.input<typeof spareHoldSchema>;
export type SpareHoldData = z.output<typeof spareHoldSchema>;

export const spareReceivedSchema = z.object({ note: optionalText(500) });

export const rwrSchema = z.object({
  reason: z.enum(RWR_REASONS, 'Select a reason'),
  note: z.string().trim().min(5, 'Explain why the phone is returned unrepaired').max(1000),
});
export type RwrInput = z.input<typeof rwrSchema>;
export type RwrData = z.output<typeof rwrSchema>;

export const sendToL4Schema = z.object({
  toBranchId: z.uuid('Select the main office'),
  reason: z.string().trim().min(3, 'Why is it going to L4?').max(500),
});
export type SendToL4Data = z.output<typeof sendToL4Schema>;

export const movementNoteSchema = z.object({ note: optionalText(500) });

export const movementListQuerySchemaL4 = z.object({
  /** incoming = to receive at my branch · outgoing = sent by my branch, not yet received · all = history */
  view: z.enum(['incoming', 'outgoing', 'all']).default('incoming'),
  branchId: z.uuid().optional(),
});
export type L4MovementListQuery = z.output<typeof movementListQuerySchemaL4>;

export type JobMovementDto = {
  id: string;
  direction: 'TO_L4' | 'TO_BRANCH';
  from: { id: string; code: string; name: string };
  to: { id: string; code: string; name: string };
  reason: string | null;
  sentBy: string;
  sentAt: string;
  receivedBy: string | null;
  receivedAt: string | null;
  receiveNote: string | null;
  job?: { id: string; jobNumber: string; device: string; status: JobStatus; customer: string };
};

export type TransferDto = {
  id: string;
  job: { id: string; jobNumber: string; device: string; status: JobStatus };
  from: { id: string; name: string };
  to: { id: string; name: string };
  reason: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  responseNote: string | null;
  heldSince: string;
  createdAt: string;
  respondedAt: string | null;
};

export const customerLookupQuerySchema = z.object({ phone: mobileNumber });

export const photoUploadSchema = z.object({ kind: z.enum(['CUSTOMER', 'ID_PROOF', 'DEVICE']) });

/** Update IMEI / serial later (e.g. once a dead phone powers on). */
export const jobDeviceUpdateSchema = z
  .object({ imei: imeiField, serialNumber: serialField })
  .refine((v) => v.imei !== undefined || v.serialNumber !== undefined, 'Nothing to update');
export type JobDeviceUpdateInput = z.input<typeof jobDeviceUpdateSchema>;
export type JobDeviceUpdateData = z.output<typeof jobDeviceUpdateSchema>;

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
  assignedAt: string | null;
  quotedAmount: number | null;
  sparePart: string | null;
  hasPendingTransfer: boolean;
  currentBranch: { id: string; code: string };
  location: JobLocation;
  /** Net amount received so far (advances − refunds). */
  paid: number;
};

export type JobPhotoDto = { id: string; kind: PhotoKind; createdAt: string };

export type JobDto = {
  id: string;
  jobNumber: string;
  status: JobStatus;
  createdAt: string;
  branch: { id: string; code: string; name: string; address: string | null; phone: string | null };
  customer: CustomerDto;
  brand: { id: string; name: string };
  model: { id: string; name: string };
  imei: string | null;
  serialNumber: string | null;
  color: string | null;
  faults: { id: string; name: string; priceLabel: string | null; price: number | null }[];
  estimatedAmount: number | null;
  payments: { id: string; kind: 'ADVANCE' | 'FINAL' | 'REFUND'; mode: PaymentMode; amount: number; reference: string | null; createdAt: string }[];
  customerComplaint: string | null;
  accessories: string[];
  accessoriesOther: string | null;
  conditionNotes: string | null;
  createdBy: { id: string; name: string };
  assignedEngineer: { id: string; name: string } | null;
  assignedAt: string | null;
  diagnosisNotes: string | null;
  diagnosedAt: string | null;
  quotedAmount: number | null;
  approvedAmount: number | null;
  approvedAt: string | null;
  approvedBy: { id: string; name: string } | null;
  customerResponse: string | null;
  repairedAt: string | null;
  readyAt: string | null;
  currentBranch: { id: string; code: string; name: string; type: 'SERVICE_CENTER' | 'MAIN_OFFICE' };
  location: JobLocation;
  movements: JobMovementDto[];
  deliveredAt: string | null;
  deliveredTo: string | null;
  deliveryNote: string | null;
  deliveredBy: { id: string; name: string } | null;
  invoice: { id: string; invoiceNumber: string; total: number } | null;
  sparePart: string | null;
  spareRequestedAt: string | null;
  rwrReason: RwrReason | null;
  rwrNote: string | null;
  rwrAt: string | null;
  pendingTransfer: { id: string; from: { id: string; name: string }; to: { id: string; name: string }; reason: string; createdAt: string } | null;
  parts: JobPartDto[];
  estimateLines: {
    id: string;
    fault: { id: string; name: string } | null;
    part: { id: string; code: string; name: string } | null;
    description: string | null;
    priceLabel: string | null;
    amount: number;
  }[];
  photos: JobPhotoDto[];
};

export type EngineerWorkloadDto = { id: string; name: string; openJobs: number };

/** Job counts by status within the caller's scope (engineers: their own jobs). */
export type JobStatsDto = {
  byStatus: Record<JobStatus, number>;
  total: number;
  /** This branch's jobs currently at / travelling to or from the main office. */
  atL4: number;
};

export type JobHistoryEntryDto = {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
  metadata: unknown;
};
