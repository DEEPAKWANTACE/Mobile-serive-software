import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ACCESSORIES,
  DEVICE_EDITABLE_STATUSES,
  jobEditSchema,
  type BrandDto,
  type FaultDto,
  type JobDto,
  type JobEditData,
  type JobEditInput,
  type ModelDto,
  type ModelPriceDto,
} from '@msm/shared';
import { Combobox } from '@/components/ui/Combobox';
import { Field, inputClass } from '@/components/ui/Field';
import { FormActions } from '@/components/ui/FormActions';
import { api } from '@/lib/api-client';
import { useOptions } from '@/lib/crud';
import { handleFormError } from '@/lib/form-errors';
import { FaultPicker } from './NewJobPage';

/** Correct a saved job sheet. Device & faults only before diagnosis; every change is logged in the history. */
export function EditJobForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const deviceEditable = DEVICE_EDITABLE_STATUSES.includes(job.status) && !job.diagnosedAt;
  const { items: brands } = useOptions<BrandDto>('brands');
  const { items: faults } = useOptions<FaultDto>('faults');

  // Map the stored price label back to the option id for the current model.
  const prices = useQuery({ queryKey: ['models', job.model.id, 'prices'], queryFn: () => api.get<ModelPriceDto[]>(`/models/${job.model.id}/prices`) });
  if (!prices.data || (deviceEditable && !faults.length)) return <p className="text-sm text-slate-500">Loading…</p>;
  const initialFaults = job.faults.map((f) => ({
    faultId: f.id,
    priceId: prices.data.find((p) => p.faultId === f.id && p.label === f.priceLabel)?.id ?? null,
  }));
  return <Inner job={job} onDone={onDone} deviceEditable={deviceEditable} brands={brands} faults={faults} initialFaults={initialFaults} queryClient={queryClient} />;
}

