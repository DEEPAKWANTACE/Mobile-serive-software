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
