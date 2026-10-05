import { z } from 'zod';
import { optionalText } from './common.js';
import { PAYMENT_MODES, type JobStatus, type PaymentMode } from './jobs.js';

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
    note: optionalText(500),
  })
  .refine((v) => v.discount === 0 || v.discountReason, { message: 'Enter the reason for the discount', path: ['discountReason'] });
export type DeliveryInput = z.input<typeof deliverySchema>;
export type DeliveryData = z.output<typeof deliverySchema>;

/** What the customer owes, computed on the server from the approved estimate (or inspection charge for RWR). */
export type BillPreviewDto = {
  kind: 'REPAIR' | 'RWR';
  lines: { description: string; amount: number }[];
  subtotal: number;
  /** Advances etc. already received (net of refunds). */
  paid: number;
  imeiRequired: boolean;
  accessories: string[];
};

export type InvoiceDto = {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  subtotal: number;
  discount: number;
  discountReason: string | null;
  total: number;
  lines: { description: string; amount: number }[];
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
  };
  customer: { name: string; phone: string; address: string | null };
  branch: { name: string; code: string; address: string | null; phone: string | null };
};

/** Round to paise to avoid floating-point drift in money sums. */
export const roundMoney = (v: number) => Math.round(v * 100) / 100;
