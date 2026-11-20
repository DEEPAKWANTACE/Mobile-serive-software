import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PartCategoryDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { inputClass } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { CatalogScopePicker } from '@/features/catalog/CatalogScopePicker';
import { api } from '@/lib/api-client';
import { toQueryString } from '@/lib/crud';

/** Part categories and subcategories (e.g. Combo › Vivo Combo): create, rename and remove in one place. */
export function PartCategoriesPage() {
  const queryClient = useQueryClient();
  const [scopeBranch, setScopeBranch] = useState('');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const params = { scope: scopeBranch ? 'branch' : 'effective', branchId: scopeBranch || undefined };
  const q = useQuery({ queryKey: ['part-categories', params], queryFn: () => api.get<PartCategoryDto[]>(`/parts/categories?${toQueryString(params)}`) });
  const body = (extra: object) => ({ ...extra, branchId: scopeBranch || undefined });
  const done = (msg: string) => () => {
    toast.success(msg);
    void queryClient.invalidateQueries({ queryKey: ['part-categories'] });
  };
  const create = useMutation({ mutationFn: () => api.post('/parts/categories', body({ name: name.trim(), parent: parent || undefined })), onSuccess: () => { setName(''); done('Added')(); }, onError: (e) => toast.error(e.message) });
  const rename = useMutation({ mutationFn: (v: { from: string; to: string; parent?: string }) => api.post('/parts/categories/rename', body(v)), onSuccess: done('Renamed'), onError: (e) => toast.error(e.message) });
  const remove = useMutation({ mutationFn: (v: { name: string; parent?: string }) => api.post('/parts/categories/delete', body(v)), onSuccess: done('Removed'), onError: (e) => toast.error(e.message) });

  const ask = (from: string, parentName?: string) => {
    const to = window.prompt(`Rename “${from}” to:`, from)?.trim();
    if (to && to !== from) rename.mutate({ from, to, parent: parentName });
  };
  const del = (n: string, parentName?: string) => {
    if (window.confirm(`Remove “${n}”?`)) remove.mutate({ name: n, parent: parentName });
  };
  const items = q.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Part Categories" description="Main categories and subcategories used to group spare parts, purchase orders and profit reports" />
      <CatalogScopePicker value={scopeBranch} onChange={setScopeBranch} />
      <Card title="Add category or subcategory">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length < 2) return toast.error('Enter a name');
            create.mutate();
          }}
        >
          <select value={parent} onChange={(e) => setParent(e.target.value)} className={`${inputClass} w-56!`}>
            <option value="">Main category</option>
            {items.map((c) => (
              <option key={c.name} value={c.name}>Subcategory of {c.name}</option>
            ))}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={parent ? 'e.g. Vivo Combo' : 'e.g. Combo, Back Panel, Charging Flex'} className={`${inputClass} w-72!`} />
          <Button type="submit" loading={create.isPending}>Add</Button>
        </form>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((c) => (
          <Card
            key={c.name}
            title={`${c.name} (${c.count} part${c.count === 1 ? '' : 's'})`}
            actions={
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => ask(c.name)}>Rename</Button>
                <Button size="sm" variant="secondary" onClick={() => del(c.name)}>Remove</Button>
              </span>
            }
          >
            {c.subcategories.length === 0 ? (
              <p className="text-sm text-slate-500">No subcategories.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {c.subcategories.map((s) => (
                  <li key={s.name} className="flex items-center justify-between py-1.5">
                    <span>{s.name} <span className="text-xs text-slate-500">({s.count})</span></span>
                    <span className="flex gap-2">
                      <Button variant="link" onClick={() => ask(s.name, c.name)}>Rename</Button>
                      <Button variant="link" className="text-red-600!" onClick={() => del(s.name, c.name)}>Remove</Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
        {!q.isLoading && items.length === 0 && <p className="text-sm text-slate-500">No categories yet — add the first one above.</p>}
      </div>
    </div>
  );
}
