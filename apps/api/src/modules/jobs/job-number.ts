import type { Prisma } from '../../generated/prisma/client.ts';
import { env } from '../../config/env.ts';

/** "YYMM" remains the billing period used by invoice numbering. */
export function period(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: env.APP_TIMEZONE, year: '2-digit', month: '2-digit' })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}`;
}
/**
 * Next public job-sheet number. One counter is shared by every branch and never resets.
 * It is four digits until 9999 and then grows naturally (10000, 10001, ...).
 * The upsert row-locks the counter, so concurrent creation cannot duplicate a number.
 * Must run inside the job-creating transaction.
 */
export async function nextJobNumber(tx: Prisma.TransactionClient, _branch: { id: string; code: string }) {
  const [row] = await tx.$queryRaw<{ last_seq: number }[]>`
    INSERT INTO job_global_counters (period, last_seq)
    VALUES ('GLOBAL', 1)
    ON CONFLICT (period) DO UPDATE SET last_seq = job_global_counters.last_seq + 1
    RETURNING last_seq`;
  return String(row!.last_seq).padStart(4, '0');
}

/** Public display for legacy prefixed numbers and the new numeric-only format. */
export function publicJobNumber(jobNumber: string) {
  return jobNumber.match(/\d+$/)?.[0] ?? jobNumber;
}
