import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Check, GripVertical, RotateCcw } from 'lucide-react';
import {
  DEFAULT_JOB_LIST_COLUMNS,
  DEFAULT_JOB_LIST_ORDER,
  JOB_LIST_COLUMN_HINTS,
  JOB_LIST_COLUMN_LABELS,
  ROLE_LABELS,
  ROLE_VALUES,
  type JobListColumn,
  type JobListColumnsDto,
  type JobListMode,
  type JobListModeDto,
  type Role,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api-client';
import { jobListColumnsQueryKey, jobListModeQueryKey } from '@/features/jobs/jobListColumns';

/** Columns beyond this make the list scroll sideways on a normal laptop screen. */
const COMFORTABLE_COLUMNS = 9;

/** Tick-box grid: which job sheet list columns each role sees, and their left-to-right order. Job Sheet ID is always shown first. */
export function JobListColumnsPage() {
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: jobListColumnsQueryKey, queryFn: () => api.get<JobListColumnsDto>('/settings/job-list-columns') });
  const [draft, setDraft] = useState<JobListColumnsDto | null>(null);
  const [dragging, setDragging] = useState<JobListColumn | null>(null);
  useEffect(() => {
    if (saved.data && !draft) setDraft(saved.data);
  }, [saved.data, draft]);

  const save = useMutation({
    mutationFn: (data: JobListColumnsDto) => api.put<JobListColumnsDto>('/settings/job-list-columns', data),
    onSuccess: (data) => {
      queryClient.setQueryData(jobListColumnsQueryKey, data);
      setDraft(data);
      toast.success('Job list columns saved — users see the change on their next page load');
    },
    onError: (error) => toast.error(error.message),
  });

  if (!draft) return <div className="p-10 text-center text-slate-500">Loading…</div>;

  // Every role's columns follow the one shared order.
  const withOrder = (d: JobListColumnsDto, order: JobListColumn[]): JobListColumnsDto =>
    ({ ...Object.fromEntries(ROLE_VALUES.map((r) => [r, order.filter((c) => d[r].includes(c))])), order }) as JobListColumnsDto;
  const setRoles = (change: (role: Role, cols: JobListColumn[]) => JobListColumn[]) =>
    setDraft((d) => d && withOrder({ ...d, ...Object.fromEntries(ROLE_VALUES.map((r) => [r, change(r, d[r])])) }, d.order));
  const toggle = (role: Role, column: JobListColumn) =>
    setRoles((r, cols) => (r !== role ? cols : cols.includes(column) ? cols.filter((c) => c !== column) : [...cols, column]));
  const setRow = (column: JobListColumn, on: boolean) =>
    setRoles((_, cols) => (on ? [...cols, column] : cols.filter((c) => c !== column)));
  /** Put `column` where `target` is now (drag and drop), or one step up / down. */
  const move = (column: JobListColumn, to: number) =>
    setDraft((d) => {
      if (!d || to < 0 || to >= d.order.length) return d;
      const order = d.order.filter((c) => c !== column);
      order.splice(to, 0, column);
      return withOrder(d, order);
    });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.data);

  return (
    <div className="space-y-5">
      <PageHeader title="Job List Columns" description="Tick the columns each role sees in the job sheet list, and drag rows (or use the arrows) to set the column order left to right. Job Sheet ID is always shown first." />
      <JobListModeCard />
      <Card
        title="Column matrix"
        subtitle={`Tip: keep around ${COMFORTABLE_COLUMNS - 1} columns or fewer per role — more columns make the list scroll sideways.`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDraft(withOrder({ ...DEFAULT_JOB_LIST_COLUMNS, order: DEFAULT_JOB_LIST_ORDER }, DEFAULT_JOB_LIST_ORDER))}>
              <RotateCcw className="size-4" /> Reset to defaults
            </Button>
            <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(draft)}>Save changes</Button>
          </div>
        }
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 text-left font-semibold text-slate-700">Column <span className="font-normal text-slate-500">(top = left)</span></th>
                {ROLE_VALUES.map((role) => (
                  <th key={role} className="px-3 py-2.5 text-center font-semibold text-slate-700">
                    <div>{ROLE_LABELS[role]}</div>
                    <div className={`text-xs font-normal ${draft[role].length + 1 > COMFORTABLE_COLUMNS ? 'text-orange-600' : 'text-slate-500'}`}>
                      {draft[role].length + 1} columns{draft[role].length + 1 > COMFORTABLE_COLUMNS ? ' · will scroll' : ''}
                    </div>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center font-semibold text-slate-700">All roles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/50">
                <td className="sticky left-0 bg-slate-50 px-3 py-2 font-medium text-slate-500">Job Sheet ID</td>
                {ROLE_VALUES.map((role) => (
                  <td key={role} className="px-3 py-2 text-center"><Check className="mx-auto size-4 text-slate-400" aria-label="Always shown" /></td>
                ))}
                <td className="px-3 py-2 text-center text-xs text-slate-400">Always</td>
              </tr>
              {draft.order.map((column, index) => {
                const onFor = ROLE_VALUES.filter((r) => draft[r].includes(column)).length;
                return (
                  <tr
                    key={column}
                    onDragOver={(event) => { if (dragging) { event.preventDefault(); if (dragging !== column) move(dragging, index); } }}
                    onDrop={(event) => event.preventDefault()}
                    className={`hover:bg-slate-50 ${dragging === column ? 'opacity-50' : ''}`}
                  >
                    <td className="theme-panel sticky left-0 bg-white px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          draggable
                          onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', column); setDragging(column); }}
                          onDragEnd={() => setDragging(null)}
                          title="Drag to reorder"
                          className="cursor-grab text-slate-400 hover:text-slate-600 active:cursor-grabbing"
                        >
                          <GripVertical className="size-4" />
                        </span>
                        <div className="flex flex-col">
                          <button type="button" onClick={() => move(column, index - 1)} disabled={index === 0} aria-label={`Move ${JOB_LIST_COLUMN_LABELS[column]} left`} className="rounded text-slate-500 hover:bg-slate-100 disabled:opacity-25"><ArrowUp className="size-3.5" /></button>
                          <button type="button" onClick={() => move(column, index + 1)} disabled={index === draft.order.length - 1} aria-label={`Move ${JOB_LIST_COLUMN_LABELS[column]} right`} className="rounded text-slate-500 hover:bg-slate-100 disabled:opacity-25"><ArrowDown className="size-3.5" /></button>
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">{JOB_LIST_COLUMN_LABELS[column]}</div>
                          {JOB_LIST_COLUMN_HINTS[column] && <div className="max-w-64 text-xs text-slate-500">{JOB_LIST_COLUMN_HINTS[column]}</div>}
                        </div>
                      </div>
                    </td>
                    {ROLE_VALUES.map((role) => {
                      const on = draft[role].includes(column);
                      return (
                        <td key={role} className="px-3 py-2 text-center">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            aria-label={`${JOB_LIST_COLUMN_LABELS[column]} for ${ROLE_LABELS[role]}`}
                            onClick={() => toggle(role, column)}
                            className={`mx-auto grid size-8 place-items-center rounded-md border-2 transition ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-transparent hover:border-brand-400'}`}
                          >
                            <Check className="size-4" />
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center">
                      <div className="flex justify-center gap-1">
                        <button type="button" onClick={() => setRow(column, true)} disabled={onFor === ROLE_VALUES.length} className="rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-30">All</button>
                        <button type="button" onClick={() => setRow(column, false)} disabled={onFor === 0} className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30">None</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {dirty && <p className="mt-3 text-sm text-orange-700">You have unsaved changes.</p>}
      </Card>
    </div>
  );
}

const MODE_OPTIONS: { value: JobListMode; label: string; hint: string }[] = [
  { value: 'PAGED', label: 'Pages', hint: 'Exactly one screen of jobs with Previous / Next buttons.' },
  { value: 'INFINITE', label: 'Infinite scroll', hint: 'Loads a small batch at a time and fetches the next batch as you scroll down.' },
];

/** Super Admin switch between the paged list and infinite scroll for everyone. */
function JobListModeCard() {
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: jobListModeQueryKey, queryFn: () => api.get<JobListModeDto>('/settings/job-list-mode') });
  const save = useMutation({
    mutationFn: (mode: JobListMode) => api.put<JobListModeDto>('/settings/job-list-mode', { mode }),
    onSuccess: (data) => {
      queryClient.setQueryData(jobListModeQueryKey, data);
      toast.success(data.mode === 'INFINITE' ? 'Job list now uses infinite scroll' : 'Job list now uses pages');
    },
    onError: (error) => toast.error(error.message),
  });
  const mode = save.isPending ? save.variables : current.data?.mode;
  return (
    <Card title="Job list loading" subtitle="How everyone moves through the job sheet list. Users see the change on their next page load.">
      <div className="grid gap-2 sm:grid-cols-2">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={!current.data || save.isPending}
            onClick={() => option.value !== mode && save.mutate(option.value)}
            className={`rounded-lg border-2 p-3 text-left transition disabled:cursor-wait ${mode === option.value ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-brand-300'}`}
          >
            <div className="flex items-center gap-2 font-medium text-slate-800">
              <span className={`grid size-4 place-items-center rounded-full border-2 ${mode === option.value ? 'border-brand-600' : 'border-slate-300'}`}>
                {mode === option.value && <span className="size-2 rounded-full bg-brand-600" />}
              </span>
              {option.label}
            </div>
            <p className="mt-1 text-xs text-slate-500">{option.hint}</p>
          </button>
        ))}
      </div>
    </Card>
  );
}
