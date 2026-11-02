import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { DiagnosisFindingDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api-client';

type Draft = { label: string; sortOrder: number; isActive: boolean };

export function DiagnosisFindingsPage() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [editing, setEditing] = useState<DiagnosisFindingDto | null>(null);
  const findings = useQuery({
    queryKey: ['settings', 'diagnosis-findings', 'all'],
    queryFn: () => api.get<DiagnosisFindingDto[]>('/settings/diagnosis-findings?all=true'),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['settings', 'diagnosis-findings'] });
  const create = useMutation({
    mutationFn: () => api.post('/settings/diagnosis-findings', { label, sortOrder }),
    onSuccess: () => {
      toast.success('Diagnosis finding added');
      setLabel('');
      setSortOrder(0);
      void refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Diagnosis Findings" description="Options shown to engineers under “What did you find?”" />
      <Card title="Add finding" subtitle="Engineers may select one or more presets and still add free-text notes">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!label.trim()) return;
            create.mutate();
          }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
        >
          <Field label="Finding">
            <input value={label} onChange={(event) => setLabel(event.target.value)} className={inputClass} placeholder="e.g. Charging IC shorted" />
          </Field>
          <Field label="Display order">
            <input type="number" min={0} max={999} value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} className={inputClass} />
          </Field>
          <Button type="submit" loading={create.isPending}>Add finding</Button>
        </form>
      </Card>
      <Card title={`Findings (${findings.data?.length ?? 0})`}>
        <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
          {(findings.data ?? []).map((finding) => (
            <div key={finding.id} className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3">
              <div>
                <div className={`font-medium ${finding.isActive ? 'text-slate-900' : 'text-slate-400 line-through'}`}>{finding.label}</div>
                <div className="text-xs text-slate-500">Order {finding.sortOrder} · {finding.isActive ? 'Available to engineers' : 'Inactive'}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEditing(finding)}>Edit</Button>
            </div>
          ))}
          {!findings.isLoading && !findings.data?.length && <p className="p-4 text-sm text-slate-500">No diagnosis findings configured.</p>}
        </div>
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit diagnosis finding" size="sm">
        {editing && <EditFinding finding={editing} onDone={() => { setEditing(null); void refresh(); }} />}
      </Modal>
    </div>
  );
}

function EditFinding({ finding, onDone }: { finding: DiagnosisFindingDto; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft>({ label: finding.label, sortOrder: finding.sortOrder, isActive: finding.isActive });
  const save = useMutation({
    mutationFn: () => api.patch(`/settings/diagnosis-findings/${finding.id}`, draft),
    onSuccess: () => {
      toast.success('Diagnosis finding updated');
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }} className="space-y-4">
      <Field label="Finding" required>
        <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} className={inputClass} />
      </Field>
      <Field label="Display order">
        <input type="number" min={0} max={999} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} className={inputClass} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} className="size-4 accent-brand-600" />
        Available to engineers
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Save changes</Button>
      </div>
    </form>
  );
}
