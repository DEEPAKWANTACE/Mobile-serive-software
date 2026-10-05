import { env } from '../config/env.ts';

/** Offset (ms) of the business timezone from UTC at a given instant. */
function tzOffsetMs(at: Date, tz = env.APP_TIMEZONE) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - at.getTime();
}

/** Today's business date, YYYY-MM-DD. */
export function businessToday(now = new Date()) {
  return new Date(now.getTime() + tzOffsetMs(now)).toISOString().slice(0, 10);
}

/** UTC instant when a business date (YYYY-MM-DD) starts. */
export function startOfBusinessDay(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - tzOffsetMs(new Date(guess)));
}

/** Half-open UTC range [from 00:00, day after `to` 00:00) for inclusive business dates. */
export function businessRange(from: string, to: string) {
  const end = startOfBusinessDay(to);
  return { gte: startOfBusinessDay(from), lt: new Date(end.getTime() + 86_400_000) };
}
