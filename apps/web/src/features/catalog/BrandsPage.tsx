import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { brandCreateSchema, ROLES, type BrandCreateData, type BrandCreateInput, type BrandDto } from '@msm/shared';
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
import { useAuth } from '@/features/auth/auth-context';
import { CatalogScopePicker, scopeParams } from './CatalogScopePicker';

export function BrandsPage() {
  const list = useListState({});
  const { user } = useAuth();
  const [scopeBranch, setScopeBranch] = useState('');
  // Branch staff see the Super Admin defaults (read-only) together with their own branch's rows.
  const scope = user?.role === ROLES.SUPER_ADMIN ? scopeParams(scopeBranch) : { scope: 'effective' };
  const readOnlyRow = (r: { isGlobal: boolean }) => user?.role !== ROLES.SUPER_ADMIN && r.isGlobal;
  const { data, isLoading } = useList<BrandDto>('brands', { ...list.params, ...scope });
  const [editing, setEditing] = useState<BrandDto | 'new' | null>(null);
  const isSuper = user?.role === ROLES.SUPER_ADMIN;
  const queryClient = useQueryClient();
  // Super Admin: branch-only brands (e.g. an import done in one branch) become defaults for every branch.
  const makeGlobal = useMutation({
    mutationFn: (target: { brandId?: string; branchId?: string }) =>
      target.brandId
        ? api.post<{ brands: number; models: number }>(`/brands/${target.brandId}/make-global`, {})
        : api.post<{ brands: number; models: number }>('/brands/make-global', { branchId: target.branchId }),
    onSuccess: (r) => {
      toast.success(`${r.brands} brand${r.brands === 1 ? '' : 's'} and ${r.models} models are now global defaults for all branches`);
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      void queryClient.invalidateQueries({ queryKey: ['models'] });
    },
    onError: (e) => toast.error(e.message),
  });

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
      cell: (b) => readOnlyRow(b) ? <span className="text-xs text-slate-400">Default · all branches</span> : (
        <div className="flex justify-end gap-3">
          <Button variant="link" onClick={() => setEditing(b)}>
            Edit
          </Button>
          {isSuper && !b.isGlobal && (
            <Button
              variant="link"
              disabled={makeGlobal.isPending}
              onClick={() => window.confirm(`Make ${b.name} and its ${b.modelCount} models available to all branches?`) && makeGlobal.mutate({ brandId: b.id })}
            >
              Make global
            </Button>
          )}
          <StatusToggle resource="brands" id={b.id} name={b.name} isActive={b.isActive} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Brands"
        description="Mobile phone brands"
        actions={
          <div className="flex flex-wrap gap-2">
            {isSuper && scopeBranch && (
              <Button
                variant="secondary"
                loading={makeGlobal.isPending}
                onClick={() => window.confirm('Move every brand and model of this branch into the global defaults, so all branches get them?') && makeGlobal.mutate({ branchId: scopeBranch })}
              >
                Move all to global defaults
              </Button>
            )}
            <Button onClick={() => setEditing('new')}>Add brand</Button>
          </div>
        }
      />
      <FilterBar>
        <CatalogScopePicker value={scopeBranch} onChange={setScopeBranch} />
        <SearchInput onSearch={list.setSearch} placeholder="Search brand" />
        <StatusFilter value={list.status} onChange={list.setStatus} />
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(b) => b.id} isLoading={isLoading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add brand' : 'Edit brand'} size="sm">
        {editing && <BrandForm brand={editing === 'new' ? undefined : editing} branchId={scopeBranch || null} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function BrandForm({ brand, branchId, onDone }: { brand?: BrandDto; branchId: string | null; onDone: () => void }) {
  const save = useSave<BrandCreateData>('brands');
  const { register, handleSubmit, setError, formState: { errors } } = useForm<BrandCreateInput, unknown, BrandCreateData>({
    resolver: zodResolver(brandCreateSchema),
    defaultValues: { name: brand?.name ?? '', branchId },
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
