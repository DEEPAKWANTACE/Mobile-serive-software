import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock3, Pencil, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { ReminderAssigneeDto, ReminderDto } from '@msm/shared';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDateTime } from '@/lib/format';
import { ReminderForm, type ReminderFormValue } from './ReminderForm';

export function MyRemindersPage() {
  const queryClient = useQueryClient();
  const [showCompleted, setShowCompleted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ReminderDto | null>(null);
  const reminders = useQuery({ queryKey: ['reminders', 'mine'], queryFn: () => api.get<ReminderDto[]>('/reminders/mine') });
  const assignees = useQuery({ queryKey: ['reminders', 'assignees'], queryFn: () => api.get<ReminderAssigneeDto[]>('/reminders/assignees') });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['reminders'] });
  };
  const create = useMutation({
    mutationFn: (value: ReminderFormValue) => api.post('/reminders', { ...value, jobId: null }),
    onSuccess: () => { toast.success('Reminder set'); setAdding(false); refresh(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not set reminder'),
  });
  const update = useMutation({
    mutationFn: ({ id, value }: { id: string; value: ReminderFormValue }) => api.patch(`/reminders/${id}`, value),
    onSuccess: () => { toast.success('Reminder updated'); setEditing(null); refresh(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not update reminder'),
  });
  const complete = useMutation({
    mutationFn: (id: string) => api.post(`/reminders/${id}/complete`),
    onSuccess: () => { toast.success('Reminder completed'); refresh(); },
  });
  const visible = (reminders.data ?? []).filter((reminder) => showCompleted ? !!reminder.completedAt : !reminder.completedAt);

  return (
    <div className="space-y-5">
      <PageHeader title="My Reminders" description="Your assigned tasks and reminders you created for branch staff" actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add reminder</Button>} />
      <div className="flex gap-2">
        <Button size="sm" variant={!showCompleted ? 'primary' : 'secondary'} onClick={() => setShowCompleted(false)}>Pending</Button>
        <Button size="sm" variant={showCompleted ? 'primary' : 'secondary'} onClick={() => setShowCompleted(true)}>Completed</Button>
      </div>
      {reminders.isLoading && <p className="py-10 text-center text-sm text-slate-500">Loading…</p>}
      {!reminders.isLoading && !visible.length && <p className="rounded-lg bg-white py-12 text-center text-sm text-slate-500 ring-1 ring-slate-200">No {showCompleted ? 'completed' : 'pending'} reminders</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {visible.map((reminder) => {
          const overdue = !reminder.completedAt && new Date(reminder.dueAt).getTime() <= Date.now();
          return (
            <article key={reminder.id} className={`rounded-xl p-4 ring-1 ${overdue ? 'bg-red-50 ring-red-200' : reminder.completedAt ? 'bg-slate-50 ring-slate-200' : 'bg-white ring-slate-200'}`}>
              <div className="flex items-start gap-3">
                <Clock3 className={`mt-0.5 size-5 shrink-0 ${overdue ? 'text-red-600' : 'text-amber-600'}`} />
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-slate-900">{reminder.title}</h2>
                  <p className={`mt-1 text-sm ${overdue ? 'font-semibold text-red-700' : 'text-slate-600'}`}>{reminder.completedAt ? `Completed ${formatDateTime(reminder.completedAt)}` : `${overdue ? 'Overdue' : 'Due'} ${formatDateTime(reminder.dueAt)}`}</p>
                  <p className="mt-2 text-xs text-slate-500">Assigned to {reminder.assignedTo.name} · Created by {reminder.createdBy.name}</p>
                  {reminder.job && <Link to={`/jobs/${reminder.job.id}`} className="mt-1 inline-block text-sm text-brand-700 hover:underline">Job {reminder.job.jobNumber}</Link>}
                </div>
                {!reminder.completedAt && <div className="flex gap-1">
                  {reminder.canEdit && <button type="button" onClick={() => setEditing(reminder)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" title="Edit reminder"><Pencil className="size-4" /></button>}
                  {reminder.canComplete && <button type="button" onClick={() => complete.mutate(reminder.id)} className="rounded-md p-2 text-emerald-700 hover:bg-emerald-100" title="Mark complete"><Check className="size-4" /></button>}
                </div>}
              </div>
            </article>
          );
        })}
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add reminder">
        {adding && assignees.data && <ReminderForm assignees={assignees.data} onSave={(value) => create.mutate(value)} onCancel={() => setAdding(false)} loading={create.isPending} />}
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit reminder">
        {editing && assignees.data && <ReminderForm
          assignees={assignees.data}
          initial={{ title: editing.title, dueAt: editing.dueAt, assignedToId: editing.assignedTo.id }}
          onSave={(value) => update.mutate({ id: editing.id, value })}
          onCancel={() => setEditing(null)} loading={update.isPending}
        />}
      </Modal>
    </div>
  );
}
