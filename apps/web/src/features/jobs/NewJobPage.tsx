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
  type JobDeviceData,
  type ModelDto,
  type ModelPriceDto,
  type PhotoKind,
  type AccessoryOptionDto,
  type BranchOptionsDto,
  jobDeviceSchema,
} from '@msm/shared';
import { StickyActions } from '@/components/ui/StickyActions';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Combobox } from '@/components/ui/Combobox';
import { Field, inputClass } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { api, ApiError } from '@/lib/api-client';
import { useOptions } from '@/lib/crud';
import { handleFormError, scrollToFirstError } from '@/lib/form-errors';
import { Banknote, IndianRupee } from 'lucide-react';
import { ImeiInput } from './ImeiInput';
import { formatCurrency } from '@/lib/format';
import { compressImage } from '@/lib/image';
import { ImeiWarning } from './ImeiWarning';
import { PhotoPicker } from './PhotoPicker';
import { useAuth } from '@/features/auth/auth-context';
import { DeadlinePicker } from './DeadlinePicker';
import { CityInput } from '@/components/ui/CityInput';

type IntakeKind = Exclude<PhotoKind, 'RWR'>;
const emptyPhotos = (): Record<IntakeKind, File[]> => ({ CUSTOMER: [], ID_PROOF: [], DEVICE: [], PHYSICAL_CONDITION: [] });

type ExtraDeviceDraft = {
  id: string;
  jobType: 'MOBILE' | 'ACCESSORY';
  accessoryName: string;
  manualBrand: string;
  manualModel: string;
  manualFault: string;
  imei: string;
  imei2: string;
  serialNumber: string;
  color: string;
  customerComplaint: string;
  accessories: string[];
  accessoriesOther: string;
  conditionNotes: string;
  faults: [];
};

const extraDevice = (): ExtraDeviceDraft => ({
  id: crypto.randomUUID(),
  jobType: 'MOBILE',
  accessoryName: '',
  manualBrand: '',
  manualModel: '',
  manualFault: '',
  imei: '',
  imei2: '',
  serialNumber: '',
  color: '',
  customerComplaint: '',
  accessories: [],
  accessoriesOther: '',
  conditionNotes: '',
  faults: [],
});

