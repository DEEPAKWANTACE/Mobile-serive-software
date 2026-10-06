import { z } from 'zod';
import { ROLES, type Role } from '../roles.js';
import { businessDate } from './accounts.js';

export const REPORT_ROLES: readonly Role[] = [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.ACCOUNTS];

export const reportQuerySchema = z.object({
  from: businessDate,
  to: businessDate,
  stateId: z.uuid().optional(),
  cityId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export type ReportQuery = z.output<typeof reportQuerySchema>;

type Counts = {
  /** Jobs received in the period. */
  received: number;
  /** Jobs delivered in the period (repaired + RWR). */
  delivered: number;
  repairedDelivered: number;
  rwrDelivered: number;
  /** Open right now (not delivered), regardless of period. */
  pendingNow: number;
  /** Open right now and older than the 15-day limit. */
  overdueNow: number;
  /** % of delivered jobs delivered on the same business day they were received. */
  sameDayPct: number | null;
  /** Average days from received to delivered, for jobs delivered in the period. */
  avgTatDays: number | null;
  /** Sum of invoices raised in the period. */
  revenue: number;
  sentToL4: number;
};

export type ReportBranchRow = Counts & { branch: { id: string; code: string; name: string; city: string; state: string } };

export type ReportEngineerRow = {
  engineer: { id: string; name: string; branchCode: string; isActive: boolean };
  /** Current status counts (now). */
  pending: number; // with engineer, not yet repaired (assigned / awaiting approval / in repair)
  done: number; // REPAIRED
  testing: number;
  spareNotAvailable: number;
  /** Period counts. */
  returnedOk: number; // became Ready in the period
  rwr: number; // returned without repair in the period
  transfersOut: number; // accepted transfers to someone else in the period
  /** Average hours from assignment to Ready, for jobs that became Ready in the period. */
  avgRepairHours: number | null;
};

export type ReportCcoRow = {
  user: { id: string; name: string; role: Role; branchCode: string };
  received: number; // job sheets created in the period
  deliveredOfReceived: number; // of those, already delivered
  approvalsConfirmed: number; // customer answers recorded in the period
  deliveriesDone: number; // phones handed over in the period
  revenue: number; // invoices raised in the period on jobs they took in
  advanceCollected: number; // advances taken in the period on jobs they took in
};

export type ReportDto = {
  from: string;
  to: string;
  summary: Counts;
  branches: ReportBranchRow[];
  engineers: ReportEngineerRow[];
  ccos: ReportCcoRow[];
};

// ─── Engineer report (record level) ─────────────────────────────────────────

export const engineerReportQuerySchema = z.object({
  jobNumber: z.string().trim().max(40).optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
  engineerId: z.uuid().optional(),
  status: z.string().max(40).optional(),
  branchId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type EngineerReportQuery = z.output<typeof engineerReportQuerySchema>;

export type EngineerReportRowDto = {
  job: { id: string; jobNumber: string; createdAt: string; status: string; branchCode: string };
  customer: string;
  product: string;
  problem: string;
  engineer: string | null;
  assignedAt: string | null;
  lastStatusAt: string | null;
  repairedAt: string | null;
  testingAt: string | null;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID' | 'NO_CHARGE' | 'REFUND_DUE';
  transferHistory: string;
  remarks: string | null;
};

// ─── Dashboard summary (old "All / Datewise / Total In / Out / Balance / 15 days / Pending") ───

export const dashboardSummaryQuerySchema = z.object({
  from: businessDate.optional(),
  to: businessDate.optional(),
  branchId: z.uuid().optional(),
});

export type DashboardSummaryDto = {
  totalJobs: number;
  totalIn: number; // received in the period
  totalOut: number; // delivered in the period
  pending: number; // open now
  underRepair: number; // with an engineer now
  over15Days: number;
  totalAmount: number;
  totalPaid: number;
  totalBalance: number;
  engineerPending: { engineerId: string; engineer: string; pending: number }[];
};
