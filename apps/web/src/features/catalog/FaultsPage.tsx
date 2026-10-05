import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { faultCreateSchema, type FaultCreateData, type FaultCreateInput, type FaultDto } from '@msm/shared';
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

export function FaultsPage() {
  const list = useListState({});
  const { data, isLoading } = useList<FaultDto>('faults', list.params);
  const [editing, setEditing] = useState<FaultDto | 'new' | null>(null);

  const columns: Column<FaultDto>[] = [
    { header: 'Fault / problem', cell: (f) => <span className="font-medium">{f.name}</span> },
    { header: 'Description', cell: (f) => <span className="text-slate-600">{f.description ?? '—'}</span> },
    { header: 'Status', cell: (f) => <StatusBadge active={f.isActive} /> },
    {
      header: 'Actions',
      className: 'text-right',
      cell: (f) => (
        <div className="flex justify-end gap-3">
          <Button variant="link" onClick={() => setEditing(f)}>
            Edit
          </Button>
          <StatusToggle resource="faults" id={f.id} name={f.name} isActive={f.isActive} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Faults / Problems"
        description="Problems customers report and services you offer"
        actions={<Button onClick={() => setEditing('new')}>Add fault</Button>}
      />
      <FilterBar>
        <SearchInput onSearch={list.setSearch} placeholder="Search fault" />
        <StatusFilter value={list.status} onChange={list.setStatus} />
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(f) => f.id} isLoading={isLoading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add fault' : 'Edit fault'}>
        {editing && <FaultForm fault={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function FaultForm({ fault, onDone }: { fault?: FaultDto; onDone: () => void }) {
  const save = useSave<FaultCreateData>('faults');
  const { register, handleSubmit, setError, formState: { errors } } = useForm<FaultCreateInput, unknown, FaultCreateData>({
    resolver: zodResolver(faultCreateSchema),
    defaultValues: { name: fault?.name ?? '', description: fault?.description ?? '' },
  });

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: fault?.id, data },
      {
        onSuccess: () => {
          toast.success(fault ? 'Fault updated' : 'Fault added');
          onDone();
        },
        onError: (err) => handleFormError(err, setError),
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Fault / problem" required error={errors.name?.message} hint="e.g. Display broken, Battery replacement">
        <input {...register('name')} autoFocus className={inputClass} aria-invalid={!!errors.name} />
      </Field>
      <Field label="Description" error={errors.description?.message}>
        <textarea {...register('description')} rows={2} className={inputClass} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} />
    </form>
  );
}
