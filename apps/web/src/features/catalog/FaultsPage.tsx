import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { faultCreateSchema, type FaultCategoryDto, type FaultCreateData, type FaultCreateInput, type FaultDto } from '@msm/shared';
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

export function FaultsPage() {
  const [searchParams] = useSearchParams();
  const list = useListState({ categoryId: searchParams.get('categoryId') ?? '' });
  const { data, isLoading } = useList<FaultDto>('faults', list.params);
  const { items: categories } = useOptions<FaultCategoryDto>('fault-categories');
  const [editing, setEditing] = useState<FaultDto | 'new' | null>(null);

  const columns: Column<FaultDto>[] = [
    { header: 'Category', cell: (f) => f.category?.name ?? <span className="text-amber-700">Uncategorised</span> },
    {
      header: 'Fault / problem',
      cell: (f) => (
        <span className="font-medium">
          {f.name}
          {f.requiresIdProof && (
            <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-normal text-red-700">Aadhaar required</span>
          )}
        </span>
      ),
    },
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
        description="Problems customers report, grouped by category"
        actions={<Button onClick={() => setEditing('new')}>Add fault</Button>}
      />
      <FilterBar>
        <SearchInput onSearch={list.setSearch} placeholder="Search fault" />
        <FilterSelect
          value={list.filters.categoryId}
          onChange={(v) => list.setFilter('categoryId', v)}
          placeholder="All categories"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <StatusFilter value={list.status} onChange={list.setStatus} />
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(f) => f.id} isLoading={isLoading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add fault' : 'Edit fault'}>
        {editing && (
          <FaultForm
            fault={editing === 'new' ? undefined : editing}
            categories={categories}
            defaultCategoryId={list.filters.categoryId}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}

type FormProps = { fault?: FaultDto; categories: FaultCategoryDto[]; defaultCategoryId: string; onDone: () => void };

function FaultForm({ fault, categories, defaultCategoryId, onDone }: FormProps) {
  const save = useSave<FaultCreateData>('faults');
  const { register, handleSubmit, setError, formState: { errors } } = useForm<FaultCreateInput, unknown, FaultCreateData>({
    resolver: zodResolver(faultCreateSchema),
    defaultValues: {
      categoryId: fault?.category?.id ?? defaultCategoryId,
      name: fault?.name ?? '',
      description: fault?.description ?? '',
      requiresIdProof: fault?.requiresIdProof ?? false,
    },
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
      <Field label="Category" required error={errors.categoryId?.message}>
        <select {...register('categoryId')} className={inputClass} aria-invalid={!!errors.categoryId}>
          <option value="">Select category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Fault / problem" required error={errors.name?.message} hint="e.g. Battery not charging, Display broken">
        <input {...register('name')} autoFocus className={inputClass} aria-invalid={!!errors.name} />
      </Field>
      <Field label="Description" error={errors.description?.message}>
        <textarea {...register('description')} rows={2} className={inputClass} />
      </Field>
      <label className="flex items-start gap-2 rounded-md bg-slate-50 p-3 text-sm">
        <input type="checkbox" {...register('requiresIdProof')} className="mt-0.5 size-4 accent-brand-600" />
        <span>
          <span className="font-medium">Aadhaar / ID proof compulsory</span>
          <span className="block text-xs text-slate-500">
            For software unlock and similar jobs — the job sheet cannot be saved without the customer's Aadhaar photo.
          </span>
        </span>
      </label>
      <FormActions onCancel={onDone} loading={save.isPending} />
    </form>
  );
}
