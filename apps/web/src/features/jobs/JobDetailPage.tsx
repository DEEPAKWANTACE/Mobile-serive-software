import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  ASSIGNABLE_STATUSES,
  CALL_OUTCOME_LABELS,
  RWR_REASON_LABELS,
  JOB_STATUS_LABELS,
  type JobStatus,
  ENGINEER_VISIBLE_PHOTO_KINDS,
  jobDeviceUpdateSchema,
  PAYMENT_MODE_LABELS,
  type JobDeviceUpdateData,
  type JobDeviceUpdateInput,
  PHOTO_KIND_LABELS,
  PHOTO_KINDS,
  ROLES,
  type JobDto,
  type JobHistoryEntryDto,
  type JobPhotoDto,
  type PhotoKind,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { FormActions } from '@/components/ui/FormActions';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/lib/api-client';
import { handleFormError } from '@/lib/form-errors';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { AssignEngineerDialog } from './AssignEngineerDialog';
import { AuthImage } from './AuthImage';
import { uploadJobPhotos, useJob, useJobHistory } from './api';
import { JobStatusBadge } from './JobStatusBadge';
import { PhotoPicker } from './PhotoPicker';
import { JobPartsCard } from './JobPartsCard';
import { JobCallsCard } from '@/features/calling/JobCallsCard';
import { WorkPanel } from './WorkPanel';
import { MovementsCard } from '@/features/l4/L4Actions';

