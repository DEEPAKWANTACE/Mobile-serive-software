import { useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Field, inputClass } from '@/components/ui/Field';
import { formatDateTime } from '@/lib/format';

type Mode = 'NONE' | 'ONE_PM' | 'TWO_HOURS' | 'DURATION' | 'TIME';

const nextOnePm = () => {
  const date = new Date();
  date.setHours(13, 0, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date.toISOString();
};

export function DeadlinePicker({ value, onChange, error }: { value?: string | null; onChange: (value: string | null) => void; error?: string }) {
  const [mode, setMode] = useState<Mode>(value ? 'TIME' : 'NONE');
  const [amount, setAmount] = useState('30');
  const [unit, setUnit] = useState<'minutes' | 'hours' | 'days'>('minutes');

  const setDuration = (nextAmount = amount, nextUnit = unit) => {
    const n = Number(nextAmount);
    if (!Number.isFinite(n) || n <= 0) return onChange(null);
    const factor = nextUnit === 'minutes' ? 60_000 : nextUnit === 'hours' ? 3_600_000 : 86_400_000;
    onChange(new Date(Date.now() + n * factor).toISOString());
  };
  const localValue = value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <div className="mb-3 flex items-center gap-2 font-medium text-amber-950"><Clock3 className="size-4" /> Completion timer</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Complete by" error={error} hint="Timed jobs are highlighted and placed first for the whole branch">
          <select
            value={mode}
            onChange={(e) => {
              const next = e.target.value as Mode;
              setMode(next);
              if (next === 'NONE') onChange(null);
              if (next === 'ONE_PM') onChange(nextOnePm());
              if (next === 'TWO_HOURS') onChange(new Date(Date.now() + 2 * 3_600_000).toISOString());
              if (next === 'DURATION') setDuration();
              if (next === 'TIME') onChange(null);
            }}
            className={inputClass}
          >
            <option value="NONE">No timer</option>
            <option value="ONE_PM">By 1:00 PM</option>
            <option value="TWO_HOURS">Within 2 hours</option>
            <option value="DURATION">Custom duration</option>
            <option value="TIME">Custom date & time</option>
          </select>
        </Field>
        {mode === 'DURATION' && (
          <Field label="Duration">
            <div className="flex gap-2">
              <input type="number" min="1" value={amount} onChange={(e) => { setAmount(e.target.value); setDuration(e.target.value, unit); }} className={inputClass} />
              <select value={unit} onChange={(e) => { const next = e.target.value as typeof unit; setUnit(next); setDuration(amount, next); }} className={inputClass}>
                <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
              </select>
            </div>
          </Field>
        )}
        {mode === 'TIME' && (
          <Field label="Date & time">
            <input type="datetime-local" min={new Date().toISOString().slice(0, 16)} value={localValue} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} className={inputClass} />
          </Field>
        )}
      </div>
      {value && <p className="mt-2 text-xs font-medium text-amber-800">Deadline: {formatDateTime(value)}</p>}
    </div>
  );
}
