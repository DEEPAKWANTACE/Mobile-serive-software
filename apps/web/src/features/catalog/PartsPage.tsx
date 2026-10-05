import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { partCreateSchema, type BrandDto, type ModelDto, type PartCreateData, type PartCreateInput, type PartDto } from '@msm/shared';
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
import { useList, useOptions, useSave } from '@/lib/crud';
import { handleFormError } from '@/lib/form-errors';
import { formatCurrency } from '@/lib/format';

export function PartsPage() {
  const list = useListState({});
  const { data, isLoading } = useList<PartDto>('parts', list.params);
  const [editing, setEditing] = useState<PartDto | 'new' | null>(null);

  const columns: Column<PartDto>[] = [
    { header: 'Code', cell: (p) => <span className="font-mono font-semibold">{p.code}</span> },
    { header: 'Part', cell: (p) => <span className="font-medium">{p.name}</span> },
    { header: 'For', cell: (p) => (p.model ? `${p.brand?.name ?? ''} ${p.model.name}` : (p.brand?.name ?? 'Any')) },
    { header: 'Selling', cell: (p) => formatCurrency(p.sellingPrice) },
    { header: 'Cost', cell: (p) => (p.costPrice !== null ? formatCurrency(p.costPrice) : '—') },
    { header: 'Reorder at', cell: (p) => p.reorderLevel },
    { header: 'Status', cell: (p) => <StatusBadge active={p.isActive} /> },
    {
      header: 'Actions',
      className: 'text-right',
      cell: (p) => (
        <div className="flex justify-end gap-3">
          <Button variant="link" onClick={() => setEditing(p)}>
            Edit
          </Button>
          <StatusToggle resource="parts" id={p.id} name={`${p.code} ${p.name}`} isActive={p.isActive} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Spare Parts"
        description="Part codes used by engineers and the store (e.g. 105 = a display)"
        actions={<Button onClick={() => setEditing('new')}>Add part</Button>}
      />
      <FilterBar>
        <SearchInput onSearch={list.setSearch} placeholder="Search code or name" />
        <StatusFilter value={list.status} onChange={list.setStatus} />
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(p) => p.id} isLoading={isLoading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add part' : 'Edit part'} size="lg">
        {editing && <PartForm part={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function PartForm({ part, onDone }: { part?: PartDto; onDone: () => void }) {
  const save = useSave<PartCreateData>('parts');
  const { items: brands } = useOptions<BrandDto>('brands');
  const { register, handleSubmit, watch, setValue, setError, formState: { errors } } = useForm<PartCreateInput, unknown, PartCreateData>({
    resolver: zodResolver(partCreateSchema),
    defaultValues: {
      code: part?.code ?? '',
      name: part?.name ?? '',
      brandId: part?.brand?.id ?? null,
      deviceModelId: part?.model?.id ?? null,
      sellingPrice: part?.sellingPrice ?? ('' as unknown as number),
      costPrice: part?.costPrice ?? ('' as unknown as number),
      reorderLevel: part?.reorderLevel ?? 1,
    },
  });
  const brandId = watch('brandId');
  const { items: models } = useOptions<ModelDto>('models', { brandId: brandId ?? '' }, { enabled: !!brandId });

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: part?.id, data },
      {
        onSuccess: () => {
          toast.success(part ? 'Part updated' : 'Part added');
          onDone();
        },
        onError: (err) => handleFormError(err, setError),
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Part code" required error={errors.code?.message} hint="Short code staff will type, e.g. 105">
        <input {...register('code')} autoFocus className={`${inputClass} font-mono uppercase`} />
      </Field>
      <Field label="Part name" required error={errors.name?.message}>
        <input {...register('name')} className={inputClass} placeholder="e.g. Display – Galaxy S24 OG" />
      </Field>
      <Field label="Brand" hint="Optional — leave blank for universal parts">
        <select
          {...register('brandId', { setValueAs: (v: string | null) => v || null, onChange: () => setValue('deviceModelId', null) })}
          className={inputClass}
        >
          <option value="">Any brand</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Model" error={errors.deviceModelId?.message}>
        <select {...register('deviceModelId', { setValueAs: (v: string | null) => v || null })} disabled={!brandId} className={inputClass}>
          <option value="">Any model</option>
          {part?.model && !models.some((m) => m.id === part.model!.id) && <option value={part.model.id}>{part.model.name}</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Selling price (₹)" required error={errors.sellingPrice?.message} hint="Charged to the customer">
        <input {...register('sellingPrice')} inputMode="decimal" className={inputClass} />
      </Field>
      <Field label="Cost price (₹)" error={errors.costPrice?.message} hint="Purchase cost, for margin">
        <input {...register('costPrice')} inputMode="decimal" className={inputClass} />
      </Field>
      <Field label="Low-stock alert at" error={errors.reorderLevel?.message}>
        <input {...register('reorderLevel')} type="number" min={0} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <FormActions onCancel={onDone} loading={save.isPending} />
      </div>
    </form>
  );
}
