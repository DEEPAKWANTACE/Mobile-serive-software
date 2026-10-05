import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { brandCreateSchema, type BrandCreateData, type BrandCreateInput, type BrandDto } from '@msm/shared';
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

export function BrandsPage() {
  const list = useListState({});
  const { data, isLoading } = useList<BrandDto>('brands', list.params);
  const [editing, setEditing] = useState<BrandDto | 'new' | null>(null);

  const columns: Column<BrandDto>[] = [
    { header: 'Brand', cell: (b) => <span className="font-medium">{b.name}</span> },
    {
      header: 'Models',
      cell: (b) => (
        <Link to={`/catalog/models?brandId=${b.id}`} className="text-brand-600 hover:underline">
          {b.modelCount}
        </Link>
      ),
    },
    { header: 'Status', cell: (b) => <StatusBadge active={b.isActive} /> },
    {
      header: 'Actions',
      className: 'text-right',
      cell: (b) => (
        <div className="flex justify-end gap-3">
          <Button variant="link" onClick={() => setEditing(b)}>
            Edit
          </Button>
          <StatusToggle resource="brands" id={b.id} name={b.name} isActive={b.isActive} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Brands" description="Mobile phone brands" actions={<Button onClick={() => setEditing('new')}>Add brand</Button>} />
      <FilterBar>
        <SearchInput onSearch={list.setSearch} placeholder="Search brand" />
        <StatusFilter value={list.status} onChange={list.setStatus} />
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(b) => b.id} isLoading={isLoading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add brand' : 'Edit brand'} size="sm">
        {editing && <BrandForm brand={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function BrandForm({ brand, onDone }: { brand?: BrandDto; onDone: () => void }) {
  const save = useSave<BrandCreateData>('brands');
  const { register, handleSubmit, setError, formState: { errors } } = useForm<BrandCreateInput, unknown, BrandCreateData>({
    resolver: zodResolver(brandCreateSchema),
    defaultValues: { name: brand?.name ?? '' },
  });

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: brand?.id, data },
      {
        onSuccess: () => {
          toast.success(brand ? 'Brand updated' : 'Brand added');
          onDone();
        },
        onError: (err) => handleFormError(err, setError),
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Brand name" required error={errors.name?.message}>
        <input {...register('name')} autoFocus className={inputClass} aria-invalid={!!errors.name} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} />
    </form>
  );
}
