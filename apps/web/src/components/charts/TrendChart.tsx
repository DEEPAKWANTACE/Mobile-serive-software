import { useEffect, useMemo, useRef, useState } from 'react';

export type TrendSeries = { key: string; label: string; color: string };

type Props<T extends { date: string }> = {
  data: T[];
  series: TrendSeries[];
  height?: number;
  ariaLabel: string;
};

const PAD = { top: 12, right: 12, bottom: 28, left: 32 };
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow / (v / pow > 5 ? 2 : 1)) * pow * (v / pow > 5 ? 2 : 1);
}

/**
 * Multi-series line chart on ONE axis (counts). Thin 2px lines, recessive solid gridlines, legend always present,
 * crosshair + tooltip on hover, and an equivalent table for screen readers.
 */
export function TrendChart<T extends { date: string }>({ data, series, height = 220, ariaLabel }: Props<T>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const value = (row: T, key: string) => Number((row as Record<string, unknown>)[key] ?? 0);
  const max = useMemo(() => niceMax(Math.max(1, ...data.flatMap((r) => series.map((s) => value(r, s.key))))), [data, series]);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 70)));
  const hovered = hover !== null ? data[hover] : null;

  return (
    // `relative` keeps the visually-hidden table anchored here (otherwise it stretches the page's scroll height).
    <div className="relative">
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-600" aria-hidden>
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#eef0f3" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">
                {Number.isInteger(t) ? t : ''}
              </text>
            </g>
          ))}
          {data.map((r, i) =>
            i % labelEvery === 0 || i === data.length - 1 ? (
              <text
                key={r.date}
                x={x(i)}
                y={height - 8}
                textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
                className="fill-slate-400 text-[10px]"
              >
                {fmtDay(r.date)}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="#cbd5e1" strokeWidth={1} />}
          {series.map((s) => (
            <polyline
              key={s.key}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={data.map((r, i) => `${x(i)},${y(value(r, s.key))}`).join(' ')}
            />
          ))}
          {hover !== null &&
            series.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(value(data[hover]!, s.key))} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />
            ))}
          {/* Hit areas: one column per day, wider than the marks. */}
          {data.map((r, i) => (
            <rect
              key={r.date}
              x={x(i) - innerW / Math.max(1, data.length - 1) / 2}
              y={PAD.top}
              width={innerW / Math.max(1, data.length - 1)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 min-w-36 rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200"
            style={{ left: Math.min(Math.max(x(hover!) + 12, 0), width - 160), top: PAD.top }}
          >
            <div className="mb-1 font-medium text-slate-700">{fmtDay(hovered.date)}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-semibold text-slate-900 tabular-nums">{value(hovered, s.key)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th>Date</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.date}>
              <td>{r.date}</td>
              {series.map((s) => (
                <td key={s.key}>{value(r, s.key)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