function Inner({
  job,
  onDone,
  deviceEditable,
  brands,
  faults,
  initialFaults,
  queryClient,
}: {
  job: JobDto;
  onDone: () => void;
  deviceEditable: boolean;
  brands: BrandDto[];
  faults: FaultDto[];
  initialFaults: { faultId: string; priceId: string | null }[];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const { register, control, handleSubmit, watch, setValue, setError, formState: { errors } } = useForm<JobEditInput, unknown, JobEditData>({
    resolver: zodResolver(jobEditSchema),
    defaultValues: {
      customer: {
        phone: job.customer.phone,
        name: job.customer.name,
        altPhone: job.customer.altPhone ?? '',
        email: job.customer.email ?? '',
        address: job.customer.address ?? '',
      },
      brandId: job.brand.id,
      deviceModelId: job.model.id,
      color: job.color ?? '',
      faults: initialFaults,
      customerComplaint: job.customerComplaint ?? '',
      accessories: job.accessories as JobEditInput['accessories'],
      accessoriesOther: job.accessoriesOther ?? '',
      conditionNotes: job.conditionNotes ?? '',
    },
  });
  const brandId = watch('brandId');
  const modelId = watch('deviceModelId');
  const { items: models } = useOptions<ModelDto>('models', { brandId: brandId ?? '' }, { enabled: deviceEditable && !!brandId });
  const prices = useQuery({
    queryKey: ['models', modelId, 'prices'],
    queryFn: () => api.get<ModelPriceDto[]>(`/models/${modelId}/prices`),
    enabled: deviceEditable && !!modelId,
  });
  const optionsByFault = useMemo(() => {
    const m = new Map<string, ModelPriceDto[]>();
    for (const p of prices.data ?? []) m.set(p.faultId, [...(m.get(p.faultId) ?? []), p]);
    return m;
  }, [prices.data]);

  const save = useMutation({
    mutationFn: (d: JobEditData) => {
      const body = deviceEditable ? d : { ...d, brandId: undefined, deviceModelId: undefined, faults: undefined };
      return api.patch<{ changed: number }>(`/jobs/${job.id}`, body);
    },
    onSuccess: (r) => {
      toast.success(r.changed ? `Job sheet updated (${r.changed} change${r.changed === 1 ? '' : 's'})` : 'Nothing changed');
      void queryClient.invalidateQueries({ queryKey: ['jobs', job.id] });
      onDone();
    },
    onError: (err) => handleFormError(err, setError),
  });
  const err = (m?: string) => (m ? { error: m } : {});

  return (
    <form onSubmit={handleSubmit((d) => save.mutate(d))} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Mobile number" required {...err(errors.customer?.phone?.message)} hint="Fixing a wrong number moves this job to that customer">
          <input {...register('customer.phone')} inputMode="numeric" maxLength={10} className={inputClass} />
        </Field>
        <Field label="Customer name" required {...err(errors.customer?.name?.message)}>
          <input {...register('customer.name')} className={inputClass} />
        </Field>
        <Field label="Alternate mobile" {...err(errors.customer?.altPhone?.message)}>
          <input {...register('customer.altPhone')} inputMode="numeric" maxLength={10} className={inputClass} />
        </Field>
        <Field label="Email" {...err(errors.customer?.email?.message)}>
          <input {...register('customer.email')} className={inputClass} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <input {...register('customer.address')} className={inputClass} />
        </Field>
      </div>

      {deviceEditable ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Brand" required>
            <Controller
              control={control}
              name="brandId"
              render={({ field }) => (
                <Combobox
                  value={field.value ?? ''}
                  onChange={(v) => {
                    field.onChange(v);
                    setValue('deviceModelId', '');
                    setValue('faults', (watch('faults') ?? []).map((f) => ({ faultId: f.faultId, priceId: null })));
                  }}
                  options={brands.map((b) => ({ value: b.id, label: b.name }))}
                />
              )}
            />
          </Field>
          <Field label="Model" required {...err(errors.deviceModelId?.message)}>
            <Controller
              control={control}
              name="deviceModelId"
              render={({ field }) => (
                <Combobox
                  value={field.value ?? ''}
                  onChange={(v) => {
                    field.onChange(v);
                    setValue('faults', (watch('faults') ?? []).map((f) => ({ faultId: f.faultId, priceId: null })));
                  }}
                  options={[...(models.some((m) => m.id === job.model.id) || brandId !== job.brand.id ? [] : [{ value: job.model.id, label: job.model.name }]), ...models.map((m) => ({ value: m.id, label: m.name }))]}
                />
              )}
            />
          </Field>
          <div className="sm:col-span-2">
            <Controller
              control={control}
              name="faults"
              render={({ field }) => (
                <FaultPicker faults={faults} value={field.value ?? []} onChange={field.onChange} optionsByFault={optionsByFault} modelChosen={!!modelId} />
              )}
            />
            {errors.faults && <p className="mt-1 text-xs text-red-600">{errors.faults.message ?? errors.faults.root?.message}</p>}
          </div>
        </div>
      ) : (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Device and faults can't be changed after the engineer has diagnosed the phone.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Colour">
          <input {...register('color')} className={inputClass} />
        </Field>
        <Field label="Physical condition">
          <input {...register('conditionNotes')} className={inputClass} />
        </Field>
        <Field label="Customer complaint" className="sm:col-span-2">
          <textarea {...register('customerComplaint')} rows={2} className={inputClass} />
        </Field>
      </div>
      <Controller
        control={control}
        name="accessories"
        render={({ field }) => (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ACCESSORIES.map((a) => {
              const checked = field.value?.includes(a) ?? false;
              return (
                <label key={a} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked} onChange={() => field.onChange(checked ? field.value!.filter((x) => x !== a) : [...(field.value ?? []), a])} className="size-4 accent-brand-600" />
                  {a}
                </label>
              );
            })}
          </div>
        )}
      />
      <Field label="Other accessories">
        <input {...register('accessoriesOther')} className={inputClass} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Save changes" />
    </form>
  );
}
