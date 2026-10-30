import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, Clock3, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { NotificationFeedDto } from '@msm/shared';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { formatDateTime } from '@/lib/format';

type When = '15' | '20' | '30' | 'TOMORROW_1' | 'CUSTOM';

const dueFor = (when: When, custom: string) => {
  if (when === 'CUSTOM') return custom ? new Date(custom).toISOString() : '';
  if (when === 'TOMORROW_1') {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(13, 0, 0, 0);
    return date.toISOString();
  }
  return new Date(Date.now() + Number(when) * 60_000).toISOString();
};

export function ReminderCenter() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState<When>('15');
  const [custom, setCustom] = useState('');
  const feed = useQuery({
    queryKey: ['reminders'],
    queryFn: () => api.get<NotificationFeedDto>('/reminders'),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    for (const item of feed.data?.items ?? []) {
      if (!item.isDue || item.kind !== 'REMINDER') continue;
      const key = `reminder-notified:${item.id}`;
      if (sessionStorage.getItem(key)) continue;
      sessionStorage.setItem(key, '1');
      toast.warning(item.title, { duration: 15_000, description: `Reminder due ${formatDateTime(item.dueAt)}` });
    }
  }, [feed.data]);

  const create = useMutation({
    mutationFn: () => api.post('/reminders', { title, dueAt: dueFor(when, custom), jobId: null }),
    onSuccess: () => {
      toast.success('Reminder set');
      setTitle('');
      setAdding(false);
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not set reminder'),
  });
  const complete = useMutation({
    mutationFn: (id: string) => api.post(`/reminders/${id}/complete`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reminders'] }),
  });
  const canSubmit = title.trim().length >= 3 && !!dueFor(when, custom);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications and reminders">
        <Bell className="size-5" />
        {!!feed.data?.dueCount && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">{Math.min(feed.data.dueCount, 99)}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Notifications & reminders">
        <div className="space-y-4">
          {!adding ? (
            <Button onClick={() => setAdding(true)}><Plus className="size-4" /> New reminder</Button>
          ) : (
            <div className="space-y-3 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
              <Field label="Remind me to" required>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="Call customer, order a part, take approval…" autoFocus />
              </Field>
              <Field label="When">
                <select value={when} onChange={(e) => setWhen(e.target.value as When)} className={inputClass}>
                  <option value="15">In 15 minutes</option>
                  <option value="20">In 20 minutes</option>
                  <option value="30">In 30 minutes</option>
                  <option value="TOMORROW_1">Tomorrow at 1:00 PM</option>
                  <option value="CUSTOM">Custom date & time</option>
                </select>
              </Field>
              {when === 'CUSTOM' && <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className={inputClass} />}
              <div className="flex gap-2"><Button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>Set reminder</Button><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button></div>
            </div>
          )}
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {feed.isLoading && <p className="py-6 text-center text-sm text-slate-500">Loading…</p>}
            {!feed.isLoading && !feed.data?.items.length && <p className="py-6 text-center text-sm text-slate-500">No pending notifications</p>}
            {feed.data?.items.map((item) => (
              <div key={item.id} className={`flex items-start gap-3 rounded-lg p-3 ring-1 ${item.isDue ? 'bg-red-50 ring-red-200' : 'bg-white ring-slate-200'}`}>
                <span className={`mt-0.5 rounded-full p-1.5 ${item.kind === 'APPROVAL' ? 'bg-orange-100 text-orange-700' : item.isDue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}><Clock3 className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.kind === 'APPROVAL' ? 'Approval' : item.kind === 'JOB_DEADLINE' ? 'Job timer' : 'Reminder'}</div>
                  {item.jobId ? <Link to={`/jobs/${item.jobId}`} onClick={() => setOpen(false)} className="font-medium text-brand-700 hover:underline">{item.title}</Link> : <div className="font-medium">{item.title}</div>}
                  <div className={`mt-0.5 text-xs ${item.isDue ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{item.isDue ? 'Due' : 'Due'} {formatDateTime(item.dueAt)}</div>
                </div>
                {item.kind === 'REMINDER' && <button type="button" onClick={() => complete.mutate(item.id)} className="rounded-md p-2 text-emerald-700 hover:bg-emerald-100" title="Mark done"><Check className="size-4" /></button>}
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
}
