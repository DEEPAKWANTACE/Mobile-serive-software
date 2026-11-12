import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { DiagnosisFindingDto, DiagnosisFindingTypeDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api-client';

type FindingDraft = { label: string; typeId: string; sortOrder: number; isActive: boolean };
type TypeDraft = { name: string; sortOrder: number; isActive: boolean };

export function DiagnosisFindingsPage() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [typeId, setTypeId] = useState('');
  const [editing, setEditing] = useState<DiagnosisFindingDto | null>(null);
  const [editingType, setEditingType] = useState<DiagnosisFindingTypeDto | null>(null);
  const [typeName, setTypeName] = useState('');
  const [typeOrder, setTypeOrder] = useState(0);

  const types = useQuery({
    queryKey: ['settings', 'diagnosis-finding-types', 'all'],
    queryFn: () => api.get<DiagnosisFindingTypeDto[]>('/settings/diagnosis-finding-types?all=true'),
  });
  const findings = useQuery({
    queryKey: ['settings', 'diagnosis-findings', 'all'],
    queryFn: () => api.get<DiagnosisFindingDto[]>('/settings/diagnosis-findings?all=true'),
  });
  const activeTypes = (types.data ?? []).filter((t) => t.isActive);
  // Default the "Add finding" type to the first active type once types load.
  useEffect(() => {
    if (!typeId && activeTypes[0]) setTypeId(activeTypes[0].id);
  }, [typeId, activeTypes]);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['settings', 'diagnosis-findings'] }),
    queryClient.invalidateQueries({ queryKey: ['settings', 'diagnosis-finding-types'] }),
  ]);
  const create = useMutation({
    mutationFn: () => api.post('/settings/diagnosis-findings', { label, typeId, sortOrder }),
    onSuccess: () => {
      toast.success('Diagnosis finding added');
      setLabel('');
      setSortOrder(0);
      void refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const createType = useMutation({
    mutationFn: () => api.post('/settings/diagnosis-finding-types', { name: typeName, sortOrder: typeOrder }),
    onSuccess: () => {
      toast.success('Type added');
      setTypeName('');
      setTypeOrder(0);
      void refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Diagnosis Findings" description="Options shown to engineers under “What did you find?”" />

      <Card title="Problem types" subtitle="The “Problem type” dropdown in the engineer's diagnosis popup (e.g. Hardware, Software)">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (typeName.trim().length < 2) return;
            createType.mutate();
          }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
        >
          <Field label="Type name">
            <input value={typeName} onChange={(event) => setTypeName(event.target.value)} className={inputClass} placeholder="e.g. Water damage" />
          </Field>
          <Field label="Display order">
            <input type="number" min={0} max={999} value={typeOrder} onChange={(event) => setTypeOrder(Number(event.target.value))} className={inputClass} />
          </Field>
          <Button type="submit" loading={createType.isPending}>Add type</Button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {(types.data ?? []).map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => setEditingType(type)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm hover:border-brand-400 ${type.isActive ? 'border-slate-300 bg-white text-slate-800' : 'border-slate-200 bg-slate-50 text-slate-400 line-through'}`}
              title="Edit type"
            >
              {type.name}
              <span className="text-xs text-slate-500">#{type.sortOrder} · {(findings.data ?? []).filter((f) => f.type.id === type.id).length} findings</span>
              <span className="text-xs font-medium text-brand-600">Edit</span>
            </button>
          ))}
          {!types.isLoading && !types.data?.length && <p className="text-sm text-slate-500">No types yet — add one above.</p>}
        </div>
      </Card>

      <Card title="Add finding" subtitle="Engineers may select one or more presets and still add free-text notes">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!label.trim() || !typeId) return;
            create.mutate();
          }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_11rem_9rem_auto] sm:items-end"
        >
          <Field label="Finding">
            <input value={label} onChange={(event) => setLabel(event.target.value)} className={inputClass} placeholder="e.g. Charging IC shorted" />
          </Field>
          <Field label="Type">
            <select value={typeId} onChange={(event) => setTypeId(event.target.value)} className={inputClass}>
              {activeTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </Field>
          <Field label="Display order">
            <input type="number" min={0} max={999} value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} className={inputClass} />
          </Field>
          <Button type="submit" loading={create.isPending} disabled={!typeId}>Add finding</Button>
        </form>
      </Card>

      <Card title={`Findings (${findings.data?.length ?? 0})`}>
        <div className="grid gap-4 lg:grid-cols-2">
          {(types.data ?? []).map((type) => {
            const list = (findings.data ?? []).filter((f) => f.type.id === type.id);
            return (
              <div key={type.id}>
                <div className={`mb-2 text-xs font-semibold tracking-wide uppercase ${type.isActive ? 'text-slate-500' : 'text-slate-400 line-through'}`}>
                  {type.name} ({list.length}){!type.isActive && ' · type inactive'}
                </div>
                <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
                  {list.map((finding) => (
                    <div key={finding.id} className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3">
                      <div>
                        <div className={`font-medium ${finding.isActive ? 'text-slate-900' : 'text-slate-400 line-through'}`}>{finding.label}</div>
                        <div className="text-xs text-slate-500">Order {finding.sortOrder} · {finding.isActive ? 'Available to engineers' : 'Inactive'}</div>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(finding)}>Edit</Button>
                    </div>
                  ))}
                  {!findings.isLoading && !list.length && <p className="p-4 text-sm text-slate-500">No findings under {type.name} yet.</p>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit diagnosis finding" size="sm">
        {editing && <EditFinding finding={editing} types={types.data ?? []} onDone={() => { setEditing(null); void refresh(); }} />}
      </Modal>
      <Modal open={!!editingType} onClose={() => setEditingType(null)} title="Edit problem type" size="sm">
        {editingType && <EditType type={editingType} onDone={() => { setEditingType(null); void refresh(); }} />}
      </Modal>
    </div>
  );
}

function EditFinding({ finding, types, onDone }: { finding: DiagnosisFindingDto; types: DiagnosisFindingTypeDto[]; onDone: () => void }) {
  const [draft, setDraft] = useState<FindingDraft>({ label: finding.label, typeId: finding.type.id, sortOrder: finding.sortOrder, isActive: finding.isActive });
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
      <Field label="Type">
        <select value={draft.typeId} onChange={(event) => setDraft({ ...draft, typeId: event.target.value })} className={inputClass}>
          {types.filter((t) => t.isActive || t.id === draft.typeId).map((t) => <option key={t.id} value={t.id}>{t.name}{t.isActive ? '' : ' (inactive)'}</option>)}
        </select>
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

function EditType({ type, onDone }: { type: DiagnosisFindingTypeDto; onDone: () => void }) {
  const [draft, setDraft] = useState<TypeDraft>({ name: type.name, sortOrder: type.sortOrder, isActive: type.isActive });
  const save = useMutation({
    mutationFn: () => api.patch(`/settings/diagnosis-finding-types/${type.id}`, draft),
    onSuccess: () => {
      toast.success('Type updated');
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }} className="space-y-4">
      <Field label="Type name" required>
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputClass} />
      </Field>
      <Field label="Display order">
        <input type="number" min={0} max={999} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} className={inputClass} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} className="size-4 accent-brand-600" />
        Show in the engineer's “Problem type” dropdown
      </label>
      <p className="text-xs text-slate-500">Turning a type off hides it and all its findings from engineers. Past job records keep their wording.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Save changes</Button>
      </div>
    </form>
  );
}