export function NewJobPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const { items: branchOptions } = useOptions<BranchDto>('branches', {}, { enabled: isSuperAdmin });
  const [photos, setPhotos] = useState(emptyPhotos);
  const [idProofError, setIdProofError] = useState<string>();
  const [returning, setReturning] = useState<CustomerDto | null>(null);
  const [advance, setAdvance] = useState({ amount: '', mode: 'CASH' as (typeof PAYMENT_MODES)[number], reference: '' });
  const [advanceError, setAdvanceError] = useState<string>();
  const [manualDevice, setManualDevice] = useState(false);
  const [manualProblem, setManualProblem] = useState(false);
  const [extraDevices, setExtraDevices] = useState<ExtraDeviceDraft[]>([]);

  const { register, control, handleSubmit, watch, setValue, setError, formState: { errors } } = useForm<
    JobCreateInput,
    unknown,
    JobCreateData
  >({
    resolver: zodResolver(jobCreateSchema),
    defaultValues: {
      customer: { phone: '', name: '', city: '', altPhone: '', email: '', address: '' },
      customerType: 'CUSTOMER',
      jobType: 'MOBILE',
      accessoryName: '',
      branchId: null,
      retailer: '',
      inwardById: null,
      phoneDamaged: false,
      warranty: 'OUT_OF_WARRANTY',
      brandId: '',
      deviceModelId: '',
      manualBrand: '',
      manualModel: '',
      manualFault: '',
      imei: '',
      imei2: '',
      serialNumber: '',
      color: '',
      faults: [],
      customerComplaint: '',
      accessories: [],
      accessoriesOther: '',
      conditionNotes: '',
      skipDiagnosis: false,
      customerAlreadyApproved: false,
      dueAt: null,
      loanerPhone: false,
      loanerBrandId: null,
      loanerModelId: null,
      engineerId: '',
      advance: null,
    },
  });

  const brandId = watch('brandId');
  const modelId = watch('deviceModelId');
  const jobType = watch('jobType');
  const loanerPhone = watch('loanerPhone');
  const loanerBrandId = watch('loanerBrandId');
  const skipDiagnosis = watch('skipDiagnosis');
  const customerType = watch('customerType');
  const phone = watch('customer.phone');
  const selectedFaults = watch('faults') ?? [];
  const dueAt = watch('dueAt');
  const formBranch = isSuperAdmin ? (watch('branchId') ?? '') : (user?.branch?.id ?? '');
  const branchQs = isSuperAdmin ? `?branchId=${formBranch}` : '';

  const { items: brands } = useOptions<BrandDto>('brands', { branchId: formBranch || undefined });
  const { items: models } = useOptions<ModelDto>('models', { brandId }, { enabled: !!brandId });
  const { items: loanerModels } = useOptions<ModelDto>('models', { brandId: loanerBrandId ?? undefined }, { enabled: !!loanerBrandId });
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
  const intakeOptions = useQuery({
    queryKey: ['settings', 'branch-options', formBranch || 'own'],
    queryFn: () => api.get<BranchOptionsDto>(`/settings/branch-options${branchQs}`),
    enabled: !isSuperAdmin || !!formBranch,
  });
  const allowManualDevice = intakeOptions.data?.allowManualDevice ?? true;
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

  // Branch turned manual brand/model entry off: go back to the catalogue pickers.
  useEffect(() => {
    if (allowManualDevice || !manualDevice) return;
    setManualDevice(false);
    setValue('manualBrand', '');
    setValue('manualModel', '');
  }, [allowManualDevice, manualDevice, setValue]);

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

  const advanceAmount = advance.amount.trim() === '' ? 0 : Number(advance.amount);
  const checkAdvance = () => {
    const bad = !Number.isFinite(advanceAmount) || advanceAmount < 0 || Math.round(advanceAmount * 100) !== advanceAmount * 100;
    setAdvanceError(bad ? 'Enter a valid advance amount' : undefined);
    return !bad;
  };

  const onSubmit = handleSubmit((data) => {
    if (!checkAdvance()) {
      scrollToFirstError();
      return;
    }
    if (needsIdProof.length && !photos.ID_PROOF.length) {
      setIdProofError(`Aadhaar photo is compulsory for: ${needsIdProof.map((f) => f!.name).join(', ')}`);
      document.getElementById('photos')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const parsedExtras: JobDeviceData[] = [];
    for (let i = 0; i < extraDevices.length; i += 1) {
      const parsed = jobDeviceSchema.safeParse(extraDevices[i]);
      if (!parsed.success) {
        toast.error(`Device ${i + 2}: ${parsed.error.issues[0]?.message ?? 'Check the entered details'}`);
        document.getElementById(`extra-device-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      parsedExtras.push(parsed.data);
    }
    const primaryDevice: JobDeviceData = {
      jobType: data.jobType,
      accessoryName: data.accessoryName,
      brandId: data.brandId,
      deviceModelId: data.deviceModelId,
      manualBrand: data.manualBrand,
      manualModel: data.manualModel,
      manualFault: data.manualFault,
      imei: data.imei,
      imei2: data.imei2,
      serialNumber: data.serialNumber,
      color: data.color,
      faults: data.faults,
      customerComplaint: data.customerComplaint,
      accessories: data.accessories,
      accessoriesOther: data.accessoriesOther,
      conditionNotes: data.conditionNotes,
    };
    submit.mutate({
      ...data,
      devices: parsedExtras.length ? [primaryDevice, ...parsedExtras] : undefined,
      advance: advanceAmount > 0 ? { amount: advanceAmount, mode: advance.mode, reference: advance.reference.trim() || null } : null,
    });
  }, () => {
    checkAdvance();
    scrollToFirstError();
  });

  const err = (msg?: string) => (msg ? { error: msg } : {});

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-4xl space-y-5">
      {!embedded && <PageHeader title="New Job Sheet" description="Register a device received for repair" />}
      <DeadlinePicker value={dueAt} onChange={(value) => setValue('dueAt', value, { shouldValidate: true })} error={errors.dueAt?.message} />
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

      <Card title={customerType === 'RETAILER' ? 'Retailer contact' : 'Customer'}>
        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-sm">
          <input
            type="checkbox"
            checked={customerType === 'RETAILER'}
            onChange={(e) => {
              setValue('customerType', e.target.checked ? 'RETAILER' : 'CUSTOMER', { shouldValidate: true });
              if (!e.target.checked) setValue('retailer', '');
            }}
            className="mt-0.5 size-4 accent-brand-600"
          />
          <span>
            <span className="block font-medium text-slate-800">Received from a retailer</span>
            <span className="text-xs text-slate-500">Leave unchecked for a normal walk-in customer.</span>
          </span>
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Mobile number" required {...err(errors.customer?.phone?.message)}
            hint={returning ? `Returning customer — ${returning.name}` : undefined}>
            <input {...register('customer.phone')} inputMode="numeric" maxLength={10} autoFocus className={inputClass} />
          </Field>
          <Field label="Alternate mobile" {...err(errors.customer?.altPhone?.message)}>
            <input {...register('customer.altPhone')} inputMode="numeric" maxLength={10} className={inputClass} />
          </Field>
          <Field label={customerType === 'RETAILER' ? 'Contact person' : 'Customer name'} required {...err(errors.customer?.name?.message)}>
            <input {...register('customer.name')} className={inputClass} />
          </Field>
          <Field label="City" {...err(errors.customer?.city?.message)}>
            <CityInput {...register('customer.city')} />
          </Field>
          {customerType === 'RETAILER' && (
            <Field label="Retailer / shop name" required {...err(errors.retailer?.message)} hint="Dealer or shop that brought the devices">
              <input {...register('retailer')} className={inputClass} />
            </Field>
          )}
          <Field label="Email" {...err(errors.customer?.email?.message)}>
            <input {...register('customer.email')} type="email" className={inputClass} />
          </Field>
          <Field label="Address" className="sm:col-span-2" {...err(errors.customer?.address?.message)}>
            <input {...register('customer.address')} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card title="Primary device">
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
          {jobType === 'MOBILE' && allowManualDevice && (
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
          <Field label="IMEI 1 (optional)" className={jobType === 'MOBILE' ? '' : 'hidden'} {...err(errors.imei?.message)} hint="15 digits. Dial *#06# or tap scan">
            <ImeiInput {...register('imei')} invalid={!!errors.imei} />
          </Field>
          <Field label="IMEI 2 (optional)" className={jobType === 'MOBILE' ? '' : 'hidden'} {...err(errors.imei2?.message)}>
            <ImeiInput {...register('imei2')} invalid={!!errors.imei2} />
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
              {([['OUT_OF_WARRANTY', 'Out of warranty'], ['IN_WARRANTY', 'In warranty']] as const).map(([v, label]) => (
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

      {!extraDevices.length ? (
        <div className="theme-panel flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-2.5 ring-1 ring-slate-200/80">
          <span className="text-sm text-slate-600">More items from the same customer?</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => setExtraDevices((rows) => [...rows, extraDevice()])}>
            + Add item
          </Button>
        </div>
      ) : (
      <Card
        title="Additional devices / accessories"
        actions={
          <Button type="button" size="sm" variant="secondary" onClick={() => setExtraDevices((rows) => [...rows, extraDevice()])}>
            + Add item
          </Button>
        }
      >
          <div className="space-y-4">
            {extraDevices.map((device, index) => (
              <ExtraDeviceEditor
                key={device.id}
                index={index}
                device={device}
                accessoryOptions={(accessoryOptions.data ?? []).filter((a) => a.isActive)}
                onChange={(next) => setExtraDevices((rows) => rows.map((row) => row.id === next.id ? next : row))}
                onRemove={() => setExtraDevices((rows) => rows.filter((row) => row.id !== device.id))}
              />
            ))}
          </div>
      </Card>
      )}

      <Card title="Problem & estimate">
        <div className="mb-4">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={manualProblem}
              onChange={(e) => {
                const checked = e.target.checked;
                setManualProblem(checked);
                if (checked) {
                  setValue('faults', []);
                } else {
                  setValue('manualFault', '');
                }
              }}
              className="size-4 accent-brand-600 rounded"
            />
            Enter problem / fault manually (not in catalogue)
          </label>
        </div>

        {manualProblem ? (
          <Field label="Problem / Fault description" required {...err(errors.manualFault?.message)}>
            <input
              {...register('manualFault')}
              className={inputClass}
              placeholder="e.g. Dead, Screen flickering, Not powering on"
            />
          </Field>
        ) : (
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
                onEnterManually={() => {
                  setManualProblem(true);
                  setValue('faults', []);
                }}
              />
            )}
          />
        )}
        {errors.faults && <p data-field-error className="mt-1 text-xs text-red-600">{errors.faults.message ?? errors.faults.root?.message}</p>}
        {errors.manualFault && <p data-field-error className="mt-1 text-xs text-red-600">{errors.manualFault.message}</p>}

        {selectedFaults.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-600">
              Estimated amount{unpricedCount > 0 && ` (${unpricedCount} fault${unpricedCount === 1 ? '' : 's'} to be checked by engineer)`}
            </span>
            <span className="text-lg font-semibold">{pricedTotal > 0 ? formatCurrency(pricedTotal) : 'To be decided'}</span>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4">
          <Field label="Total Amount" {...err(errors.totalAmount?.message)} hint="Optional — CCO can change it later">
            <div className="relative">
              <IndianRupee className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input {...register('totalAmount')} inputMode="decimal" aria-invalid={!!errors.totalAmount || undefined} className={`${inputClass} py-2.5! pl-9!`} placeholder={pricedTotal > 0 ? String(pricedTotal) : 'Amount'} />
            </div>
          </Field>
          <Field label="Advance Amount" {...err(advanceError)} hint="Optional — received now">
            <div className="relative">
              <Banknote className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={advance.amount}
                onChange={(e) => (setAdvance((a) => ({ ...a, amount: e.target.value })), setAdvanceError(undefined))}
                inputMode="decimal"
                aria-invalid={!!advanceError || undefined}
                className={`${inputClass} py-2.5! pl-9!`}
                placeholder="Advance"
              />
            </div>
          </Field>
          {advanceAmount > 0 && (
            <>
              <Field label="Advance paid by">
                <select value={advance.mode} onChange={(e) => setAdvance((a) => ({ ...a, mode: e.target.value as typeof a.mode }))} className={inputClass}>
                  {PAYMENT_MODES.map((m) => <option key={m} value={m}>{PAYMENT_MODE_LABELS[m]}</option>)}
                </select>
              </Field>
              {advance.mode !== 'CASH' && (
                <Field label="UPI / card ref." {...err(errors.advance?.reference?.message)}>
                  <input value={advance.reference} onChange={(e) => setAdvance((a) => ({ ...a, reference: e.target.value }))} maxLength={60} className={inputClass} />
                </Field>
              )}
            </>
          )}
        </div>
        <Field label="Assign engineer" required className="mt-4 max-w-sm" {...err(errors.engineerId?.message)} hint="The job goes to this engineer for diagnosis or repair">
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
        {needsIdProof.length > 0 && (
          <div className="mt-3 rounded-md bg-red-50 px-4 py-2.5 text-sm text-red-700">
            🔒 Aadhaar photo is compulsory for {needsIdProof.map((f) => f!.name).join(', ')}.
          </div>
        )}
        <Field label="Remarks / customer complaint" className="mt-4" {...err(errors.customerComplaint?.message)}>
          <textarea {...register('customerComplaint')} rows={2} className={inputClass} />
        </Field>
      </Card>

      <Card title="Loaner phone">
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            {...register('loanerPhone', {
              onChange: (e) => {
                if (e.target.checked) return;
                setValue('loanerBrandId', null, { shouldValidate: true });
                setValue('loanerModelId', null, { shouldValidate: true });
              },
            })}
            className="mt-0.5 size-4 accent-brand-600"
          />
          <span>
            <span className="block font-medium text-slate-800">Loaner Phone</span>
            <span className="text-xs text-slate-500">A phone is lent to the customer. The job cannot be delivered or closed until it is returned.</span>
          </span>
        </label>
        {loanerPhone && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Loaner phone brand" required {...err(errors.loanerBrandId?.message)}>
              <Controller
                control={control}
                name="loanerBrandId"
                render={({ field }) => (
                  <Combobox
                    value={field.value ?? ''}
                    onChange={(v) => {
                      field.onChange(v || null);
                      setValue('loanerModelId', null);
                    }}
                    placeholder="Select brand"
                    invalid={!!errors.loanerBrandId}
                    options={brands.map((b) => ({ value: b.id, label: b.name }))}
                  />
                )}
              />
            </Field>
            <Field label="Loaner phone model number" required {...err(errors.loanerModelId?.message)}>
              <Controller
                control={control}
                name="loanerModelId"
                render={({ field }) => (
                  <Combobox
                    value={field.value ?? ''}
                    onChange={(v) => field.onChange(v || null)}
                    disabled={!loanerBrandId}
                    placeholder={loanerBrandId ? 'Select model' : 'Select brand first'}
                    invalid={!!errors.loanerModelId}
                    emptyText="Model not found — ask admin to add it"
                    options={loanerModels.map((m) => ({ value: m.id, label: m.name }))}
                  />
                )}
              />
            </Field>
          </div>
        )}
      </Card>

      <Card title="Inward">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Inward by" {...err(errors.inwardById?.message)} hint="Who took the device in (defaults to you)">
            <select {...register('inwardById', { setValueAs: (v: string | null) => v || null })} className={inputClass}>
              <option value="">{user?.name} (me)</option>
              {(inwardStaff.data ?? []).filter((u) => u.id !== user?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        </div>
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
        </div>
      </Card>

      <div id="photos">
        <Card title="Photos" subtitle="Phone, physical condition, customer and Aadhaar / ID">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <PhotoPicker label={PHOTO_KIND_LABELS.DEVICE} files={photos.DEVICE} onChange={(f) => setPhotos((p) => ({ ...p, DEVICE: f }))} multiple />
            <PhotoPicker label={PHOTO_KIND_LABELS.PHYSICAL_CONDITION} files={photos.PHYSICAL_CONDITION} onChange={(f) => setPhotos((p) => ({ ...p, PHYSICAL_CONDITION: f }))} multiple />
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

      <StickyActions>
        <Button variant="secondary" onClick={() => navigate('/jobs')}>
          Cancel
        </Button>
        <Button type="submit" loading={submit.isPending}>
          {submit.isPending ? 'Saving…' : 'Create job sheet'}
        </Button>
      </StickyActions>
    </form>
  );
}

// ─── Fault picker: category tabs → faults, each with an optional price option ───

function ExtraDeviceEditor({
  index,
  device,
  accessoryOptions,
  onChange,
  onRemove,
}: {
  index: number;
  device: ExtraDeviceDraft;
  accessoryOptions: AccessoryOptionDto[];
  onChange: (device: ExtraDeviceDraft) => void;
  onRemove: () => void;
}) {
  const set = <K extends keyof ExtraDeviceDraft>(key: K, value: ExtraDeviceDraft[K]) => onChange({ ...device, [key]: value });
  const toggleAccessory = (name: string) => set(
    'accessories',
    device.accessories.includes(name) ? device.accessories.filter((item) => item !== name) : [...device.accessories, name],
  );

  return (
    <section id={`extra-device-${index}`} className="rounded-xl border border-brand-200 bg-brand-50/30 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Item {index + 2}</h3>
          <p className="text-xs text-slate-500">Model, problem and received accessories are stored separately.</p>
        </div>
        <Button type="button" size="sm" variant="danger" onClick={onRemove}>Remove</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Item type" required className="sm:col-span-2">
          <div className="flex gap-5 pt-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={device.jobType === 'MOBILE'} onChange={() => set('jobType', 'MOBILE')} className="accent-brand-600" />
              Mobile / tablet
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={device.jobType === 'ACCESSORY'} onChange={() => set('jobType', 'ACCESSORY')} className="accent-brand-600" />
              Accessory
            </label>
          </div>
        </Field>

        {device.jobType === 'MOBILE' ? (
          <>
            <Field label="Brand" required>
              <input value={device.manualBrand} onChange={(e) => set('manualBrand', e.target.value)} className={inputClass} placeholder="e.g. Samsung" />
            </Field>
            <Field label="Model" required>
              <input value={device.manualModel} onChange={(e) => set('manualModel', e.target.value)} className={inputClass} placeholder="e.g. Galaxy A52" />
            </Field>
            <Field label="IMEI 1 (optional)" hint="15 digits">
              <ImeiInput value={device.imei} onChange={(e) => set('imei', e.target.value)} />
            </Field>
            <Field label="IMEI 2 (optional)">
              <ImeiInput value={device.imei2} onChange={(e) => set('imei2', e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Accessory name" required>
              <input value={device.accessoryName} onChange={(e) => set('accessoryName', e.target.value)} className={inputClass} placeholder="e.g. Smartwatch or charger" />
            </Field>
            <Field label="Serial number">
              <input value={device.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} className={`${inputClass} font-mono uppercase`} />
            </Field>
          </>
        )}

        <Field label="Colour">
          <input value={device.color} onChange={(e) => set('color', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Problem / fault" required>
          <input value={device.manualFault} onChange={(e) => set('manualFault', e.target.value)} className={inputClass} placeholder="e.g. Dead, display flickering" />
        </Field>
        <Field label="Customer complaint" className="sm:col-span-2">
          <textarea value={device.customerComplaint} onChange={(e) => set('customerComplaint', e.target.value)} rows={2} className={inputClass} />
        </Field>
        <Field label="Physical condition" className="sm:col-span-2">
          <input value={device.conditionNotes} onChange={(e) => set('conditionNotes', e.target.value)} className={inputClass} placeholder="Scratches, dents, cracks…" />
        </Field>
      </div>

      <div className="mt-4 border-t border-brand-200 pt-4">
        <div className="mb-2 text-sm font-medium text-slate-700">Accessories received with this item</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {accessoryOptions.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={device.accessories.includes(option.name)}
                onChange={() => toggleAccessory(option.name)}
                className="size-4 accent-brand-600"
              />
              {option.name}
            </label>
          ))}
        </div>
        <Field label="Other received items" className="mt-3">
          <input value={device.accessoriesOther} onChange={(e) => set('accessoriesOther', e.target.value)} className={inputClass} />
        </Field>
      </div>
    </section>
  );
}

type Selected = { faultId: string; priceId?: string | null };

type PickerProps = {
  faults: FaultDto[];
  value: Selected[];
  onChange: (v: Selected[]) => void;
  optionsByFault: Map<string, ModelPriceDto[]>;
  modelChosen: boolean;
  onEnterManually?: () => void;
};

export function FaultPicker({ faults, value, onChange, optionsByFault, modelChosen, onEnterManually }: PickerProps) {
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
  const faultById = new Map(faults.map((f) => [f.id, f]));
  // Category dropdown; start on the category of the first fault already chosen (edit form).
  const [activeCat, setActiveCat] = useState<string | null>(() => {
    const first = value[0] && faultById.get(value[0].faultId);
    return first ? (first.category?.id ?? 'other') : null;
  });
  const selectedIds = new Set(value.map((v) => v.faultId));
  const activeFaults = categories.find(([id]) => id === activeCat)?.[1].faults ?? [];

  const toggle = (f: FaultDto) => {
    if (selectedIds.has(f.id)) return onChange(value.filter((v) => v.faultId !== f.id));
    const opts = optionsByFault.get(f.id) ?? [];
    // Pre-select the only option when there is just one.
    onChange([...value, { faultId: f.id, priceId: opts.length === 1 ? opts[0]!.id : null }]);
  };

  if (!faults.length) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-medium">No faults configured in catalogue for this branch.</p>
        <p className="mt-1 text-xs text-amber-700">You can type the problem manually instead so intake is not blocked.</p>
        {onEnterManually && (
          <button
            type="button"
            onClick={onEnterManually}
            className="mt-3 inline-flex items-center rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            Enter problem manually
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Problem category <span className="text-red-500">*</span></span>
          <select value={activeCat ?? ''} onChange={(e) => setActiveCat(e.target.value || null)} className={inputClass} aria-label="Problem category">
            <option value="">Select category…</option>
            {categories.map(([id, c]) => {
              const count = c.faults.filter((f) => selectedIds.has(f.id)).length;
              return <option key={id} value={id}>{c.name}{count ? ` (${count} selected)` : ''}</option>;
            })}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Problem <span className="text-red-500">*</span></span>
          <select
            value=""
            disabled={!activeFaults.length}
            onChange={(e) => { const f = faultById.get(e.target.value); if (f) toggle(f); }}
            className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400`}
            aria-label="Problem"
          >
            <option value="">{activeCat ? 'Select problem to add…' : 'Select a category first'}</option>
            {activeFaults.map((f) => (
              <option key={f.id} value={f.id} disabled={selectedIds.has(f.id)}>
                {f.name}{f.requiresIdProof ? ' 🔒' : ''}{selectedIds.has(f.id) ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

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
