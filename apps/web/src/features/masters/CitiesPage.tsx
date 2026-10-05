import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { cityCreateSchema, type CityCreateData, type CityCreateInput, type CityDto, type StateDto } from '@msm/shared';
import { StatusToggle } from '@/components/StatusToggle';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, inputClass } from '@/components/ui/Field';
import { FilterBar, FilterSelect, SearchInput, StatusFilter } from '@/components/ui/Filters';
import { FormActions } from '@/components/ui/FormActions';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useListState } from '@/hooks/use-list-state';
import { useList, useOptions, useSave } from '@/lib/crud';
import { handleFormError } from '@/lib/form-errors';

export function CitiesPage() {
  const list = useListState({ stateId: '' });
  const { data, isLoading } = useList<CityDto>('cities', list.params);
  const { items: states } = useOptions<StateDto>('states');
  const [editing, setEditing] = useState<CityDto | 'new' | null>(null);

  const columns: Column<CityDto>[] = [
    { header: 'City', cell: (c) => <span className="font-medium">{c.name}</span> },
    { header: 'State', cell: (c) => c.state.name },
    { header: 'Branches', cell: (c) => c.branchCount },
    { header: 'Status', cell: (c) => <StatusBadge active={c.isActive} /> },
    {
      header: 'Actions',
      className: 'text-right',
      cell: (c) => (
        <div className="flex justify-end gap-3">
          <Button variant="link" onClick={() => setEditing(c)}>
            Edit
          </Button>
          <StatusToggle resource="cities" id={c.id} name={c.name} isActive={c.isActive} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Cities" description="Cities within each state" actions={<Button onClick={() => setEditing('new')}>Add city</Button>} />
      <FilterBar>
        <SearchInput onSearch={list.setSearch} placeholder="Search city" />
        <FilterSelect
          value={list.filters.stateId}
          onChange={(v) => list.setFilter('stateId', v)}
          placeholder="All states"
          options={states.map((s) => ({ value: s.id, label: s.name }))}
        />
        <StatusFilter value={list.status} onChange={list.setStatus} />
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(c) => c.id} isLoading={isLoading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add city' : 'Edit city'} size="sm">
        {editing && <CityForm city={editing === 'new' ? undefined : editing} states={states} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function CityForm({ city, states, onDone }: { city?: CityDto; states: StateDto[]; onDone: () => void }) {
  const save = useSave<CityCreateData>('cities');
  const { register, handleSubmit, setError, formState: { errors } } = useForm<CityCreateInput, unknown, CityCreateData>({
    resolver: zodResolver(cityCreateSchema),
    defaultValues: { stateId: city?.state.id ?? '', name: city?.name ?? '' },
  });

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: city?.id, data },
      {
        onSuccess: () => {
          toast.success(city ? 'City updated' : 'City added');
          onDone();
        },
        onError: (err) => handleFormError(err, setError),
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="State" required error={errors.stateId?.message}>
        <select {...register('stateId')} className={inputClass} aria-invalid={!!errors.stateId}>
          <option value="">Select state</option>
          {/* Keep the current state selectable even if it was deactivated */}
          {city && !states.some((s) => s.id === city.state.id) && <option value={city.state.id}>{city.state.name}</option>}
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="City name" required error={errors.name?.message}>
        <input {...register('name')} className={inputClass} aria-invalid={!!errors.name} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} />
    </form>
  );
}
