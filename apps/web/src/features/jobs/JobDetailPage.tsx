import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  ADMIN_REASSIGNABLE_STATUSES,
  ASSIGNABLE_STATUSES,
  CLOSED_STATUSES,
  jobPaymentSchema,
  PAYMENT_MODES,
  WARRANTY_LABELS,
  type JobPaymentData,
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
import { Eye, EyeOff } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
import { EditJobForm } from './EditJobForm';
import { ImeiWarning } from './ImeiWarning';
import { MovementsCard } from '@/features/l4/L4Actions';
import { WhatsAppButton } from '@/features/messages/WhatsAppButton';

export function JobDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { data: job, isLoading, error } = useJob(id);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const queryClient = useQueryClient();
  const unassign = useMutation({
    mutationFn: () => api.post(`/jobs/${id}/unassign`, {}),
    onSuccess: () => {
      toast.success('Job taken back from the engineer');
      setUnassigning(false);
      void queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

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

  const isManager = user?.role === ROLES.SUPER_ADMIN || user?.role === ROLES.BRANCH_MANAGER;
  const closed = CLOSED_STATUSES.includes(job.status);
  const sameBranch = !user?.branch || user.branch.id === job.currentBranch.id;
  const canAssign =
    user?.role !== ROLES.ENGINEER &&
    (isManager ? ADMIN_REASSIGNABLE_STATUSES : ASSIGNABLE_STATUSES).includes(job.status) &&
    job.location === 'AT_BRANCH' &&
    sameBranch;

  return (
    <div className="space-y-5">
      {job.status === 'CANCELLED' && (
        <div className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
          <span className="font-medium">Cancelled</span>
          {job.cancelledAt && ` on ${formatDateTime(job.cancelledAt)}`}
          {job.cancelReason && ` — “${job.cancelReason}”`}
        </div>
      )}
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
            Received {formatDateTime(job.createdAt)} at {job.branch.name} by {job.inwardBy?.name ?? job.createdBy.name}
          </p>
          {user?.role !== ROLES.ENGINEER && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Link to={`/jobs/${job.id}/print`}>
                <Button size="sm" variant="secondary">🖨 Print job sheet</Button>
              </Link>
              {!closed && (!user?.branch || user.branch.id === job.branch.id) && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                    ✏️ Edit job sheet
                  </Button>
                  <Link to={`/jobs?tab=delete&job=${encodeURIComponent(job.jobNumber)}`}>
                    <Button size="sm" variant="secondary">{isManager ? 'Cancel / delete' : 'Cancel job'}</Button>
                  </Link>
                </>
              )}
              <WhatsAppButton
                phone={job.customer.phone}
                status={job.status}
                context={{
                  customerName: job.customer.name,
                  jobNumber: job.jobNumber,
                  device: `${job.brand.name} ${job.model.name}`,
                  branchName: job.branch.name,
                  branchPhone: job.branch.phone,
                  estimate: job.quotedAmount ?? job.estimatedAmount,
                  balance: (job.quotedAmount ?? 0) - job.payments.reduce((s, p) => s + (p.kind === 'REFUND' ? -p.amount : p.amount), 0),
                }}
              />
            </div>
          )}
        </div>
        <div className="rounded-lg bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
          <div className="text-xs text-slate-500">Engineer</div>
          <div className="mt-0.5 flex items-center gap-3">
            <span className="font-medium">{job.assignedEngineer?.name ?? <span className="text-amber-700">Not assigned</span>}</span>
            {canAssign && (
              <Button size="sm" variant={job.assignedEngineer ? 'secondary' : 'primary'} onClick={() => setAssigning(true)}>
                {job.assignedEngineer ? 'Reassign' : 'Assign engineer'}
              </Button>
            )}
            {canAssign && job.status === 'ASSIGNED' && job.assignedEngineer && (
              <Button size="sm" variant="secondary" onClick={() => setUnassigning(true)}>
                Unassign
              </Button>
            )}
          </div>
          {job.assignedAt && <div className="mt-0.5 text-xs text-slate-500">since {formatDateTime(job.assignedAt)}</div>}
        </div>
      </div>
      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit job sheet ${job.jobNumber}`} size="lg">
        {editing && <EditJobForm job={job} onDone={() => setEditing(false)} />}
      </Modal>
      <ConfirmDialog
        open={unassigning}
        title={`Take ${job.jobNumber} back from ${job.assignedEngineer?.name ?? 'the engineer'}?`}
        message="The job goes back to Received and can be assigned to someone else. The assignment history is kept."
        confirmLabel="Unassign"
        loading={unassign.isPending}
        onConfirm={() => unassign.mutate()}
        onClose={() => setUnassigning(false)}
      />
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
          <RepairNotes job={job} />
          <JobPartsCard job={job} />
          <JobInfo job={job} />
          <Photos job={job} />
        </div>
        <div className="space-y-5">
          <JobCallsCard job={job} />
          <MovementsCard job={job} />
          <StatusTimeline job={job} />
          <Assignments job={job} />
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
          !CLOSED_STATUSES.includes(job.status) && (
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
          <Row label="City">{job.customer.city}</Row>
          <Row label="Address">{job.customer.address}</Row>
          <Row label="Retailer">{job.retailer}</Row>
          <Row label="Device">
            {job.brand.name} {job.model.name}
          </Row>
          <Row label="IMEI">{job.imei && <span className="font-mono">{job.imei}</span>}</Row>
          <Row label="Serial no.">{job.serialNumber && <span className="font-mono">{job.serialNumber}</span>}</Row>
          <Row label="Colour">{job.color}</Row>
          <Row label="Warranty">{job.warranty && WARRANTY_LABELS[job.warranty]}</Row>
          <Row label="Phone damaged">{job.phoneDamaged ? <span className="font-medium text-amber-700">Yes</span> : 'No'}</Row>
          <Row label="Phone password / pattern">{job.devicePassword && <SecretValue value={job.devicePassword} />}</Row>
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
          <Row label="Extra added (items received)">{accessories.length ? accessories.join(', ') : 'None'}</Row>
          <Row label="Physical condition / remark">{job.conditionNotes}</Row>
          <Row label="Inward by">{job.inwardBy?.name}</Row>
        </dl>
      </Card>
      <Estimate job={job} />
    </>
  );
}

function Estimate({ job }: { job: JobDto }) {
  const { user } = useAuth();
  const [receiving, setReceiving] = useState(false);
  const canReceive =
    user?.role !== ROLES.ENGINEER && !CLOSED_STATUSES.includes(job.status) && job.balance > 0 && (!user?.branch || user.branch.id === job.branch.id);
  return (
    <Card
      title="Amount & payments"
      actions={canReceive && <Button size="sm" onClick={() => setReceiving(true)}>Receive payment</Button>}
    >
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Row label={job.quotedAmount !== null ? 'Total (approved)' : 'Total (estimate)'}>
          <span className="text-base font-semibold">{job.totalAmount || job.estimatedAmount !== null ? formatCurrency(job.totalAmount) : 'To be decided'}</span>
        </Row>
        <Row label="Paid">
          <span className="text-base font-semibold text-emerald-700">{formatCurrency(job.paidAmount)}</span>
        </Row>
        <Row label={job.balance < 0 ? 'Refund due' : 'Balance'}>
          <span className={`text-base font-semibold ${job.balance > 0 ? 'text-amber-700' : ''}`}>{formatCurrency(Math.abs(job.balance))}</span>
        </Row>
      </dl>
      {job.payments.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
          {job.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2 px-3 py-1.5">
              <span>
                {p.kind === 'ADVANCE' ? 'Advance / part payment' : p.kind === 'REFUND' ? 'Refund' : 'Payment'} · {PAYMENT_MODE_LABELS[p.mode]}
                {p.reference && ` (${p.reference})`}
                <span className="text-slate-500"> · {formatDateTime(p.createdAt)}</span>
              </span>
              <span className={`font-medium ${p.kind === 'REFUND' ? 'text-red-700' : ''}`}>
                {p.kind === 'REFUND' ? '−' : ''}
                {formatCurrency(p.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={receiving} onClose={() => setReceiving(false)} title={`Receive payment — ${job.jobNumber}`} size="sm">
        {receiving && <PaymentForm job={job} onDone={() => setReceiving(false)} />}
      </Modal>
    </Card>
  );
}

function PaymentForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<z.input<typeof jobPaymentSchema>, unknown, JobPaymentData>({
    resolver: zodResolver(jobPaymentSchema),
    defaultValues: { amount: job.balance, mode: 'CASH', reference: '' },
  });
  const save = useMutation({
    mutationFn: (data: JobPaymentData) => api.post(`/jobs/${job.id}/payments`, data),
    onSuccess: () => {
      toast.success('Payment received');
      void queryClient.invalidateQueries({ queryKey: ['jobs', job.id] });
      onDone();
    },
    onError: (err) => handleFormError(err, setError),
  });
  return (
    <form onSubmit={handleSubmit((d) => save.mutate(d))} className="space-y-4">
      <p className="text-sm text-slate-600">Balance due: <span className="font-semibold">{formatCurrency(job.balance)}</span></p>
      <Field label="Amount (₹)" required error={errors.amount?.message}>
        <input {...register('amount')} inputMode="decimal" autoFocus className={inputClass} />
      </Field>
      <Field label="Mode" required error={errors.mode?.message}>
        <select {...register('mode')} className={inputClass}>
          {PAYMENT_MODES.map((m) => <option key={m} value={m}>{PAYMENT_MODE_LABELS[m]}</option>)}
        </select>
      </Field>
      <Field label="Reference" error={errors.reference?.message} hint="UPI / card reference, optional">
        <input {...register('reference')} className={inputClass} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Receive" />
    </form>
  );
}

function SecretValue({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono">{shown ? value : '••••••'}</span>
      <button type="button" onClick={() => setShown((v) => !v)} className="text-slate-500 hover:text-slate-800" aria-label={shown ? 'Hide password' : 'Show password'}>
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </span>
  );
}

/** Engineer's repair & testing remarks; testing date is stamped when the first testing remark is saved. */
function RepairNotes({ job }: { job: JobDto }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit =
    !CLOSED_STATUSES.includes(job.status) &&
    (job.assignedEngineer?.id === user?.id || user?.role === ROLES.SUPER_ADMIN || user?.role === ROLES.BRANCH_MANAGER);
  const [editing, setEditing] = useState(false);
  const [repairRemark, setRepairRemark] = useState(job.repairRemark ?? '');
  const [testingRemark, setTestingRemark] = useState(job.testingRemark ?? '');
  const save = useMutation({
    mutationFn: () => api.put(`/jobs/${job.id}/repair-notes`, { repairRemark, testingRemark }),
    onSuccess: () => {
      toast.success('Remarks saved');
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['jobs', job.id] });
    },
    onError: (err) => toast.error(err.message),
  });
  if (!job.assignedEngineer && !job.repairRemark && !job.testingRemark) return null;
  return (
    <Card
      title="Repair & testing remarks"
      actions={canEdit && !editing && <Button variant="link" onClick={() => setEditing(true)}>{job.repairRemark || job.testingRemark ? 'Edit' : 'Add remarks'}</Button>}
    >
      {editing ? (
        <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="space-y-4">
          <Field label="Repair remark">
            <textarea value={repairRemark} onChange={(e) => setRepairRemark(e.target.value)} rows={2} maxLength={1000} className={inputClass} placeholder="What was repaired / replaced" />
          </Field>
          <Field label="Testing remark">
            <textarea value={testingRemark} onChange={(e) => setTestingRemark(e.target.value)} rows={2} maxLength={1000} className={inputClass} placeholder="e.g. Display, touch, charging, network OK" />
          </Field>
          <FormActions onCancel={() => setEditing(false)} loading={save.isPending} />
        </form>
      ) : (
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Row label="Repair remark">{job.repairRemark}</Row>
          <Row label="Repaired on">{job.repairedAt && formatDateTime(job.repairedAt)}</Row>
          <Row label="Testing remark">{job.testingRemark}</Row>
          <Row label="Testing date">{job.testingAt && formatDateTime(job.testingAt)}</Row>
        </dl>
      )}
    </Card>
  );
}

function StatusTimeline({ job }: { job: JobDto }) {
  if (!job.statusHistory.length) return null;
  return (
    <Card title="Status history" className="h-fit">
      <ol className="relative space-y-3 border-l border-slate-200 pl-5">
        {job.statusHistory.map((h) => (
          <li key={h.id} className="relative">
            <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-slate-400 ring-4 ring-white" />
            <div className="text-sm font-medium">
              {h.from ? `${JOB_STATUS_LABELS[h.from]} → ` : ''}
              {JOB_STATUS_LABELS[h.to]}
            </div>
            {h.remark && <div className="text-sm text-slate-600">“{h.remark}”</div>}
            <div className="text-xs text-slate-500">
              {h.by ?? 'System'}
              {h.engineer && h.engineer !== h.by && ` · engineer ${h.engineer}`} · {formatDateTime(h.at)}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

const END_REASON_LABELS: Record<string, string> = {
  REASSIGNED: 'Reassigned',
  TRANSFERRED: 'Transferred',
  UNASSIGNED: 'Taken back',
  SENT_TO_L4: 'Sent to L4',
  CLOSED: 'Job closed',
};

function Assignments({ job }: { job: JobDto }) {
  if (!job.assignments.length) return null;
  return (
    <Card title="Engineer assignments" className="h-fit">
      <ol className="space-y-2 text-sm">
        {job.assignments.map((a) => (
          <li key={a.id} className="rounded-md border border-slate-200 px-3 py-2">
            <div className="flex justify-between gap-2">
              <span className="font-medium">{a.engineer.name}</span>
              <span className={`text-xs ${a.endedAt ? 'text-slate-500' : 'font-medium text-emerald-700'}`}>
                {a.endedAt ? (END_REASON_LABELS[a.endReason ?? ''] ?? a.endReason) : 'Current'}
              </span>
            </div>
            <div className="text-xs text-slate-500">
              {formatDateTime(a.assignedAt)}
              {a.endedAt && ` → ${formatDateTime(a.endedAt)}`}
              {a.assignedBy && ` · by ${a.assignedBy}`}
            </div>
            {a.note && <div className="text-xs text-slate-600">“{a.note}”</div>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function DeviceForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm<JobDeviceUpdateInput, unknown, JobDeviceUpdateData>({
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
      <ImeiWarning imei={watch('imei')} excludeJobId={job.id} />
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
  const [removing, setRemoving] = useState<JobPhotoDto | null>(null);
  const canRemove = canUpload && job.status !== 'DELIVERED' && (!user?.branch || user.branch.id === job.branch.id);
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
                    <div key={p.id} className="relative">
                      <button type="button" onClick={() => setViewing(p)} className="overflow-hidden rounded-md ring-1 ring-slate-200">
                        <AuthImage src={src(p)} alt={PHOTO_KIND_LABELS[kind]} className="size-24 object-cover" />
                      </button>
                      {canRemove && kind !== 'RWR' && (
                        <button
                          type="button"
                          onClick={() => setRemoving(p)}
                          aria-label="Remove photo"
                          title="Remove wrong photo"
                          className="absolute top-1 right-1 rounded-full bg-white/90 px-1.5 text-xs shadow hover:bg-red-50"
                        >
                          🗑
                        </button>
                      )}
                    </div>
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
      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Remove photo" size="sm">
        {removing && <RemovePhotoForm jobId={job.id} photo={removing} onDone={() => setRemoving(null)} />}
      </Modal>
      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding ? `Add photos — ${PHOTO_KIND_LABELS[adding]}` : ''}>
        {adding && <AddPhotos jobId={job.id} kind={adding} onDone={() => setAdding(null)} />}
      </Modal>
    </Card>
  );
}

function RemovePhotoForm({ jobId, photo, onDone }: { jobId: string; photo: JobPhotoDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const remove = useMutation({
    mutationFn: () => api.delete(`/jobs/${jobId}/photos/${photo.id}`, { body: { reason } }),
    onSuccess: () => {
      toast.success('Photo removed');
      void queryClient.invalidateQueries({ queryKey: ['jobs', jobId] });
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <form onSubmit={(e) => (e.preventDefault(), remove.mutate())} className="space-y-4">
      <AuthImage src={`/jobs/${jobId}/photos/${photo.id}`} alt="" className="mx-auto h-32 rounded" />
      <Field label="Reason" required>
        <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus className={inputClass} placeholder="e.g. Wrong customer's Aadhaar" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="danger" disabled={reason.trim().length < 3} loading={remove.isPending}>Remove photo</Button>
      </div>
    </form>
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
    case 'job.edited': {
      const fields = Object.keys((meta.changes ?? {}) as object).map((f) => f.replace('customer.', 'customer ').replace(/([A-Z])/g, ' $1').toLowerCase());
      return `Job sheet edited: ${fields.join(', ')}`;
    }
    case 'job.photo_deleted':
      return `Photo removed (${PHOTO_KIND_LABELS[meta.kind as PhotoKind] ?? meta.kind}) — “${meta.reason ?? ''}”`;
    case 'job.unassigned':
      return `Taken back from engineer${meta.note ? ` — “${meta.note}”` : ''}`;
    case 'job.cancelled':
      return `Job cancelled — “${meta.reason ?? ''}”${Number(meta.refund) > 0 ? `, refunded ${formatCurrency(Number(meta.refund))}` : ''}`;
    case 'job.repair_notes':
      return `Remarks updated${meta.repairRemark ? ` — repair: “${meta.repairRemark}”` : ''}${meta.testingRemark ? ` — testing: “${meta.testingRemark}”` : ''}`;
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
