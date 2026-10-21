import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { branchWarrantySchema, shopSettingsSchema, type AccessoryOptionDto, type BranchDto, type BranchWarrantyData, type ShopSettingsData, type ShopSettingsDto, type ShopSettingsInput } from '@msm/shared';
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
          <Field label="GSTIN" error={errors.gstin?.message} hint="15 characters, e.g. 29ABCDE1234F1Z5">
            <input {...register('gstin')} maxLength={15} className={`${inputClass} font-mono uppercase`} />
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
      <AccessoryOptionsCard />
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
    <AccessoryOptionsCard />
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

function AccessoryOptionsCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isSuper = user?.role === 'SUPER_ADMIN';
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: isSuper });
  const [branchId, setBranchId] = useState('');
  const [name, setName] = useState('');
  const qs = isSuper ? (branchId ? `?scope=branch&branchId=${branchId}` : '?scope=global') : '?scope=branch';
  const options = useQuery({ queryKey: ['settings', 'accessories', qs], queryFn: () => api.get<AccessoryOptionDto[]>(`/settings/accessories${qs}`) });
  const add = useMutation({
    mutationFn: () => api.post('/settings/accessories', { name, sortOrder: (options.data?.length ?? 0) * 10, branchId: isSuper ? (branchId || null) : null }),
    onSuccess: () => { setName(''); toast.success('Accessory option added'); void queryClient.invalidateQueries({ queryKey: ['settings', 'accessories'] }); },
  });
  const toggle = useMutation({
    mutationFn: (o: AccessoryOptionDto) => api.patch(`/settings/accessories/${o.id}`, { isActive: !o.isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['settings', 'accessories'] }),
  });
  return <Card title="Accessories received list" subtitle={isSuper ? 'Global defaults or a selected branch' : 'Editable only for your branch'}>
    {isSuper && <Field label="List scope"><select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}><option value="">Global defaults</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}</select></Field>}
    <div className="mt-4 flex gap-2"><input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Add option" /><Button disabled={!name.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add</Button></div>
    <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
      {(options.data ?? []).map((o) => <li key={o.id} className="flex items-center justify-between px-3 py-2 text-sm"><span className={o.isActive ? '' : 'text-slate-400 line-through'}>{o.name}</span><Button size="sm" variant="secondary" onClick={() => toggle.mutate(o)}>{o.isActive ? 'Deactivate' : 'Activate'}</Button></li>)}
    </ul>
  </Card>;
}
