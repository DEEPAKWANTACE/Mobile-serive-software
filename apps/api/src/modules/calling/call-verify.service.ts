import type { CallRecordsInput, CallRecordsResult } from '@msm/shared';
import { prisma } from '../../lib/prisma.ts';

/**
 * Call verification: a CCO's logged call becomes VERIFIED when a telephony / carrier call record to the same
 * customer number exists within 30 minutes of it. Records arrive by webhook or by importing the carrier's call log.
 */
const WINDOW_MS = 30 * 60_000;

export const normalizePhone = (p: string) => p.replace(/\D/g, '').slice(-10);

export async function ingest(input: CallRecordsInput, origin: 'WEBHOOK' | 'IMPORT', branchId?: string | null): Promise<CallRecordsResult> {
  const data = input.records
    .map((r) => {
      const phone = normalizePhone(r.phone);
      const at = new Date(r.calledAt);
      return {
        phone,
        calledAt: at,
        durationSec: r.durationSec,
        connected: r.connected ?? r.durationSec > 0,
        externalId: r.externalId ?? `${phone}:${at.getTime()}`,
        agent: r.agent ?? null,
        origin,
        branchId: branchId ?? null,
      };
    })
    .filter((r) => r.phone.length >= 5 && !Number.isNaN(r.calledAt.getTime()));
  const { count } = await prisma.callRecord.createMany({ data, skipDuplicates: true });
  const verified = data.length ? await verifyLogs(new Date(Math.min(...data.map((d) => d.calledAt.getTime())) - WINDOW_MS), new Date(Math.max(...data.map((d) => d.calledAt.getTime())) + WINDOW_MS)) : 0;
  return { received: input.records.length, inserted: count, verified };
}

/** Match unverified manual call logs created in the window against stored call records. */
export async function verifyLogs(from: Date, to: Date) {
  const logs = await prisma.callLog.findMany({
    where: { source: 'MANUAL', createdAt: { gte: from, lte: to } },
    select: { id: true, createdAt: true, job: { select: { customer: { select: { phone: true, altPhone: true } } } } },
    take: 5000,
  });
  if (!logs.length) return 0;
  const records = await prisma.callRecord.findMany({ where: { calledAt: { gte: new Date(from.getTime() - WINDOW_MS), lte: new Date(to.getTime() + WINDOW_MS) } }, select: { id: true, phone: true, calledAt: true } });
  let verified = 0;
  for (const l of logs) {
    const phones = [l.job.customer.phone, l.job.customer.altPhone].filter((p): p is string => !!p).map(normalizePhone);
    const hit = records.find((r) => phones.includes(r.phone) && Math.abs(r.calledAt.getTime() - l.createdAt.getTime()) <= WINDOW_MS);
    if (hit) {
      await prisma.callLog.update({ where: { id: l.id }, data: { source: 'VERIFIED', verifiedRecordId: hit.id } });
      verified += 1;
    }
  }
  return verified;
}

/** Called right after a CCO logs a call, in case the carrier record already arrived. */
export async function verifyOne(logId: string) {
  const log = await prisma.callLog.findUnique({ where: { id: logId }, select: { createdAt: true } });
  if (log) await verifyLogs(new Date(log.createdAt.getTime() - 1000), new Date(log.createdAt.getTime() + 1000));
}
