import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { stateCreateSchema, type StateCreateData, type StateCreateInput, type StateDto } from '@msm/shared';
import { StatusToggle } from '@/components/StatusToggle';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, inputClass } from '@/components/ui/Field';
import { FilterBar, SearchInput, StatusFilter } from '@/components/ui/Filters';
import { FormActions } from '@/components/ui/FormActions';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useListState } from '@/hooks/use-list-state';
import { useList, useSave } from '@/lib/crud';
import { handleFormError } from '@/lib/form-errors';

export function StatesPage() {
  const list = useListState({});
  const { data, isLoading } = useList<StateDto>('states', list.params);
  const [editing, setEditing] = useState<StateDto | 'new' | null>(null);

  const columns: Column<StateDto>[] = [
    { header: 'State', cell: (s) => <span className="font-medium">{s.name}</span> },
    { header: 'Code', cell: (s) => s.code },
    { header: 'Cities', cell: (s) => s.cityCount },
    { header: 'Status', cell: (s) => <StatusBadge active={s.isActive} /> },
    {
      header: 'Actions',
      className: 'text-right',
      cell: (s) => (
        <div className="flex justify-end gap-3">
          <Button variant="link" onClick={() => setEditing(s)}>
            Edit
          </Button>
          <StatusToggle resource="states" id={s.id} name={s.name} isActive={s.isActive} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="States" description="States where you operate" actions={<Button onClick={() => setEditing('new')}>Add state</Button>} />
      <FilterBar>
        <SearchInput onSearch={list.setSearch} placeholder="Search name or code" />
        <StatusFilter value={list.status} onChange={list.setStatus} />
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(s) => s.id} isLoading={isLoading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add state' : 'Edit state'} size="sm">
        {editing && <StateForm state={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function StateForm({ state, onDone }: { state?: StateDto; onDone: () => void }) {
  const save = useSave<StateCreateData>('states');
  const { register, handleSubmit, setError, formState: { errors } } = useForm<StateCreateInput, unknown, StateCreateData>({
    resolver: zodResolver(stateCreateSchema),
    defaultValues: { name: state?.name ?? '', code: state?.code ?? '' },
  });

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: state?.id, data },
      {
        onSuccess: () => {
          toast.success(state ? 'State updated' : 'State added');
          onDone();
        },
        onError: (err) => handleFormError(err, setError),
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="State name" required error={errors.name?.message}>
        <input {...register('name')} autoFocus className={inputClass} aria-invalid={!!errors.name} />
      </Field>
      <Field label="Code" required error={errors.code?.message} hint="2–4 letters, e.g. MH">
        <input {...register('code')} className={`${inputClass} uppercase`} aria-invalid={!!errors.code} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} />
    </form>
  );
}