export function JobDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { data: job, isLoading, error } = useJob(id);
  const [assigning, setAssigning] = useState(false);

  if (isLoading) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  if (error || !job) {
    return (
      <div className="p-10 text-center">
        <p className="text-slate-600">{error?.message ?? 'Job not found'}</p>
        <Link to="/jobs" className="mt-2 inline-block text-brand-600 hover:underline">
          Back to job sheets
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/jobs" className="text-sm text-slate-500 hover:underline">
            ← {user?.role === ROLES.ENGINEER ? 'My jobs' : 'Job sheets'}
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{job.jobNumber}</h1>
            <JobStatusBadge status={job.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Received {formatDateTime(job.createdAt)} at {job.branch.name} by {job.createdBy.name}
          </p>
        </div>
        <div className="rounded-lg bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
          <div className="text-xs text-slate-500">Engineer</div>
          <div className="mt-0.5 flex items-center gap-3">
            <span className="font-medium">{job.assignedEngineer?.name ?? <span className="text-amber-700">Not assigned</span>}</span>
            {user?.role !== ROLES.ENGINEER &&
              ASSIGNABLE_STATUSES.includes(job.status) &&
              job.location === 'AT_BRANCH' &&
              (!user?.branch || user.branch.id === job.currentBranch.id) && (
              <Button size="sm" variant={job.assignedEngineer ? 'secondary' : 'primary'} onClick={() => setAssigning(true)}>
                {job.assignedEngineer ? 'Reassign' : 'Assign engineer'}
              </Button>
            )}
          </div>
          {job.assignedAt && <div className="mt-0.5 text-xs text-slate-500">since {formatDateTime(job.assignedAt)}</div>}
        </div>
      </div>
      <AssignEngineerDialog
        job={
          assigning
            ? { id: job.id, jobNumber: job.jobNumber, branchId: job.currentBranch.id, assignedEngineerId: job.assignedEngineer?.id ?? null }
            : null
        }
        onClose={() => setAssigning(false)}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <WorkPanel job={job} />
          <JobPartsCard job={job} />
          <JobInfo job={job} />
          <Photos job={job} />
        </div>
        <div className="space-y-5">
          <JobCallsCard job={job} />
          <MovementsCard job={job} />
          <History jobId={job.id} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function JobInfo({ job }: { job: JobDto }) {
  const accessories = [...job.accessories, ...(job.accessoriesOther ? [job.accessoriesOther] : [])];
  const [editingDevice, setEditingDevice] = useState(false);
  return (
    <>
      <Card
        title="Customer & device"
        actions={
          job.status !== 'DELIVERED' && (
            <Button variant="link" onClick={() => setEditingDevice(true)}>
              {job.imei || job.serialNumber ? 'Edit IMEI / serial' : 'Add IMEI / serial'}
            </Button>
          )
        }
      >
        {!job.imei && !job.serialNumber && job.status !== 'DELIVERED' && (
          <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            IMEI / serial not recorded yet — it must be added before the phone is delivered.
          </div>
        )}
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Row label="Customer">{job.customer.name}</Row>
          <Row label="Mobile">
            <a href={`tel:${job.customer.phone}`} className="text-brand-600 hover:underline">
              {job.customer.phone}
            </a>
          </Row>
          <Row label="Alternate mobile">{job.customer.altPhone}</Row>
          <Row label="Email">{job.customer.email}</Row>
          <div className="sm:col-span-2">
            <Row label="Address">{job.customer.address}</Row>
          </div>
          <Row label="Device">
            {job.brand.name} {job.model.name}
          </Row>
          <Row label="IMEI">{job.imei && <span className="font-mono">{job.imei}</span>}</Row>
          <Row label="Serial no.">{job.serialNumber && <span className="font-mono">{job.serialNumber}</span>}</Row>
          <Row label="Colour">{job.color}</Row>
        </dl>
        <Modal open={editingDevice} onClose={() => setEditingDevice(false)} title="IMEI / serial number" size="sm">
          {editingDevice && <DeviceForm job={job} onDone={() => setEditingDevice(false)} />}
        </Modal>
      </Card>
      <Card title="Problem & intake">
        <dl className="space-y-4">
          <Row label="Faults reported">
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {job.faults.map((f) => (
                <li key={f.id} className="flex justify-between gap-3 px-3 py-1.5">
                  <span>{f.name}</span>
                  <span className="text-slate-600">
                    {f.price !== null ? `${f.priceLabel} — ${formatCurrency(f.price)}` : <span className="text-slate-400">To be decided</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Row>
          <Row label="Customer complaint">{job.customerComplaint}</Row>
          <Row label="Accessories received">{accessories.length ? accessories.join(', ') : 'None'}</Row>
          <Row label="Physical condition">{job.conditionNotes}</Row>
        </dl>
      </Card>
      <Estimate job={job} />
    </>
  );
}

function Estimate({ job }: { job: JobDto }) {
  const paid = job.payments.reduce((sum, p) => sum + p.amount, 0);
  return (
    <Card title="Estimate & payments">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Row label="Estimated amount">
          <span className="text-base font-semibold">{job.estimatedAmount !== null ? formatCurrency(job.estimatedAmount) : 'To be decided'}</span>
        </Row>
        <Row label="Received so far">
          <span className="text-base font-semibold text-emerald-700">{formatCurrency(paid)}</span>
        </Row>
        {job.estimatedAmount !== null && (
          <Row label="Balance (as per estimate)">
            <span className="text-base font-semibold">{formatCurrency(Math.max(0, job.estimatedAmount - paid))}</span>
          </Row>
        )}
      </dl>
      {job.payments.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-slate-600">
          {job.payments.map((p) => (
            <li key={p.id}>
              {p.kind === 'ADVANCE' ? 'Advance' : 'Payment'} · {formatCurrency(p.amount)} by {PAYMENT_MODE_LABELS[p.mode]}
              {p.reference && ` (${p.reference})`} · {formatDateTime(p.createdAt)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeviceForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<JobDeviceUpdateInput, unknown, JobDeviceUpdateData>({
    resolver: zodResolver(jobDeviceUpdateSchema),
    defaultValues: { imei: job.imei ?? '', serialNumber: job.serialNumber ?? '' },
  });
  const save = useMutation({
    mutationFn: (data: JobDeviceUpdateData) => api.patch(`/jobs/${job.id}/device`, data),
    onSuccess: () => {
      toast.success('Device details updated');
      void queryClient.invalidateQueries({ queryKey: ['jobs', job.id] });
      onDone();
    },
    onError: (err) => handleFormError(err, setError),
  });

  return (
    <form onSubmit={handleSubmit((d) => save.mutate(d))} className="space-y-4">
      <Field label="IMEI" error={errors.imei?.message} hint="15 digits — dial *#06#">
        <input {...register('imei')} inputMode="numeric" maxLength={15} autoFocus className={`${inputClass} font-mono`} />
      </Field>
      <Field label="Serial number" error={errors.serialNumber?.message}>
        <input {...register('serialNumber')} className={`${inputClass} font-mono uppercase`} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} />
    </form>
  );
}

function Photos({ job }: { job: JobDto }) {
  const { user } = useAuth();
  const canUpload = user?.role === ROLES.CCO || user?.role === ROLES.BRANCH_MANAGER;
  // Engineers only get device photos from the API, so don't show empty customer/ID sections.
  const kinds = user?.role === ROLES.ENGINEER ? ENGINEER_VISIBLE_PHOTO_KINDS : PHOTO_KINDS;
  const [viewing, setViewing] = useState<JobPhotoDto | null>(null);
  const [adding, setAdding] = useState<PhotoKind | null>(null);
  const src = (p: JobPhotoDto) => `/jobs/${job.id}/photos/${p.id}`;

  return (
    <Card title="Photos">
      <div className="space-y-5">
        {kinds.map((kind) => {
          const list = job.photos.filter((p) => p.kind === kind);
          if (kind === 'RWR' && !list.length) return null;
          return (
            <div key={kind}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{PHOTO_KIND_LABELS[kind]}</span>
                {canUpload && kind !== 'RWR' && (
                  <Button variant="link" onClick={() => setAdding(kind)}>
                    Add
                  </Button>
                )}
              </div>
              {list.length ? (
                <div className="flex flex-wrap gap-2">
                  {list.map((p) => (
                    <button key={p.id} type="button" onClick={() => setViewing(p)} className="overflow-hidden rounded-md ring-1 ring-slate-200">
                      <AuthImage src={src(p)} alt={PHOTO_KIND_LABELS[kind]} className="size-24 object-cover" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No photos</p>
              )}
            </div>
          );
        })}
      </div>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? PHOTO_KIND_LABELS[viewing.kind] : ''} size="lg">
        {viewing && <AuthImage src={src(viewing)} alt="" className="mx-auto max-h-[70vh] w-auto rounded" />}
      </Modal>
      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding ? `Add photos — ${PHOTO_KIND_LABELS[adding]}` : ''}>
        {adding && <AddPhotos jobId={job.id} kind={adding} onDone={() => setAdding(null)} />}
      </Modal>
    </Card>
  );
}

function AddPhotos({ jobId, kind, onDone }: { jobId: string; kind: PhotoKind; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await uploadJobPhotos(jobId, kind, files);
      toast.success('Photos added');
      await queryClient.invalidateQueries({ queryKey: ['jobs', jobId] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PhotoPicker label="Photos" files={files} onChange={setFiles} multiple />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={!files.length} loading={saving} onClick={() => void save()}>
          Upload
        </Button>
      </div>
    </div>
  );
}

function formatMinutes(mins: number) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ${mins % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

function describe(entry: JobHistoryEntryDto) {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  switch (entry.action) {
    case 'job.created':
      return meta.estimatedAmount != null
        ? `Job sheet created — estimate ${formatCurrency(Number(meta.estimatedAmount))}`
        : 'Job sheet created';
    case 'job.photos_added': {
      const kind = meta.kind as PhotoKind | undefined;
      const count = Number(meta.count ?? 0);
      return `${kind ? PHOTO_KIND_LABELS[kind] : 'Photos'}: ${count} photo${count === 1 ? '' : 's'} added`;
    }
    case 'payment.received':
      return `${meta.kind === 'ADVANCE' ? 'Advance' : 'Payment'} received: ${formatCurrency(Number(meta.amount ?? 0))} (${PAYMENT_MODE_LABELS[meta.mode as keyof typeof PAYMENT_MODE_LABELS] ?? meta.mode})`;
    case 'job.device_updated': {
      const to = (meta.to ?? {}) as { imei?: string | null; serialNumber?: string | null };
      return `Device details updated${to.imei ? ` — IMEI ${to.imei}` : ''}${to.serialNumber ? ` — S/N ${to.serialNumber}` : ''}`;
    }
    case 'job.diagnosed':
      return meta.autoApproved
        ? `Diagnosed — estimate ${formatCurrency(Number(meta.total ?? 0))} (within agreed amount)`
        : `Diagnosed — estimate ${formatCurrency(Number(meta.total ?? 0))}, sent for customer approval`;
    case 'job.approved':
      return `Customer approved ${formatCurrency(Number(meta.amount ?? 0))}${meta.note ? ` — “${meta.note}”` : ''}`;
    case 'job.rejected':
      return `Customer rejected ${formatCurrency(Number(meta.amount ?? 0))} — “${meta.note ?? ''}”`;
    case 'job.status_changed':
      return `${JOB_STATUS_LABELS[meta.from as JobStatus] ?? meta.from} → ${JOB_STATUS_LABELS[meta.to as JobStatus] ?? meta.to}${meta.note ? ` — “${meta.note}”` : ''}`;
    case 'job.transfer_requested':
      return `Transfer requested to ${(meta.to as { name?: string })?.name} — “${meta.reason ?? ''}”`;
    case 'job.transfer_accepted':
      return `Transfer accepted by ${(meta.to as { name?: string })?.name} (held by ${(meta.from as { name?: string })?.name} for ${formatMinutes(Number(meta.heldMinutes ?? 0))})`;
    case 'job.transfer_rejected':
      return `Transfer rejected by ${(meta.to as { name?: string })?.name} — “${meta.note ?? ''}”`;
    case 'job.transfer_cancelled':
      return 'Transfer request cancelled';
    case 'job.spare_hold':
      return `Spare not available: ${meta.part ?? ''}`;
    case 'job.spare_received':
      return `Spare received${meta.waitedMinutes != null ? ` after ${formatMinutes(Number(meta.waitedMinutes))}` : ''} — work resumed`;
    case 'job.rwr':
      return `Returned without repair — ${RWR_REASON_LABELS[meta.reason as keyof typeof RWR_REASON_LABELS] ?? meta.reason}: “${meta.note ?? ''}”`;
    case 'job.part_requested':
      return `Part requested: ${meta.code} ${meta.name}${Number(meta.quantity) > 1 ? ` × ${meta.quantity}` : ''}`;
    case 'job.part_issued':
      return `Part issued: ${meta.code} ${meta.name}`;
    case 'job.part_not_available':
      return `Part not available: ${meta.part}${meta.jobOnHold ? ' — job waiting for spare' : ''}`;
    case 'job.part_returned':
      return `Part returned to stock: ${meta.code} ${meta.name}`;
    case 'job.part_cancelled':
      return `Part request cancelled: ${meta.code} ${meta.name}`;
    case 'job.delivered':
      return `Delivered to ${meta.deliveredTo} — invoice ${meta.invoiceNumber}, total ${formatCurrency(Number(meta.total ?? 0))}${Number(meta.refund) > 0 ? `, refunded ${formatCurrency(Number(meta.refund))}` : ''}`;
    case 'job.call_logged':
      return `Customer call: ${CALL_OUTCOME_LABELS[meta.outcome as keyof typeof CALL_OUTCOME_LABELS] ?? meta.outcome}${meta.note ? ` — “${meta.note}”` : ''}`;
    case 'job.sent_to_l4':
      return `Sent to L4: ${(meta.to as { name?: string })?.name ?? ''} — “${meta.reason ?? ''}”`;
    case 'job.received_at_l4':
      return `Received at L4${meta.note ? ` — “${meta.note}”` : ''}`;
    case 'job.sent_back_from_l4':
      return `Sent back from L4${meta.note ? ` — “${meta.note}”` : ''}`;
    case 'job.received_from_l4':
      return `Received back at branch from L4${meta.note ? ` — “${meta.note}”` : ''}`;
    case 'job.assigned':
      return `Assigned to ${(meta.engineer as { name?: string } | undefined)?.name ?? 'engineer'}`;
    case 'job.reassigned':
      return `Reassigned from ${(meta.previousEngineer as { name?: string } | undefined)?.name ?? '—'} to ${(meta.engineer as { name?: string } | undefined)?.name ?? '—'}`;
    default:
      return entry.action;
  }
}

function History({ jobId }: { jobId: string }) {
  const { data } = useJobHistory(jobId);
  return (
    <Card title="History" className="h-fit">
      <ol className="relative space-y-4 border-l border-slate-200 pl-5">
        {data?.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
            <div className="text-sm font-medium">{describe(e)}</div>
            <div className="text-xs text-slate-500">
              {e.actor?.name ?? 'System'} · {formatDateTime(e.createdAt)}
            </div>
          </li>
        ))}
        {!data && <li className="text-sm text-slate-400">Loading…</li>}
      </ol>
    </Card>
  );
}
