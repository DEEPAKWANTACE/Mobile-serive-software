import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  jobCreateSchema,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  PHOTO_KIND_LABELS,
  ROLES,
  type BranchDto,
  type BrandDto,
  type CustomerDto,
  type EngineerWorkloadDto,
  type FaultDto,
  type JobCreateData,
  type JobCreateInput,
  type ModelDto,
  type ModelPriceDto,
  type PhotoKind,
  type AccessoryOptionDto,
  type BranchWarrantyData,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Combobox } from '@/components/ui/Combobox';
import { Field, inputClass } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { api, ApiError } from '@/lib/api-client';
import { useOptions } from '@/lib/crud';
import { handleFormError } from '@/lib/form-errors';
import { formatCurrency } from '@/lib/format';
import { compressImage } from '@/lib/image';
import { ImeiWarning } from './ImeiWarning';
import { PhotoPicker } from './PhotoPicker';
import { useAuth } from '@/features/auth/auth-context';

type IntakeKind = Exclude<PhotoKind, 'RWR'>;
const emptyPhotos = (): Record<IntakeKind, File[]> => ({ CUSTOMER: [], ID_PROOF: [], DEVICE: [], PHYSICAL_CONDITION: [] });

export function NewJobPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const { items: branchOptions } = useOptions<BranchDto>('branches', {}, { enabled: isSuperAdmin });
  const [photos, setPhotos] = useState(emptyPhotos);
  const [idProofError, setIdProofError] = useState<string>();
  const [returning, setReturning] = useState<CustomerDto | null>(null);
  const [takeAdvance, setTakeAdvance] = useState(false);
  const [manualDevice, setManualDevice] = useState(false);

  const { register, control, handleSubmit, watch, setValue, setError, formState: { errors } } = useForm<
    JobCreateInput,
    unknown,
    JobCreateData
  >({
    resolver: zodResolver(jobCreateSchema),
    defaultValues: {
      customer: { phone: '', name: '', city: '', altPhone: '', email: '', address: '' },
      jobType: 'MOBILE',
      accessoryName: '',
      branchId: null,
      retailer: '',
      inwardById: null,
      phoneDamaged: false,
      warranty: null,
      brandId: '',
      deviceModelId: '',
      manualBrand: '',
      manualModel: '',
      imei: '',
      imei2: '',
      serialNumber: '',
      color: '',
      faults: [],
      customerComplaint: '',
      accessories: [],
      accessoriesOther: '',
      conditionNotes: '',
      physicalConditionRemark: '',
      warrantyPeriod: '',
      warrantyTerms: '',
      skipDiagnosis: false,
      customerAlreadyApproved: false,
      engineerId: '',
      advance: null,
    },
  });

  const brandId = watch('brandId');
  const modelId = watch('deviceModelId');
  const jobType = watch('jobType');
  const skipDiagnosis = watch('skipDiagnosis');
  const phone = watch('customer.phone');
  const selectedFaults = watch('faults') ?? [];
  const formBranch = isSuperAdmin ? (watch('branchId') ?? '') : (user?.branch?.id ?? '');
  const branchQs = isSuperAdmin ? `?branchId=${formBranch}` : '';

  const { items: brands } = useOptions<BrandDto>('brands', { branchId: formBranch || undefined });
  const { items: models } = useOptions<ModelDto>('models', { brandId }, { enabled: !!brandId });
  const { items: faults } = useOptions<FaultDto>('faults', { branchId: formBranch || undefined });
  const prices = useQuery({
    queryKey: ['models', modelId, 'prices'],
    queryFn: () => api.get<ModelPriceDto[]>(`/models/${modelId}/prices`),
    enabled: jobType === 'MOBILE' && !!modelId,
  });
  const accessoryOptions = useQuery({
    queryKey: ['settings', 'accessories', formBranch || 'own'],
    queryFn: () => api.get<AccessoryOptionDto[]>(`/settings/accessories${branchQs}`),
    enabled: !isSuperAdmin || !!formBranch,
  });
  const warrantyDefaults = useQuery({
    queryKey: ['settings', 'branch-warranty', formBranch || 'own'],
    queryFn: () => api.get<BranchWarrantyData>('/settings/branch-warranty'),
    enabled: user?.role === ROLES.CCO,
  });
  const engineers = useQuery({
    queryKey: ['engineers', formBranch || 'own'],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers${branchQs}`),
    enabled: !isSuperAdmin || !!formBranch,
  });
  const inwardStaff = useQuery({
    queryKey: ['inward-staff', formBranch || 'own'],
    queryFn: () => api.get<{ id: string; name: string; role: string }[]>(`/jobs/inward-staff${branchQs}`),
    enabled: !isSuperAdmin || !!formBranch,
  });

  useEffect(() => {
    if (!warrantyDefaults.data) return;
    setValue('warrantyPeriod', warrantyDefaults.data.warrantyPeriod ?? '');
    setValue('warrantyTerms', warrantyDefaults.data.warrantyTerms ?? '');
  }, [warrantyDefaults.data, setValue]);

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
        setValue('customer.city', customer.city ?? '');
        setValue('customer.email', customer.email ?? '');
        setValue('customer.address', customer.address ?? '');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [phone, setValue]);

  // Prices for the chosen model, grouped by fault. Clear chosen prices if the model changes.
  const optionsByFault = useMemo(() => {
    const m = new Map<string, ModelPriceDto[]>();
    for (const p of prices.data ?? []) m.set(p.faultId, [...(m.get(p.faultId) ?? []), p]);
    return m;
  }, [prices.data]);
  useEffect(() => {
    setValue('faults', (watch('faults') ?? []).map((f) => ({ faultId: f.faultId, priceId: null })));
  }, [modelId, setValue, watch]);

  const faultById = new Map(faults.map((f) => [f.id, f]));
  const needsIdProof = selectedFaults.map((f) => faultById.get(f.faultId)).filter((f) => f?.requiresIdProof);
  const priceOf = (priceId?: string | null) => (prices.data ?? []).find((p) => p.id === priceId)?.price;
  const pricedTotal = selectedFaults.reduce((sum, f) => sum + (priceOf(f.priceId) ?? 0), 0);
  const unpricedCount = selectedFaults.filter((f) => priceOf(f.priceId) === undefined).length;

  const submit = useMutation({
    mutationFn: async (data: JobCreateData) => {
      const form = new FormData();
      form.append('data', JSON.stringify(data));
      for (const kind of Object.keys(photos) as IntakeKind[]) {
        for (const file of photos[kind]) {
          const blob = await compressImage(file);
          form.append(kind, blob, file.name.replace(/\.\w+$/, '') + '.jpg');
        }
      }
      return api.post<{ id: string; jobNumber: string }>('/jobs', form);
    },
    onSuccess: (job) => {
      toast.success(`Job sheet ${job.jobNumber} created`, {
        duration: 10000,
        action: { label: '🖨 Print job sheet', onClick: () => navigate(`/jobs/${job.id}/print`) },
      });
      navigate(`/jobs/${job.id}`);
    },
    onError: (err) => {
      const idErr = err instanceof ApiError ? (err.details as Record<string, string[]> | undefined)?.idProof?.[0] : undefined;
      if (idErr) setIdProofError(idErr);
      else handleFormError(err, setError);
    },
  });

  const onSubmit = handleSubmit((data) => {
    if (needsIdProof.length && !photos.ID_PROOF.length) {
      setIdProofError(`Aadhaar photo is compulsory for: ${needsIdProof.map((f) => f!.name).join(', ')}`);
      document.getElementById('photos')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    submit.mutate({ ...data, advance: takeAdvance ? data.advance : null });
  });

  const err = (msg?: string) => (msg ? { error: msg } : {});

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-4xl space-y-5">
      {!embedded && <PageHeader title="New Job Sheet" description="Register a device received for repair" />}
      {isSuperAdmin && (
        <Card title="Branch">
          <Field label="Branch receiving the phone" required {...err(errors.branchId?.message)}>
            <select {...register('branchId', { setValueAs: (v: string | null) => v || null, onChange: () => setValue('engineerId', '') })} className={inputClass}>
              <option value="">Select branch</option>
              {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
          </Field>
        </Card>
      )}

      <Card title="Customer">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Mobile number" required {...err(errors.customer?.phone?.message)}
            hint={returning ? `Returning customer — ${returning.name}` : undefined}>
            <input {...register('customer.phone')} inputMode="numeric" maxLength={10} autoFocus className={inputClass} />
          </Field>
          <Field label="Alternate mobile" {...err(errors.customer?.altPhone?.message)}>
            <input {...register('customer.altPhone')} inputMode="numeric" maxLength={10} className={inputClass} />
          </Field>
          <Field label="Customer name" required {...err(errors.customer?.name?.message)}>
            <input {...register('customer.name')} className={inputClass} />
          </Field>
          <Field label="City" {...err(errors.customer?.city?.message)}>
            <input {...register('customer.city')} className={inputClass} />
          </Field>
          <Field label="Retailer (if from a shop)" {...err(errors.retailer?.message)} hint="Dealer / shopkeeper who brought the phone">
            <input {...register('retailer')} className={inputClass} />
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
          <Field label="Job sheet type" required className="sm:col-span-2">
            <div className="flex gap-5 pt-2 text-sm">
              <label className="flex items-center gap-2"><input type="radio" value="MOBILE" {...register('jobType')} className="accent-brand-600" /> Mobile</label>
              <label className="flex items-center gap-2"><input type="radio" value="ACCESSORY" {...register('jobType')} className="accent-brand-600" /> Accessory</label>
            </div>
          </Field>
          {jobType === 'ACCESSORY' && (
            <Field label="Accessory name" required className="sm:col-span-2" {...err(errors.accessoryName?.message)}>
              <input {...register('accessoryName')} className={inputClass} placeholder="e.g. Bluetooth speaker, smartwatch, charger" />
            </Field>
          )}
          {jobType === 'MOBILE' && (
            <div className="sm:col-span-2 -mt-2 mb-1 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={manualDevice}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setManualDevice(checked);
                    if (checked) {
                      setValue('brandId', null);
                      setValue('deviceModelId', null);
                    } else {
                      setValue('manualBrand', '');
                      setValue('manualModel', '');
                    }
                  }}
                  className="size-4 accent-brand-600 rounded"
                />
                Enter brand and model manually (not saved in catalogue)
              </label>
            </div>
          )}
          {jobType === 'MOBILE' && manualDevice ? (
            <>
              <Field label="Brand" required {...err(errors.manualBrand?.message)}>
                <input
                  {...register('manualBrand')}
                  className={inputClass}
                  placeholder="e.g. Vivo, Samsung, Apple"
                />
              </Field>
              <Field label="Model" required {...err(errors.manualModel?.message)}>
                <input
                  {...register('manualModel')}
                  className={inputClass}
                  placeholder="e.g. Y20, Galaxy A52, iPhone 13"
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Brand" className={jobType === 'MOBILE' ? '' : 'hidden'} {...err(errors.brandId?.message)}>
                <Controller
                  control={control}
                  name="brandId"
                  render={({ field }) => (
                    <Combobox
                      value={field.value ?? ''}
                      onChange={(v) => {
                        field.onChange(v);
                        setValue('deviceModelId', null);
                      }}
                      placeholder="Type brand, e.g. Vivo"
                      invalid={!!errors.brandId}
                      options={brands.map((b) => ({ value: b.id, label: b.name }))}
                    />
                  )}
                />
              </Field>
              <Field label="Model" className={jobType === 'MOBILE' ? '' : 'hidden'} {...err(errors.deviceModelId?.message)}>
                <Controller
                  control={control}
                  name="deviceModelId"
                  render={({ field }) => (
                    <Combobox
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      disabled={!brandId}
                      placeholder={brandId ? 'Type model, e.g. Y20' : 'Select brand first'}
                      invalid={!!errors.deviceModelId}
                      emptyText="Model not found — ask admin to add it"
                      options={models.map((m) => ({ value: m.id, label: m.name }))}
                    />
                  )}
                />
              </Field>
            </>
          )}
          <Field label="IMEI 1" className={jobType === 'MOBILE' ? '' : 'hidden'} {...err(errors.imei?.message)} hint="15 digits. Dial *#06#">
            <input {...register('imei')} inputMode="numeric" maxLength={15} className={`${inputClass} font-mono`} />
          </Field>
          <Field label="IMEI 2" className={jobType === 'MOBILE' ? '' : 'hidden'} {...err(errors.imei2?.message)}>
            <input {...register('imei2')} inputMode="numeric" maxLength={15} className={`${inputClass} font-mono`} />
          </Field>
          <div className={`${jobType === 'MOBILE' ? '' : 'hidden'} sm:col-span-2 -mt-2 empty:hidden`}>
            <ImeiWarning imei={watch('imei')} />
          </div>
          <Field label="Serial number" className={jobType === 'ACCESSORY' ? '' : 'hidden'} {...err(errors.serialNumber?.message)}>
            <input {...register('serialNumber')} className={`${inputClass} font-mono uppercase`} />
          </Field>
          <Field label="Colour" {...err(errors.color?.message)}>
            <input {...register('color')} className={inputClass} />
          </Field>
          <Field label="Warranty">
            <div className="flex flex-wrap gap-4 pt-2 text-sm">
              {([['', 'Not specified'], ['IN_WARRANTY', 'In warranty'], ['OUT_OF_WARRANTY', 'Out of warranty']] as const).map(([v, label]) => (
                <label key={v} className="flex items-center gap-1.5">
                  <input type="radio" value={v} {...register('warranty', { setValueAs: (x: string | null) => x || null })} className="accent-brand-600" />
                  {label}
                </label>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 pt-6 text-sm">
            <input type="checkbox" {...register('phoneDamaged')} className="size-4 accent-brand-600" />
            Device is physically damaged
          </label>
        </div>
      </Card>

      <Card title="Problem & estimate">
        <Controller
          control={control}
          name="faults"
          render={({ field }) => (
            <FaultPicker
              faults={faults}
              value={field.value ?? []}
              onChange={field.onChange}
              optionsByFault={optionsByFault}
              modelChosen={!!modelId}
            />
          )}
        />
        {errors.faults && <p className="mt-1 text-xs text-red-600">{errors.faults.message ?? errors.faults.root?.message}</p>}

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Device Photos</h3>
          <div className="space-y-4">
            <PhotoPicker label={PHOTO_KIND_LABELS.PHYSICAL_CONDITION} files={photos.PHYSICAL_CONDITION} onChange={(f) => setPhotos((p) => ({ ...p, PHYSICAL_CONDITION: f }))} multiple />
            <PhotoPicker label={PHOTO_KIND_LABELS.DEVICE} files={photos.DEVICE} onChange={(f) => setPhotos((p) => ({ ...p, DEVICE: f }))} multiple />
          </div>
        </div>

        {selectedFaults.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-600">
              Estimated amount{unpricedCount > 0 && ` (${unpricedCount} fault${unpricedCount === 1 ? '' : 's'} to be checked by engineer)`}
            </span>
            <span className="text-lg font-semibold">{pricedTotal > 0 ? formatCurrency(pricedTotal) : 'To be decided'}</span>
          </div>
        )}
        <Field label="Total amount (₹)" className="mt-4 max-w-xs" {...err(errors.totalAmount?.message)} hint="Optional — overrides the price-list estimate, e.g. a quote agreed with the customer">
          <input {...register('totalAmount')} inputMode="decimal" className={inputClass} placeholder={pricedTotal > 0 ? String(pricedTotal) : 'To be decided'} />
        </Field>
        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50/50 p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" {...register('skipDiagnosis')} className="size-4 accent-brand-600" />
            I know the diagnosis — use this estimate and skip engineer diagnosis
          </label>
          {skipDiagnosis && (
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" {...register('customerAlreadyApproved')} className="size-4 accent-brand-600" />
              Customer has already approved this estimate
            </label>
          )}
          {skipDiagnosis && <p className="mt-2 text-xs text-slate-600">If unchecked, the job waits for the CCO to call and record the customer's decision.</p>}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Repair warranty period" {...err(errors.warrantyPeriod?.message)} hint="Branch default; CCO may change it for this repair">
            <input {...register('warrantyPeriod')} className={inputClass} placeholder="e.g. 30 days" />
          </Field>
          <Field label="Repair warranty terms" {...err(errors.warrantyTerms?.message)}>
            <textarea {...register('warrantyTerms')} rows={2} className={inputClass} />
          </Field>
        </div>
        {needsIdProof.length > 0 && (
          <div className="mt-3 rounded-md bg-red-50 px-4 py-2.5 text-sm text-red-700">
            🔒 Aadhaar photo is compulsory for {needsIdProof.map((f) => f!.name).join(', ')}.
          </div>
        )}
        <Field label="Remarks / customer complaint" className="mt-4" {...err(errors.customerComplaint?.message)}>
          <textarea {...register('customerComplaint')} rows={2} className={inputClass} />
        </Field>
      </Card>

      <Card title="Accessories & condition">
        <Controller
          control={control}
          name="accessories"
          render={({ field }) => (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(accessoryOptions.data ?? []).filter((a) => a.isActive).map((option) => {
                const a = option.name;
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
          <Field label="Extra added (other items received)" {...err(errors.accessoriesOther?.message)}>
            <input {...register('accessoriesOther')} className={inputClass} />
          </Field>
          <Field label="Physical condition" hint="Scratches, dents, cracks, missing screws…" {...err(errors.conditionNotes?.message)}>
            <input {...register('conditionNotes')} className={inputClass} />
          </Field>
          <Field label="Physical condition remark" className="sm:col-span-2" {...err(errors.physicalConditionRemark?.message)}>
            <textarea {...register('physicalConditionRemark')} rows={2} className={inputClass} placeholder="Detailed remark about condition at inward" />
          </Field>
        </div>
      </Card>

      <div id="photos">
        <Card title="Customer Photos">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <PhotoPicker label={PHOTO_KIND_LABELS.CUSTOMER} files={photos.CUSTOMER} onChange={(f) => setPhotos((p) => ({ ...p, CUSTOMER: f }))} />
            <PhotoPicker
              label={PHOTO_KIND_LABELS.ID_PROOF}
              files={photos.ID_PROOF}
              required={needsIdProof.length > 0}
              error={idProofError}
              onChange={(f) => {
                setPhotos((p) => ({ ...p, ID_PROOF: f }));
                if (f.length) setIdProofError(undefined);
              }}
              multiple
            />
          </div>
        </Card>
      </div>

      <Card title="Inward, engineer & advance">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Inward by" {...err(errors.inwardById?.message)} hint="Who took the device in (defaults to you)">
            <select {...register('inwardById', { setValueAs: (v: string | null) => v || null })} className={inputClass}>
              <option value="">{user?.name} (me)</option>
              {(inwardStaff.data ?? []).filter((u) => u.id !== user?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Assign engineer" required {...err(errors.engineerId?.message)} hint="The job goes to this engineer for diagnosis or repair">
            <Controller
              control={control}
              name="engineerId"
              render={({ field }) => (
                <Combobox
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  placeholder="Select engineer"
                  emptyText="No active engineers in this branch"
                  options={(engineers.data ?? []).map((e) => ({
                    value: e.id,
                    label: e.name,
                    hint: `${e.openJobs} open`,
                  }))}
                />
              )}
            />
          </Field>
          <div>
            <label className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={takeAdvance} onChange={(e) => setTakeAdvance(e.target.checked)} className="size-4 accent-brand-600" />
              Advance payment received
            </label>
            {takeAdvance && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Amount (₹)" required {...err(errors.advance?.amount?.message ?? errors.advance?.message)}>
                  <input {...register('advance.amount')} inputMode="decimal" className={inputClass} />
                </Field>
                <Field label="Mode" required>
                  <select {...register('advance.mode')} className={inputClass} defaultValue="CASH">
                    {PAYMENT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="UPI / card ref." className="col-span-2" {...err(errors.advance?.reference?.message)}>
                  <input {...register('advance.reference')} className={inputClass} />
                </Field>
              </div>
            )}
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

// ─── Fault picker: category tabs → faults, each with an optional price option ───

type Selected = { faultId: string; priceId?: string | null };

type PickerProps = {
  faults: FaultDto[];
  value: Selected[];
  onChange: (v: Selected[]) => void;
  optionsByFault: Map<string, ModelPriceDto[]>;
  modelChosen: boolean;
};

export function FaultPicker({ faults, value, onChange, optionsByFault, modelChosen }: PickerProps) {
  const categories = useMemo(() => {
    const m = new Map<string, { name: string; faults: FaultDto[] }>();
    for (const f of faults) {
      const key = f.category?.id ?? 'other';
      const entry = m.get(key) ?? { name: f.category?.name ?? 'Other', faults: [] };
      entry.faults.push(f);
      m.set(key, entry);
    }
    return [...m.entries()];
  }, [faults]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const current = categories.find(([id]) => id === activeCat) ?? categories[0];
  const selectedIds = new Set(value.map((v) => v.faultId));
  const faultById = new Map(faults.map((f) => [f.id, f]));

  const toggle = (f: FaultDto) => {
    if (selectedIds.has(f.id)) return onChange(value.filter((v) => v.faultId !== f.id));
    const opts = optionsByFault.get(f.id) ?? [];
    // Pre-select the only option when there is just one.
    onChange([...value, { faultId: f.id, priceId: opts.length === 1 ? opts[0]!.id : null }]);
  };

  if (!faults.length) return <p className="text-sm text-slate-500">No faults configured. Ask the admin to add them.</p>;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">
          Problem category <span className="text-red-500">*</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map(([id, c]) => {
            const count = c.faults.filter((f) => selectedIds.has(f.id)).length;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveCat(id)}
                className={`rounded-md border px-3 py-1.5 text-sm ${current?.[0] === id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 hover:bg-slate-50'}`}
              >
                {c.name}
                {count > 0 && <span className="ml-1.5 rounded-full bg-white/25 px-1.5 text-xs">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {current && (
        <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 p-3">
          {current[1].faults.map((f) => {
            const checked = selectedIds.has(f.id);
            return (
              <label
                key={f.id}
                className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm select-none ${checked ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
              >
                <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(f)} />
                {checked ? '✓ ' : ''}
                {f.name}
                {f.requiresIdProof && ' 🔒'}
              </label>
            );
          })}
        </div>
      )}

      {value.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">Selected faults</div>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {value.map((v) => {
              const f = faultById.get(v.faultId);
              const opts = optionsByFault.get(v.faultId) ?? [];
              return (
                <li key={v.faultId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm">
                    <span className="text-xs text-slate-500">{f?.category?.name ?? 'Other'} › </span>
                    {f?.name}
                  </span>
                  <span className="flex items-center gap-2">
                    {opts.length ? (
                      <select
                        value={v.priceId ?? ''}
                        onChange={(e) =>
                          onChange(value.map((x) => (x.faultId === v.faultId ? { ...x, priceId: e.target.value || null } : x)))
                        }
                        aria-label={`Price for ${f?.name}`}
                        className={`${inputClass} w-56! py-1!`}
                      >
                        <option value="">Price to be decided</option>
                        {opts.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label} — {formatCurrency(o.price)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-500">{modelChosen ? 'No price set — engineer will check' : 'Select model for prices'}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onChange(value.filter((x) => x.faultId !== v.faultId))}
                      aria-label={`Remove ${f?.name}`}
                      className="rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
