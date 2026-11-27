import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { branchWarrantySchema, shopSettingsSchema, type AccessoryOptionDto, type BranchDto, type BranchOptionsDto, type BranchWarrantyData, type ShopSettingsData, type ShopSettingsDto, type ShopSettingsInput } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { AuthImage } from '@/features/jobs/AuthImage';
import { api } from '@/lib/api-client';
import { handleFormError } from '@/lib/form-errors';
import { compressImage } from '@/lib/image';
import { useShopSettings } from './useShopSettings';
import { useAuth } from '@/features/auth/auth-context';
import { useOptions } from '@/lib/crud';

export function ShopSettingsPage({ branchDefaultsOnly = false }: { branchDefaultsOnly?: boolean }) {
  if (branchDefaultsOnly) return <BranchJobDefaults />;
  const { data } = useShopSettings();
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  return <SettingsForm settings={data} />;
}

function SettingsForm({ settings }: { settings: ShopSettingsDto }) {
  const queryClient = useQueryClient();
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<ShopSettingsInput, unknown, ShopSettingsData>({
    resolver: zodResolver(shopSettingsSchema),
    defaultValues: {
      shopName: settings.shopName,
      legalName: settings.legalName ?? '',
      gstin: settings.gstin ?? '',
      address: settings.address ?? '',
      phone: settings.phone ?? '',
      email: settings.email ?? '',
      invoiceTerms: settings.invoiceTerms ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (d: ShopSettingsData) => api.put('/settings/shop', d),
    onSuccess: () => {
      toast.success('Shop settings saved');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => handleFormError(err, setError),
  });
  const uploadLogo = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('logo', await compressImage(logoFile!, 600, 0.9), 'logo.jpg');
      return api.put('/settings/shop/logo', form);
    },
    onSuccess: () => {
      toast.success('Logo updated');
      setLogoFile(null);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Shop Settings" description="Printed on every invoice and job sheet" />
      <Card title="Logo">
        <div className="flex flex-wrap items-center gap-4">
          {settings.hasLogo ? (
            <AuthImage src={`/settings/shop/logo?v=${settings.logoVersion}`} alt="Logo" className="h-16 w-auto rounded ring-1 ring-slate-200" />
          ) : (
            <span className="text-sm text-slate-500">No logo yet</span>
          )}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} className="text-sm" />
          <Button disabled={!logoFile} loading={uploadLogo.isPending} onClick={() => uploadLogo.mutate()}>
            Upload logo
          </Button>
        </div>
      </Card>
      <Card title="Business details">
        <form onSubmit={handleSubmit((d) => save.mutate(d))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Shop name" required error={errors.shopName?.message}>
            <input {...register('shopName')} className={inputClass} />
          </Field>
          <Field label="Legal / company name" error={errors.legalName?.message}>
            <input {...register('legalName')} className={inputClass} />
          </Field>
          <Field label="Phone" error={errors.phone?.message}>
            <input {...register('phone')} className={inputClass} />
          </Field>
          <Field label="Email" error={errors.email?.message}>
            <input {...register('email')} type="email" className={inputClass} />
          </Field>
          <Field label="Head office address" error={errors.address?.message}>
            <input {...register('address')} className={inputClass} />
          </Field>
          <Field label="Invoice terms / warranty note" error={errors.invoiceTerms?.message} className="sm:col-span-2" hint="Printed at the bottom of every invoice">
            <textarea {...register('invoiceTerms')} rows={3} className={inputClass} />
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" loading={save.isPending}>Save settings</Button>
          </div>
        </form>
      </Card>
      <BranchOptionsCard />
      <AccessoryOptionsCard />
    <RejectionReasonsCard />
    </div>
  );
}

function BranchJobDefaults() {
  const queryClient = useQueryClient();
  const defaults = useQuery({ queryKey: ['settings', 'branch-warranty'], queryFn: () => api.get<BranchWarrantyData>('/settings/branch-warranty') });
  if (!defaults.data) return <p className="text-sm text-slate-500">Loading…</p>;
  return <div className="mx-auto max-w-3xl space-y-5">
    <PageHeader title="Job Defaults" description="Defaults used by CCOs for this branch" />
    <WarrantyDefaultsForm initial={defaults.data} onSaved={() => void queryClient.invalidateQueries({ queryKey: ['settings', 'branch-warranty'] })} />
    <BranchOptionsCard />
    <AccessoryOptionsCard />
    <RejectionReasonsCard />
  </div>;
}

function WarrantyDefaultsForm({ initial, onSaved }: { initial: BranchWarrantyData; onSaved: () => void }) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm<BranchWarrantyData>({ resolver: zodResolver(branchWarrantySchema), defaultValues: initial });
  const save = useMutation({
    mutationFn: (d: BranchWarrantyData) => api.put('/settings/branch-warranty', d),
    onSuccess: () => { toast.success('Repair warranty defaults saved'); onSaved(); },
    onError: (e) => handleFormError(e, setError),
  });
  return <Card title="Repair warranty defaults">
    <form onSubmit={handleSubmit((d) => save.mutate(d))} className="space-y-4">
      <Field label="Default warranty period" error={errors.warrantyPeriod?.message}><input {...register('warrantyPeriod')} className={inputClass} placeholder="e.g. 30 days" /></Field>
      <Field label="Default warranty terms" error={errors.warrantyTerms?.message}><textarea {...register('warrantyTerms')} rows={3} className={inputClass} /></Field>
      <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Save defaults</Button></div>
    </form>
  </Card>;
}

