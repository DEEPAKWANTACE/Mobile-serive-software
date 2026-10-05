import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  BRANCH_TYPE_LABELS,
  BRANCH_TYPES,
  branchCreateSchema,
  type BranchCreateData,
  type BranchCreateInput,
  type BranchDto,
  type CityDto,
  type StateDto,
} from '@msm/shared';
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

const typeOptions = BRANCH_TYPES.map((t) => ({ value: t, label: BRANCH_TYPE_LABELS[t] }));

export function BranchesPage() {
  const list = useListState({ stateId: '', cityId: '', type: '' });
  const { data, isLoading } = useList<BranchDto>('branches', list.params);
  const { items: states } = useOptions<StateDto>('states');
  const { items: cities } = useOptions<CityDto>('cities', { stateId: list.filters.stateId }, { enabled: !!list.filters.stateId });
  const [editing, setEditing] = useState<BranchDto | 'new' | null>(null);

  const columns: Column<BranchDto>[] = [
    { header: 'Code', cell: (b) => <span className="font-mono text-xs font-semibold">{b.code}</span> },
    { header: 'Branch', cell: (b) => <span className="font-medium">{b.name}</span> },
    {
      header: 'Type',
      cell: (b) => (
        <span className={b.type === 'MAIN_OFFICE' ? 'font-medium text-violet-700' : ''}>{BRANCH_TYPE_LABELS[b.type]}</span>
      ),
    },
    { header: 'Location', cell: (b) => `${b.city.name}, ${b.city.state.code}` },
    { header: 'Phone', cell: (b) => b.phone ?? '—' },
    { header: 'Staff', cell: (b) => b.userCount },
    { header: 'Status', cell: (b) => <StatusBadge active={b.isActive} /> },
    {
      header: 'Actions',
      className: 'text-right',
      cell: (b) => (
        <div className="flex justify-end gap-3">
          <Button variant="link" onClick={() => setEditing(b)}>
            Edit
          </Button>
          <StatusToggle
            resource="branches"
            id={b.id}
            name={b.name}
            isActive={b.isActive}
            warning="Staff of this branch will not be able to sign in."
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Branches"
        description="Service centers and main office (L4)"
        actions={<Button onClick={() => setEditing('new')}>Add branch</Button>}
      />
      <FilterBar>
        <SearchInput onSearch={list.setSearch} placeholder="Search name or code" />
        <FilterSelect
          value={list.filters.stateId}
          onChange={(v) => list.setFilter('stateId', v, { cityId: '' })}
          placeholder="All states"
          options={states.map((s) => ({ value: s.id, label: s.name }))}
        />
        <FilterSelect
          value={list.filters.cityId}
          onChange={(v) => list.setFilter('cityId', v)}
          placeholder={list.filters.stateId ? 'All cities' : 'Select state first'}
          disabled={!list.filters.stateId}
          options={cities.map((c) => ({ value: c.id, label: c.name }))}
        />
        <FilterSelect value={list.filters.type} onChange={(v) => list.setFilter('type', v)} placeholder="All types" options={typeOptions} />
        <StatusFilter value={list.status} onChange={list.setStatus} />
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(b) => b.id} isLoading={isLoading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add branch' : 'Edit branch'} size="lg">
        {editing && <BranchForm branch={editing === 'new' ? undefined : editing} states={states} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function BranchForm({ branch, states, onDone }: { branch?: BranchDto; states: StateDto[]; onDone: () => void }) {
  const save = useSave<BranchCreateData>('branches');
  // State is only a UI filter for the city dropdown; it is not stored on the branch.
  const [stateId, setStateId] = useState(branch?.city.state.id ?? '');
  const { items: cities } = useOptions<CityDto>('cities', { stateId }, { enabled: !!stateId });

  const { register, handleSubmit, setError, setValue, formState: { errors } } = useForm<BranchCreateInput, unknown, BranchCreateData>({
    resolver: zodResolver(branchCreateSchema),
    defaultValues: {
      cityId: branch?.city.id ?? '',
      code: branch?.code ?? '',
      name: branch?.name ?? '',
      type: branch?.type ?? 'SERVICE_CENTER',
      phone: branch?.phone ?? '',
      address: branch?.address ?? '',
    },
  });

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: branch?.id, data },
      {
        onSuccess: () => {
          toast.success(branch ? 'Branch updated' : 'Branch added');
          onDone();
        },
        onError: (err) => handleFormError(err, setError),
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="State" required>
        <select
          value={stateId}
          onChange={(e) => {
            setStateId(e.target.value);
            setValue('cityId', '');
          }}
          className={inputClass}
        >
          <option value="">Select state</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="City" required error={errors.cityId?.message}>
        <select {...register('cityId')} disabled={!stateId} className={inputClass} aria-invalid={!!errors.cityId}>
          <option value="">{stateId ? 'Select city' : 'Select state first'}</option>
          {branch && !cities.some((c) => c.id === branch.city.id) && branch.city.state.id === stateId && (
            <option value={branch.city.id}>{branch.city.name}</option>
          )}
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Branch name" required error={errors.name?.message}>
        <input {...register('name')} className={inputClass} aria-invalid={!!errors.name} />
      </Field>
      <Field label="Branch code" required error={errors.code?.message} hint="Used as the job number prefix, e.g. AND01">
        <input {...register('code')} className={`${inputClass} uppercase`} aria-invalid={!!errors.code} />
      </Field>
      <Field label="Type" required error={errors.type?.message}>
        <select {...register('type')} className={inputClass}>
          {typeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Phone" error={errors.phone?.message}>
        <input {...register('phone')} inputMode="tel" className={inputClass} aria-invalid={!!errors.phone} />
      </Field>
      <Field label="Address" error={errors.address?.message} className="sm:col-span-2">
        <textarea {...register('address')} rows={2} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <FormActions onCancel={onDone} loading={save.isPending} />
      </div>
    </form>
  );
}
