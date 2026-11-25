import { z } from 'zod';
import { optionalText } from './common.js';
import { isValidImei, PAYMENT_MODES, type JobStatus, type PaymentMode } from './jobs.js';

/** Jobs the counter can hand back: repaired, or returned without repair. */
export const DELIVERABLE_STATUSES: readonly JobStatus[] = ['READY_FOR_DELIVERY', 'RWR'];

const money = z.coerce.number('Enter a valid amount').min(0).max(10_000_000).multipleOf(0.01, 'Max 2 decimal places');

export const deliverySchema = z
  .object({
    discount: money.default(0),
    discountReason: optionalText(200),
    /** Only for RWR jobs: optional inspection / diagnosis charge. */
    inspectionCharge: money.default(0),
    payments: z
      .array(z.object({ mode: z.enum(PAYMENT_MODES), amount: money.refine((v) => v > 0, 'Enter amount'), reference: optionalText(60) }))
      .max(5)
      .default([]),
    refund: z.object({ mode: z.enum(PAYMENT_MODES), amount: money.refine((v) => v > 0, 'Enter amount'), reference: optionalText(60) }).nullish(),
    deliveredTo: z.string().trim().min(2, 'Who collected the phone?').max(100),
    accessoriesReturned: z.boolean().default(false),
    /** Required when a loaner phone is still with the customer: confirms it is back. */
    loanerReturned: z.boolean().default(false),
    note: optionalText(500),
    /** Required for mobile delivery; "N/A" must be an explicit counter choice. */
    imei: z.string().trim().refine((v) => v === 'N/A' || isValidImei(v), 'Enter a valid 15-digit IMEI or select N/A').optional(),
    /** Repair warranty given at hand-over, e.g. "30 days". */
    warrantyPeriod: optionalText(60),
    warrantyTerms: optionalText(1000),
  })
  .refine((v) => v.discount === 0 || v.discountReason, { message: 'Enter the reason for the discount', path: ['discountReason'] });
export type DeliveryInput = z.input<typeof deliverySchema>;
export type DeliveryData = z.output<typeof deliverySchema>;

/** What the customer owes, computed on the server from the approved estimate (or inspection charge for RWR). */
export type BillPreviewDto = {
  kind: 'REPAIR' | 'RWR';
  lines: { description: string; partCode: string | null; warranty: string | null; amount: number }[];
  subtotal: number;
  /** Advances etc. already received (net of refunds). */
  paid: number;
  /** IMEI must be entered (branch setting; never for RWR). */
  imeiRequired: boolean;
  /** Show the IMEI field at all (mobile phones). */
  imeiAsked: boolean;
  /** Branch allows "IMEI N/A". */
  allowImeiNa: boolean;
  /** Pre-filled repair warranty (job's own, else branch default). */
  warrantyPeriod: string | null;
  warrantyTerms: string | null;
  serialNumberRequired: boolean;
  accessories: string[];
  /** "Brand Model" of a loaner phone not yet received back, else null. */
  loanerPending: string | null;
};

export type InvoiceDto = {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  subtotal: number;
  discount: number;
  discountReason: string | null;
  total: number;
  lines: { description: string; partCode: string | null; warranty: string | null; amount: number }[];
  payments: { kind: 'ADVANCE' | 'FINAL' | 'REFUND'; mode: PaymentMode; amount: number; reference: string | null; createdAt: string }[];
  createdBy: { name: string };
  job: {
    id: string;
    jobNumber: string;
    receivedAt: string;
    device: string;
    imei: string | null;
    serialNumber: string | null;
    status: JobStatus;
    rwrReason: string | null;
    deliveredTo: string | null;
    deliveredAt: string | null;
    /** What the customer reported, e.g. "Phone not charging, Mic". */
    problems: string;
    warrantyPeriod: string | null;
    warrantyTerms: string | null;
  };
  /** Net amount received (payments − refunds). */
  paid: number;
  /** total − paid (0 when fully paid). */
  due: number;
  customer: { name: string; phone: string; address: string | null };
  branch: { name: string; code: string; address: string | null; phone: string | null };
};

/** Round to paise to avoid floating-point drift in money sums. */
export const roundMoney = (v: number) => Math.round(v * 100) / 100;
