import { Link } from 'react-router';

type Props = { label: string; value: number | undefined; to?: string; tone?: 'default' | 'warning' | 'info' };

const tones = { default: 'text-slate-900', warning: 'text-amber-600', info: 'text-sky-600' };

export function StatCard({ label, value, to, tone = 'default' }: Props) {
  const body = (
    <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200 transition-shadow hover:shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${tones[tone]}`}>{value ?? '–'}</div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}
