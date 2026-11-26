import { JOB_STATUS_LABELS } from '@msm/shared';
import { env } from '../../config/env.ts';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { publicJobNumber } from '../jobs/job-number.ts';

/**
 * Posts every job sheet status change to a Discord channel: time, job number and new status only.
 * It reads new rows of the status history, so every path that changes a status is covered and only
 * committed changes are posted. Starts after the latest row at boot; nothing is posted twice.
 */
const POLL_MS = 10_000;
const MAX_MESSAGE = 1_900; // Discord limit is 2000 characters
const BATCH = 200;

const timeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: env.APP_TIMEZONE,
  day: '2-digit',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

async function post(token: string, channelId: string, content: string) {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export function startDiscordJobLog() {
  const token = env.DISCORD_BOT_TOKEN;
  const channelId = env.DISCORD_JOB_LOG_CHANNEL_ID;
  if (!token || !channelId) return;

  let lastId: bigint | null = null;
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (lastId === null) {
        const latest = await prisma.jobStatusHistory.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
        lastId = latest?.id ?? 0n;
        return;
      }
      const rows = await prisma.jobStatusHistory.findMany({
        where: { id: { gt: lastId } },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, toStatus: true, changedAt: true, job: { select: { jobNumber: true } } },
      });
      // Send in messages of up to ~1900 characters; advance only past rows that were delivered.
      let chunk: string[] = [];
      let chunkEnd = lastId;
      const flush = async () => {
        if (!chunk.length) return;
        await post(token, channelId, chunk.join('\n'));
        lastId = chunkEnd;
        chunk = [];
      };
      for (const r of rows) {
        const line = `${timeFormat.format(r.changedAt)} · ${publicJobNumber(r.job.jobNumber)} · ${JOB_STATUS_LABELS[r.toStatus]}`;
        if (chunk.join('\n').length + line.length + 1 > MAX_MESSAGE) await flush();
        chunk.push(line);
        chunkEnd = r.id;
      }
      await flush();
    } catch (err) {
      logger.warn({ err }, 'Discord job log: post failed, will retry');
    } finally {
      busy = false;
    }
  };

  void tick();
  setInterval(() => void tick(), POLL_MS).unref();
  logger.info('Discord job log enabled');
}
