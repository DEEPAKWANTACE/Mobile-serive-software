import { useState } from 'react';
import type { ReminderAssigneeDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';

export type ReminderFormValue = { title: string; dueAt: string; assignedToId: string };

export const toLocalDateTime = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const future = (minutes: number) => toLocalDateTime(new Date(Date.now() + minutes * 60_000).toISOString());
const tomorrowOne = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(13, 0, 0, 0);
  return toLocalDateTime(date.toISOString());
};

export function ReminderForm({ assignees, initial, onSave, onCancel, loading }: {
  assignees: ReminderAssigneeDto[];
  initial?: ReminderFormValue;
  onSave: (value: ReminderFormValue) => void;
  onCancel?: () => void;
  loading?: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [dueAt, setDueAt] = useState(initial?.dueAt ? toLocalDateTime(initial.dueAt) : future(15));
  const [assignedToId, setAssignedToId] = useState(initial?.assignedToId ?? assignees[0]?.id ?? '');
  const valid = title.trim().length >= 3 && !!dueAt && new Date(dueAt).getTime() > Date.now() && !!assignedToId;
  return (
    <div className="space-y-4">
      <Field label="Reminder" required>
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} placeholder="Call customer, order a part, take approval…" autoFocus />
      </Field>
      {assignees.length > 1 && (
        <Field label="Assign to" required hint="Only staff below your role in your branch are available">
          <select value={assignedToId} onChange={(event) => setAssignedToId(event.target.value)} className={inputClass}>
            {assignees.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role.replaceAll('_', ' ')}</option>)}
          </select>
        </Field>
      )}
      <Field label="Reminder time" required>
        <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setDueAt(future(15))}>15 min</Button>
        <Button size="sm" variant="secondary" onClick={() => setDueAt(future(30))}>30 min</Button>
        <Button size="sm" variant="secondary" onClick={() => setDueAt(future(120))}>2 hours</Button>
        <Button size="sm" variant="secondary" onClick={() => setDueAt(tomorrowOne())}>Tomorrow 1 PM</Button>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button disabled={!valid || loading} onClick={() => onSave({ title: title.trim(), dueAt: new Date(dueAt).toISOString(), assignedToId })}>{initial ? 'Save changes' : 'Set reminder'}</Button>
      </div>
    </div>
  );
}
