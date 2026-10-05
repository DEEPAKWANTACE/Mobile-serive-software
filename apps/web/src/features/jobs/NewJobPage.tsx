import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ACCESSORIES,
  jobCreateSchema,
  PHOTO_KIND_LABELS,
  type BrandDto,
  type CustomerDto,
  type FaultDto,
  type JobCreateData,
  type JobCreateInput,
  type ModelDto,
  type PhotoKind,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api-client';
import { useOptions } from '@/lib/crud';
import { handleFormError } from '@/lib/form-errors';
import { uploadJobPhotos } from './api';
import { PhotoPicker } from './PhotoPicker';

const emptyPhotos = (): Record<PhotoKind, File[]> => ({ CUSTOMER: [], ID_PROOF: [], DEVICE: [] });

export function NewJobPage() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState(emptyPhotos);
  const [returning, setReturning] = useState<CustomerDto | null>(null);
  const [faultFilter, setFaultFilter] = useState('');

  const { register, control, handleSubmit, watch, setValue, setError, formState: { errors } } = useForm<
    JobCreateInput,
    unknown,
    JobCreateData
  >({
    resolver: zodResolver(jobCreateSchema),
    defaultValues: {
      customer: { phone: '', name: '', altPhone: '', email: '', address: '' },
      brandId: '',
      deviceModelId: '',
      imei: '',
      serialNumber: '',
      color: '',
      faultIds: [],
      customerComplaint: '',
      accessories: [],
      accessoriesOther: '',
      conditionNotes: '',
    },
  });

  const brandId = watch('brandId');
  const phone = watch('customer.phone');
  const { items: brands } = useOptions<BrandDto>('brands');
  const { items: models } = useOptions<ModelDto>('models', { brandId }, { enabled: !!brandId });
  const { items: faults } = useOptions<FaultDto>('faults');

  // Returning customer: prefill details once a valid mobile number is entered.
  useEffect(() => {
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setReturning(null);
      return;
    }
    let cancelled = false;
    api.get<{ customer: CustomerDto | null }>(`/customers/lookup?phone=${phone}`).then(({ customer }) => {
      if (cancelled) return;
      setReturning(customer);
      if (customer) {
        setValue('customer.name', customer.name, { shouldValidate: true });
        setValue('customer.altPhone', customer.altPhone ?? '');
        setValue('customer.email', customer.email ?? '');
        setValue('customer.address', customer.address ?? '');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [phone, setValue]);

  const submit = useMutation({
    mutationFn: async (data: JobCreateData) => {
      const job = await api.post<{ id: string; jobNumber: string }>('/jobs', data);
      // Job is saved first; photo failures are reported but don't lose the job.
      const failed: string[] = [];
      for (const kind of Object.keys(photos) as PhotoKind[]) {
        if (!photos[kind].length) continue;
        await uploadJobPhotos(job.id, kind, photos[kind]).catch(() => failed.push(PHOTO_KIND_LABELS[kind]));
      }
      return { job, failed };
    },
    onSuccess: ({ job, failed }) => {
      toast.success(`Job sheet ${job.jobNumber} created`);
      if (failed.length) toast.error(`Could not upload: ${failed.join(', ')}. Add them from the job page.`, { duration: 10000 });
      navigate(`/jobs/${job.id}`);
    },
    onError: (err) => handleFormError(err, setError),
  });

  const visibleFaults = faults.filter((f) => f.name.toLowerCase().includes(faultFilter.toLowerCase()));
  const err = (msg?: string) => (msg ? { error: msg } : {});

  return (
    <form onSubmit={handleSubmit((d) => submit.mutate(d))} className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="New Job Sheet" description="Register a device received for repair" />

      <Card title="Customer">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Mobile number" required {...err(errors.customer?.phone?.message)}
            hint={returning ? `Returning customer — ${returning.name}` : undefined}>
            <input {...register('customer.phone')} inputMode="numeric" maxLength={10} autoFocus className={inputClass} />
          </Field>
          <Field label="Customer name" required {...err(errors.customer?.name?.message)}>
            <input {...register('customer.name')} className={inputClass} />
          </Field>
          <Field label="Alternate mobile" {...err(errors.customer?.altPhone?.message)}>
            <input {...register('customer.altPhone')} inputMode="numeric" maxLength={10} className={inputClass} />
          </Field>
          <Field label="Email" {...err(errors.customer?.email?.message)}>
            <input {...register('customer.email')} type="email" className={inputClass} />
          </Field>
          <Field label="Address" className="sm:col-span-2" {...err(errors.customer?.address?.message)}>
            <input {...register('customer.address')} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card title="Device">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Brand" required {...err(errors.brandId?.message)}>
            <select
              {...register('brandId', { onChange: () => setValue('deviceModelId', '') })}
              className={inputClass}
            >
              <option value="">Select brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Model" required {...err(errors.deviceModelId?.message)}>
            <select {...register('deviceModelId')} disabled={!brandId} className={inputClass}>
              <option value="">{brandId ? 'Select model' : 'Select brand first'}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="IMEI" {...err(errors.imei?.message)} hint="15 digits — dial *#06# on the phone">
            <input {...register('imei')} inputMode="numeric" maxLength={15} className={`${inputClass} font-mono`} />
          </Field>
          <Field label="Serial number" {...err(errors.serialNumber?.message)} hint="If IMEI is not available">
            <input {...register('serialNumber')} className={`${inputClass} font-mono uppercase`} />
          </Field>
          <Field label="Colour" {...err(errors.color?.message)}>
            <input {...register('color')} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card title="Problem">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-slate-700">
            Faults reported <span className="text-red-500">*</span>
          </span>
          {faults.length > 12 && (
            <input value={faultFilter} onChange={(e) => setFaultFilter(e.target.value)} placeholder="Filter faults" className={`${inputClass} w-48! py-1!`} />
          )}
        </div>
        <Controller
          control={control}
          name="faultIds"
          render={({ field }) => (
            <div className="flex flex-wrap gap-2">
              {visibleFaults.map((f) => {
                const checked = field.value?.includes(f.id) ?? false;
                return (
                  <label
                    key={f.id}
                    className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm select-none ${checked ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => field.onChange(checked ? field.value!.filter((id) => id !== f.id) : [...(field.value ?? []), f.id])}
                    />
                    {f.name}
                  </label>
                );
              })}
              {!faults.length && <span className="text-sm text-slate-500">No faults configured. Ask the admin to add them.</span>}
            </div>
          )}
        />
        {errors.faultIds && <p className="mt-1 text-xs text-red-600">{errors.faultIds.message}</p>}
        <Field label="Customer complaint (in their words)" className="mt-4" {...err(errors.customerComplaint?.message)}>
          <textarea {...register('customerComplaint')} rows={2} className={inputClass} />
        </Field>
      </Card>

      <Card title="Accessories & condition">
        <Controller
          control={control}
          name="accessories"
          render={({ field }) => (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ACCESSORIES.map((a) => {
                const checked = field.value?.includes(a) ?? false;
                return (
                  <label key={a} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => field.onChange(checked ? field.value!.filter((x) => x !== a) : [...(field.value ?? []), a])}
                      className="size-4 accent-brand-600"
                    />
                    {a}
                  </label>
                );
              })}
            </div>
          )}
        />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Other accessories" {...err(errors.accessoriesOther?.message)}>
            <input {...register('accessoriesOther')} className={inputClass} />
          </Field>
          <Field label="Physical condition" hint="Scratches, dents, cracks, missing screws…" {...err(errors.conditionNotes?.message)}>
            <input {...register('conditionNotes')} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card title="Photos">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <PhotoPicker label={PHOTO_KIND_LABELS.CUSTOMER} files={photos.CUSTOMER} onChange={(f) => setPhotos((p) => ({ ...p, CUSTOMER: f }))} />
          <PhotoPicker label={PHOTO_KIND_LABELS.ID_PROOF} files={photos.ID_PROOF} onChange={(f) => setPhotos((p) => ({ ...p, ID_PROOF: f }))} multiple />
          <div className="sm:col-span-2">
            <PhotoPicker label={PHOTO_KIND_LABELS.DEVICE} files={photos.DEVICE} onChange={(f) => setPhotos((p) => ({ ...p, DEVICE: f }))} multiple />
          </div>
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t border-slate-200 bg-white/90 px-6 py-3 backdrop-blur">
        <Button variant="secondary" onClick={() => navigate('/jobs')}>
          Cancel
        </Button>
        <Button type="submit" loading={submit.isPending}>
          {submit.isPending ? 'Saving…' : 'Create job sheet'}
        </Button>
      </div>
    </form>
  );
}
