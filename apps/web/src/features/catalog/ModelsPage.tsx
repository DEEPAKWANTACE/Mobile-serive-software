import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { modelCreateSchema, type BrandDto, type ModelCreateData, type ModelCreateInput, type ModelDto } from '@msm/shared';
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

export function ModelsPage() {
  const [searchParams] = useSearchParams();
  const list = useListState({ brandId: searchParams.get('brandId') ?? '' });
  const { data, isLoading } = useList<ModelDto>('models', list.params);
  const { items: brands } = useOptions<BrandDto>('brands');
  const [editing, setEditing] = useState<ModelDto | 'new' | null>(null);

  const columns: Column<ModelDto>[] = [
    { header: 'Brand', cell: (m) => m.brand.name },
    { header: 'Model', cell: (m) => <span className="font-medium">{m.name}</span> },
    {
      header: 'Prices set',
      cell: (m) => (
        <Link to={`/catalog/pricing?brandId=${m.brand.id}&modelId=${m.id}`} className="text-brand-600 hover:underline">
          {m.priceCount === 0 ? 'Set prices' : `${m.priceCount} fault${m.priceCount === 1 ? '' : 's'}`}
        </Link>
      ),
    },
    { header: 'Status', cell: (m) => <StatusBadge active={m.isActive} /> },
    {
      header: 'Actions',
      className: 'text-right',
      cell: (m) => (
        <div className="flex justify-end gap-3">
          <Button variant="link" onClick={() => setEditing(m)}>
            Edit
          </Button>
          <StatusToggle resource="models" id={m.id} name={`${m.brand.name} ${m.name}`} isActive={m.isActive} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Models"
        description="Phone models under each brand"
        actions={<Button onClick={() => setEditing('new')}>Add model</Button>}
      />
      <FilterBar>
        <SearchInput onSearch={list.setSearch} placeholder="Search model or brand" />
        <FilterSelect
          value={list.filters.brandId}
          onChange={(v) => list.setFilter('brandId', v)}
          placeholder="All brands"
          options={brands.map((b) => ({ value: b.id, label: b.name }))}
        />
        <StatusFilter value={list.status} onChange={list.setStatus} />
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(m) => m.id} isLoading={isLoading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add model' : 'Edit model'} size="sm">
        {editing && (
          <ModelForm
            model={editing === 'new' ? undefined : editing}
            defaultBrandId={list.filters.brandId}
            brands={brands}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}

type ModelFormProps = { model?: ModelDto; defaultBrandId: string; brands: BrandDto[]; onDone: () => void };

function ModelForm({ model, defaultBrandId, brands, onDone }: ModelFormProps) {
  const save = useSave<ModelCreateData>('models');
  const { register, handleSubmit, setError, reset, getValues, formState: { errors } } = useForm<ModelCreateInput, unknown, ModelCreateData>({
    resolver: zodResolver(modelCreateSchema),
    defaultValues: { brandId: model?.brand.id ?? defaultBrandId, name: model?.name ?? '' },
  });

  const submit = (addAnother: boolean) =>
    handleSubmit((data) =>
      save.mutate(
        { id: model?.id, data },
        {
          onSuccess: () => {
            toast.success(model ? 'Model updated' : `${data.name} added`);
            // "Save & add another" keeps the brand selected for fast entry of many models.
            if (addAnother) reset({ brandId: getValues('brandId'), name: '' });
            else onDone();
          },
          onError: (err) => handleFormError(err, setError),
        },
      ),
    );

  return (
    <form onSubmit={submit(false)} className="space-y-4">
      <Field label="Brand" required error={errors.brandId?.message}>
        <select {...register('brandId')} className={inputClass} aria-invalid={!!errors.brandId}>
          <option value="">Select brand</option>
          {model && !brands.some((b) => b.id === model.brand.id) && <option value={model.brand.id}>{model.brand.name}</option>}
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Model name" required error={errors.name?.message} hint="e.g. Galaxy S24, iPhone 15 Pro">
        <input {...register('name')} autoFocus className={inputClass} aria-invalid={!!errors.name} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        {!model && (
          <Button variant="secondary" onClick={submit(true)} disabled={save.isPending}>
            Save &amp; add another
          </Button>
        )}
        <Button type="submit" loading={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
