const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

export const formatCurrency = (amount: number) => inr.format(amount);

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/** Compact age, e.g. "5m", "3h", "2d". */
export function timeAgo(iso: string) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Today's date in the business timezone (India), YYYY-MM-DD. */
export const todayIso = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
};

export const formatDate = (ymdOrIso: string) =>
  new Date(ymdOrIso.length === 10 ? `${ymdOrIso}T00:00:00` : ymdOrIso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