const BRANCH_SWITCHES: { key: 'allowManualDevice' | 'allowImeiNa' | 'requireImeiAtDelivery'; label: string; hint: string }[] = [
  { key: 'allowManualDevice', label: 'Allow manual brand / model entry', hint: 'Off: the job sheet must use the brand and model list.' },
  { key: 'allowImeiNa', label: 'Allow "IMEI N/A" at delivery', hint: 'Off: the counter must enter the IMEI (RWR returns excepted).' },
  { key: 'requireImeiAtDelivery', label: 'IMEI compulsory at delivery', hint: 'For repaired phones. Never asked for RWR returns or cancelled jobs.' },
];

/** Per-branch switches for the job sheet and delivery. Branch Manager: own branch; Super Admin: any branch. */
function BranchOptionsCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isSuper = user?.role === 'SUPER_ADMIN';
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: isSuper });
  const [branchId, setBranchId] = useState('');
  const qs = isSuper ? `?branchId=${branchId}` : '';
  const options = useQuery({
    queryKey: ['settings', 'branch-options', isSuper ? branchId : 'own'],
    queryFn: () => api.get<BranchOptionsDto>(`/settings/branch-options${qs}`),
    enabled: !isSuper || !!branchId,
  });
  const save = useMutation({
    mutationFn: (patch: Partial<BranchOptionsDto>) => api.put('/settings/branch-options', { ...patch, branchId: isSuper ? branchId : null }),
    onSuccess: () => {
      toast.success('Branch option saved');
      void queryClient.invalidateQueries({ queryKey: ['settings', 'branch-options'] });
    },
    onError: (e) => toast.error(e.message),
  });
  return <Card title="Job sheet & delivery options" subtitle={isSuper ? 'Per branch' : 'For your branch'}>
    {isSuper && (
      <Field label="Branch">
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}>
          <option value="">Select branch</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
        </select>
      </Field>
    )}
    {options.data && (
      <ul className="mt-2 divide-y divide-slate-100">
        {BRANCH_SWITCHES.map((sw) => {
          const on = options.data[sw.key];
          return (
            <li key={sw.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="text-sm font-medium text-slate-800">{sw.label}</div>
                <div className="text-xs text-slate-500">{sw.hint}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={sw.label}
                disabled={save.isPending}
                onClick={() => save.mutate({ [sw.key]: !on })}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-brand-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? 'left-5.5' : 'left-0.5'}`} />
              </button>
            </li>
          );
        })}
      </ul>
    )}
    {isSuper && !branchId && <p className="mt-2 text-sm text-slate-500">Select a branch to change its options.</p>}
  </Card>;
}

function AccessoryOptionsCard() {
  return <BranchListCard resource="accessories" title="Accessories received list" noun="Accessory option" />;
}

function RejectionReasonsCard() {
  return <BranchListCard resource="rejection-reasons" title="Customer rejection reasons" noun="Reason" hint="Shown as a list when the customer rejects an estimate" />;
}

/** A pick-list with global defaults (Super Admin) and per-branch rows (Super Admin or that branch's manager). */
function BranchListCard({ resource, title, noun, hint }: { resource: string; title: string; noun: string; hint?: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isSuper = user?.role === 'SUPER_ADMIN';
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: isSuper });
  const [branchId, setBranchId] = useState('');
  const [name, setName] = useState('');
  const qs = isSuper ? (branchId ? `?scope=branch&branchId=${branchId}` : '?scope=global') : '?scope=branch';
  const options = useQuery({ queryKey: ['settings', resource, qs], queryFn: () => api.get<AccessoryOptionDto[]>(`/settings/${resource}${qs}`) });
  const add = useMutation({
    mutationFn: () => api.post(`/settings/${resource}`, { name, sortOrder: (options.data?.length ?? 0) * 10, branchId: isSuper ? (branchId || null) : null }),
    onSuccess: () => { setName(''); toast.success(`${noun} added`); void queryClient.invalidateQueries({ queryKey: ['settings', resource] }); },
    onError: (e) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (o: AccessoryOptionDto) => api.patch(`/settings/${resource}/${o.id}`, { isActive: !o.isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['settings', resource] }),
    onError: (e) => toast.error(e.message),
  });
  const scopeText = isSuper ? 'Global defaults or a selected branch' : 'Your branch list — global defaults also show';
  return <Card title={title} subtitle={hint ? `${hint} · ${scopeText}` : scopeText}>
    {isSuper && <Field label="List scope"><select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}><option value="">Global defaults</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}</select></Field>}
    <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}><input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder={`Add ${noun.toLowerCase()}`} /><Button type="submit" disabled={!name.trim()} loading={add.isPending}>Add</Button></form>
    <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
      {(options.data ?? []).map((o) => <li key={o.id} className="flex items-center justify-between px-3 py-2 text-sm"><span className={o.isActive ? '' : 'text-slate-400 line-through'}>{o.name}</span><Button size="sm" variant="secondary" onClick={() => toggle.mutate(o)}>{o.isActive ? 'Deactivate' : 'Activate'}</Button></li>)}
      {options.data?.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Nothing added yet.</li>}
    </ul>
  </Card>;
}
