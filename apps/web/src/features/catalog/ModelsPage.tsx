import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  modelCreateSchema,
  ROLES,
  type BrandDto,
  type ModelBulkImportData,
  type ModelBulkImportResultDto,
  type ModelCreateData,
  type ModelCreateInput,
  type ModelDto,
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
import { api } from '@/lib/api-client';
import { handleFormError } from '@/lib/form-errors';
import { useAuth } from '@/features/auth/auth-context';
import { CatalogScopePicker, scopeParams } from './CatalogScopePicker';

export function ModelsPage() {
  const [searchParams] = useSearchParams();
  const list = useListState({ brandId: searchParams.get('brandId') ?? '' });
  const { user } = useAuth();
  const [scopeBranch, setScopeBranch] = useState('');
  const scope = user?.role === ROLES.SUPER_ADMIN ? scopeParams(scopeBranch) : { scope: 'branch' };
  const { data, isLoading } = useList<ModelDto>('models', { ...list.params, ...scope });
  const { items: brands } = useOptions<BrandDto>('brands', scope);
  const [editing, setEditing] = useState<ModelDto | 'new' | null>(null);
  const [showImport, setShowImport] = useState(false);

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
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowImport(true)}>Bulk upload</Button>
            <Button onClick={() => setEditing('new')}>Add model</Button>
          </>
        }
      />
      <FilterBar>
        <CatalogScopePicker value={scopeBranch} onChange={setScopeBranch} />
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
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Bulk upload models" size="md">
        <ModelBulkImport branchId={scopeBranch || null} onDone={() => setShowImport(false)} />
      </Modal>
    </div>
  );
}

type ImportRow = ModelBulkImportData['rows'][number];

function parseCsv(text: string): ImportRow[] {
  const table: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) table.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted value.');
  row.push(cell);
  if (row.some((value) => value.trim())) table.push(row);

  if (!table.length) throw new Error('The CSV is empty.');
  const firstRow = table[0]!;
  firstRow[0] = (firstRow[0] ?? '').replace(/^\uFEFF/, '');
  const hasHeader = firstRow[0].trim().toLowerCase() === 'brand' && firstRow[1]?.trim().toLowerCase() === 'model';
  const dataRows = hasHeader ? table.slice(1) : table;
  if (!dataRows.length) throw new Error('The CSV does not contain any model rows.');
  if (dataRows.length > 5000) throw new Error('A maximum of 5,000 rows can be imported at once.');

  return dataRows.map((values, index) => {
    const line = index + (hasHeader ? 2 : 1);
    if (values.length !== 2) throw new Error(`Row ${line} must contain exactly two columns: Brand and Model.`);
    const brand = values[0]!.trim();
    const model = values[1]!.trim();
    if (!brand || !model) throw new Error(`Row ${line} must include both a brand and a model.`);
    if (brand.length > 100 || model.length > 100) throw new Error(`Row ${line} contains a value longer than 100 characters.`);
    return { brand, model };
  });
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob(['Brand,Model\r\nSamsung,Galaxy S24\r\nApple,iPhone 16\r\n'], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'model-import-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function ModelBulkImport({ branchId, onDone }: { branchId: string | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const importModels = useMutation({
    mutationFn: (data: ModelBulkImportData) => api.post<ModelBulkImportResultDto>('/models/bulk-import', data),
    onSuccess: (result) => {
      queryClient.invalidateQueries();
      toast.success(`${result.createdModels} models added; ${result.skippedModels} duplicates skipped`);
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Import failed'),
  });

  const submit = async () => {
    if (!file) {
      setError('Choose a CSV file.');
      return;
    }
    setError('');
    try {
      const rows = parseCsv(await file.text());
      importModels.mutate({ branchId, rows });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the CSV file.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
        Upload a CSV with two columns: <span className="font-medium">Brand</span> and <span className="font-medium">Model</span>.
        New brands are created automatically. Existing brand/model pairs are skipped.
      </div>
      <Field label="CSV file" required error={error || undefined} hint="Up to 5,000 rows. A header row is recommended.">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError('');
          }}
          className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm`}
        />
      </Field>
      <button type="button" onClick={downloadTemplate} className="text-sm text-brand-600 hover:underline">
        Download CSV template
      </button>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button onClick={submit} loading={importModels.isPending}>Upload models</Button>
      </div>
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
