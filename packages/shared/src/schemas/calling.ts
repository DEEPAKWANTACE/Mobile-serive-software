import { z } from 'zod';
import { optionalText } from './common.js';
import type { JobStatus } from './jobs.js';

export const CALL_PURPOSES = ['READY_PICKUP', 'RWR_PICKUP', 'APPROVAL', 'FOLLOW_UP', 'OTHER'] as const;
export type CallPurpose = (typeof CALL_PURPOSES)[number];
export const CALL_PURPOSE_LABELS: Record<CallPurpose, string> = {
  READY_PICKUP: 'Ready — please collect',
  RWR_PICKUP: 'Not repaired — please collect',
  APPROVAL: 'Estimate approval',
  FOLLOW_UP: 'Follow-up',
  OTHER: 'Other',
};

export const CALL_OUTCOMES = ['WILL_COLLECT', 'CALL_LATER', 'NOT_ANSWERED', 'SWITCHED_OFF', 'WRONG_NUMBER', 'OTHER'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  WILL_COLLECT: 'Answered — will collect',
  CALL_LATER: 'Answered — call later',
  NOT_ANSWERED: 'Not answered',
  SWITCHED_OFF: 'Switched off / not reachable',
  WRONG_NUMBER: 'Wrong number',
  OTHER: 'Other',
};

/** Suggested call purpose for a job's current status. */
export const purposeForStatus = (status: JobStatus): CallPurpose =>
  status === 'READY_FOR_DELIVERY' ? 'READY_PICKUP' : status === 'RWR' ? 'RWR_PICKUP' : status === 'AWAITING_APPROVAL' ? 'APPROVAL' : 'FOLLOW_UP';

export const callLogCreateSchema = z.object({
  purpose: z.enum(CALL_PURPOSES),
  outcome: z.enum(CALL_OUTCOMES, 'Select the call result'),
  note: optionalText(500),
  /** ISO date-time for the next call / promised visit. */
  nextFollowUpAt: z.iso.datetime({ offset: true }).nullish(),
});
export type CallLogCreateInput = z.input<typeof callLogCreateSchema>;
export type CallLogCreateData = z.output<typeof callLogCreateSchema>;

export type CallLogDto = {
  id: string;
  purpose: CallPurpose;
  outcome: CallOutcome;
  note: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
};

export const callingListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  /** ready = repaired & waiting · rwr = unrepaired & waiting · due = follow-ups due by end of today · approval = estimates to confirm */
  list: z.enum(['ready', 'rwr', 'due', 'approval']).default('ready'),
});
export type CallingListQuery = z.output<typeof callingListQuerySchema>;

/** A job on the calling / pending-collection list. */
export type CallingRowDto = {
  job: { id: string; jobNumber: string; status: JobStatus; device: string; branchCode: string };
  customer: { name: string; phone: string; altPhone: string | null };
  /** When the phone became ready / RWR (or the estimate was sent). */
  since: string | null;
  daysWaiting: number;
  /** Amount still to collect (negative = refund due). */
  balance: number;
  attempts: number;
  lastCall: { outcome: CallOutcome; at: string; by: string; note: string | null } | null;
  nextFollowUpAt: string | null;
};

export type PendingCollectionSummaryDto = {
  ready: { count: number; amount: number };
  rwr: { count: number; refunds: number };
  followUpsDue: number;
};
