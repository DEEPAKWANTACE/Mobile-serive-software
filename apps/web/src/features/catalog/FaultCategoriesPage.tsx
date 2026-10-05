import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  faultCategoryCreateSchema,
  type FaultCategoryCreateData,
  type FaultCategoryCreateInput,
  type FaultCategoryDto,
} from '@msm/shared';
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

export function FaultCategoriesPage() {
  const list = useListState({});
  const { data, isLoading } = useList<FaultCategoryDto>('fault-categories', list.params);
  const [editing, setEditing] = useState<FaultCategoryDto | 'new' | null>(null);

  const columns: Column<FaultCategoryDto>[] = [
    { header: 'Category', cell: (c) => <span className="font-medium">{c.name}</span> },
    {
      header: 'Faults',
      cell: (c) => (
        <Link to={`/catalog/faults?categoryId=${c.id}`} className="text-brand-600 hover:underline">
          {c.faultCount}
        </Link>
      ),
    },
    { header: 'Order', cell: (c) => c.sortOrder },
    { header: 'Status', cell: (c) => <StatusBadge active={c.isActive} /> },
    {
      header: 'Actions',
      className: 'text-right',
      cell: (c) => (
        <div className="flex justify-end gap-3">
          <Button variant="link" onClick={() => setEditing(c)}>
            Edit
          </Button>
          <StatusToggle resource="fault-categories" id={c.id} name={c.name} isActive={c.isActive} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Fault Categories"
        description="Groups of problems, e.g. Display, Battery, Software"
        actions={<Button onClick={() => setEditing('new')}>Add category</Button>}
      />
      <FilterBar>
        <SearchInput onSearch={list.setSearch} placeholder="Search category" />
        <StatusFilter value={list.status} onChange={list.setStatus} />
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(c) => c.id} isLoading={isLoading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add category' : 'Edit category'} size="sm">
        {editing && <CategoryForm category={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function CategoryForm({ category, onDone }: { category?: FaultCategoryDto; onDone: () => void }) {
  const save = useSave<FaultCategoryCreateData>('fault-categories');
  const { register, handleSubmit, setError, formState: { errors } } = useForm<FaultCategoryCreateInput, unknown, FaultCategoryCreateData>({
    resolver: zodResolver(faultCategoryCreateSchema),
    defaultValues: { name: category?.name ?? '', sortOrder: category?.sortOrder ?? 0 },
  });

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: category?.id, data },
      {
        onSuccess: () => {
          toast.success(category ? 'Category updated' : 'Category added');
          onDone();
        },
        onError: (err) => handleFormError(err, setError),
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Category name" required error={errors.name?.message}>
        <input {...register('name')} autoFocus className={inputClass} aria-invalid={!!errors.name} />
      </Field>
      <Field label="Display order" error={errors.sortOrder?.message} hint="Lower numbers show first on the job sheet">
        <input {...register('sortOrder')} type="number" min={0} className={inputClass} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} />
    </form>
  );
}
