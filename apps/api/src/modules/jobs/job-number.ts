import type { Prisma } from '../../generated/prisma/client.ts';
import { env } from '../../config/env.ts';

/** "YYMM" for the given date in the business timezone. */
function period(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: env.APP_TIMEZONE, year: '2-digit', month: '2-digit' })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}${parts.month}`;
}

/**
 * Next job number for a branch, e.g. "AND01-2610-0001". The sequence restarts every month.
 * The upsert row-locks the counter, so concurrent job creation in the same branch is serialised
 * and numbers are never duplicated. Must run inside the job-creating transaction.
 */
export async function nextJobNumber(tx: Prisma.TransactionClient, branch: { id: string; code: string }, now = new Date()) {
  const p = period(now);
  const [row] = await tx.$queryRaw<{ last_seq: number }[]>`
    INSERT INTO job_counters (branch_id, period, last_seq)
    VALUES (${branch.id}::uuid, ${p}, 1)
    ON CONFLICT (branch_id, period) DO UPDATE SET last_seq = job_counters.last_seq + 1
    RETURNING last_seq`;
  return `${branch.code}-${p}-${String(row!.last_seq).padStart(4, '0')}`;
}
