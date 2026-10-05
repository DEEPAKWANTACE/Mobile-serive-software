import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { shopSettingsSchema, type ShopSettingsData, type ShopSettingsDto, type ShopSettingsInput } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { AuthImage } from '@/features/jobs/AuthImage';
import { api } from '@/lib/api-client';
import { handleFormError } from '@/lib/form-errors';
import { compressImage } from '@/lib/image';
import { useShopSettings } from './useShopSettings';

export function ShopSettingsPage() {
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
    </div>
  );
}
