import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  JOB_PENDING_WITH,
  type JobStatus,
  ENGINEER_VISIBLE_PHOTO_KINDS,
  jobDeviceUpdateSchema,
  PAYMENT_MODE_LABELS,
  type JobDeviceUpdateData,
  type JobDeviceUpdateInput,
  PHOTO_KIND_LABELS,
  PHOTO_KINDS,
  ROLES,
  type EngineerWorkloadDto,
  type JobDto,
  type JobHistoryEntryDto,
  type JobPhotoDto,
  type PhotoKind,
} from '@msm/shared';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { FormActions } from '@/components/ui/FormActions';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/auth-context';
import { api, ApiError } from '@/lib/api-client';
import { Banknote, IndianRupee } from 'lucide-react';
import { handleFormError } from '@/lib/form-errors';
import { formatCurrency, formatDateTime, formatJobNumber } from '@/lib/format';
import { AssignEngineerDialog } from './AssignEngineerDialog';
import { AuthImage } from './AuthImage';
import { uploadJobPhotos, useJob, useJobHistory } from './api';
import { JobStatusBadge } from './JobStatusBadge';
import { PhotoPicker } from './PhotoPicker';
import { StockPartsCard } from './StockPartsCard';
import { DeliverJobDialog } from './DeliverJobDialog';
import { Combobox } from '@/components/ui/Combobox';
import { JobCallsCard } from '@/features/calling/JobCallsCard';
import { WorkPanel } from './WorkPanel';
import { EditJobForm } from './EditJobForm';
import { ImeiWarning } from './ImeiWarning';
import { ImeiInput } from './ImeiInput';
import { L4Panel, MovementsCard } from '@/features/l4/L4Actions';
import { WhatsAppButton } from '@/features/messages/WhatsAppButton';
import { DeadlinePicker } from './DeadlinePicker';

export function JobDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') as DetailTab | null;
  const setTab = (next: DetailTab) => setSearchParams({ tab: next }, { replace: true });
  const { data: job, isLoading, error } = useJob(id);
  const [delivering, setDelivering] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [timerEditing, setTimerEditing] = useState(false);
  const [timerValue, setTimerValue] = useState<string | null>(null);
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
  const saveTimer = useMutation({
    mutationFn: () => api.patch<{ dueAt: string | null }>(`/jobs/${id}/deadline`, { dueAt: timerValue }),
    onSuccess: () => {
      toast.success(timerValue ? 'Job timer updated' : 'Job timer removed');
      setTimerEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
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
  const canManage = isManager || user?.role === ROLES.CCO;
  const readOnlyViewer = user?.role === ROLES.STOREKEEPER || user?.role === ROLES.ACCOUNTS
    || (user?.role === ROLES.ENGINEER && job.assignedEngineer?.id !== user.id);
  const closed = CLOSED_STATUSES.includes(job.status);
  const sameBranch = !user?.branch || user.branch.id === job.currentBranch.id;
  const canAssign =
    canManage &&
    (isManager ? ADMIN_REASSIGNABLE_STATUSES : ASSIGNABLE_STATUSES).includes(job.status) &&
    job.location === 'AT_BRANCH' &&
    sameBranch;

  const isEngineer = user?.role === ROLES.ENGINEER;
  const device = job.devices.length > 1
    ? `${job.devices.length} items`
    : job.accessoryName ?? (`${job.brand?.name ?? job.devices[0]?.manualBrand ?? ''} ${job.model?.name ?? job.devices[0]?.manualModel ?? ''}`.trim() || '—');
  const problem = [
    ...job.devices.flatMap((d) => [...d.faults.map((f) => f.name), ...(d.manualFault ? [d.manualFault] : [])]),
    ...(job.devices.length ? [] : [...job.faults.map((f) => f.name), ...(job.manualFault ? [job.manualFault] : [])]),
  ].join(', ') || job.customerComplaint || '—';
  const amount = job.approvedAmount ?? job.quotedAmount ?? job.estimatedAmount;

  // Overview is hidden for now (its content stays below); engineers only get repair work and photos.
  const tabs: { key: DetailTab; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Overview', show: false },
    { key: 'work', label: 'Repair work', show: !readOnlyViewer },
    { key: 'payments', label: 'Amount & payments', show: !isEngineer },
    { key: 'photos', label: 'Photos', show: true },
    { key: 'history', label: 'Calls & history', show: !isEngineer },
    { key: 'l4', label: 'L4 / main office', show: !readOnlyViewer && !isEngineer },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const activeTab: DetailTab = visibleTabs.find((t) => t.key === tab)?.key ?? visibleTabs[0]?.key ?? 'photos';
  const atHome = job.location === 'AT_BRANCH' && job.currentBranch.id === job.branch.id;
  const ownBranch = !user?.branch || user.branch.id === job.branch.id;
  const canDeliver = atHome && ownBranch && (
    (job.status === 'READY_FOR_DELIVERY' && (user?.role === ROLES.CCO || user?.role === ROLES.BRANCH_MANAGER))
    || (job.status === 'RWR' && user?.role === ROLES.CCO));
  const canRepeat = user?.role === ROLES.CCO && ownBranch;

  return (
    <div className="space-y-4">
      {job.status === 'CANCELLED' && (
        <div className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
          <span className="font-medium">Cancelled</span>
          {job.cancelledAt && ` on ${formatDateTime(job.cancelledAt)}`}
          {job.cancelReason && ` — “${job.cancelReason}”`}
        </div>
      )}
      {job.dueAt && (
        <div className={`rounded-lg px-4 py-3 text-sm font-semibold ring-1 ${new Date(job.dueAt).getTime() <= Date.now() ? 'bg-red-50 text-red-800 ring-red-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}>
          Completion timer: {formatDateTime(job.dueAt)}{new Date(job.dueAt).getTime() <= Date.now() ? ' · overdue' : ''}
        </div>
      )}

      <section className="theme-panel rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
        <Link to="/jobs" className="text-sm text-slate-500 hover:underline">
          ← {isEngineer ? 'My jobs' : 'Job sheets'}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{formatJobNumber(job.jobNumber)}</h1>
          <JobStatusBadge status={job.status} />
          <span className="text-xs text-slate-500">Pending with: <span className="font-medium text-slate-700">{JOB_PENDING_WITH[job.status]}</span></span>
          {canDeliver && (
            <Button size="sm" className="bg-emerald-600! hover:bg-emerald-700!" onClick={() => setDelivering(true)}>Deliver</Button>
          )}
        </div>
        {job.loaner && (
          <p className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${job.loaner.returnedAt ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}>
            Loaner phone: {job.loaner.brand} {job.loaner.model} · {job.loaner.returnedAt ? `returned ${formatDateTime(job.loaner.returnedAt)}` : 'with customer — not returned'}
          </p>
        )}
        {(job.repeatOf || job.repeats.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {job.repeatOf && (
              <Link to={`/jobs/${job.repeatOf.id}`} className="rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-800 ring-1 ring-violet-200 hover:underline">
                ↻ Repeat repair of {formatJobNumber(job.repeatOf.jobNumber)}
              </Link>
            )}
            {job.repeats.map((r) => (
              <Link key={r.id} to={`/jobs/${r.id}`} className="rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-800 ring-1 ring-violet-200 hover:underline">
                ↻ Repeated as {formatJobNumber(r.jobNumber)} · {JOB_STATUS_LABELS[r.status]}
              </Link>
            ))}
          </div>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Row label="Customer"><span className="font-medium">{job.customer.name}</span></Row>
          <Row label="Mobile"><a href={`tel:${job.customer.phone}`} className="font-medium text-brand-600 hover:underline">{job.customer.phone}</a></Row>
          <Row label="Device"><span className="font-medium">{device}</span></Row>
          <Row label="Problem"><span className="line-clamp-2" title={problem}>{problem}</span></Row>
          <Row label="Engineer">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{job.assignedEngineer?.name ?? <span className="text-amber-700">Not assigned</span>}</span>
              {canAssign && (
                <Button size="sm" variant={job.assignedEngineer ? 'secondary' : 'primary'} onClick={() => setAssigning(true)}>
                  {job.assignedEngineer ? 'Reassign' : 'Assign'}
                </Button>
              )}
            </span>
            {job.assignedAt && <span className="block text-xs text-slate-500">since {formatDateTime(job.assignedAt)}</span>}
          </Row>
          <Row label={job.approvedAmount !== null ? 'Approved amount' : 'Estimate'}>{amount !== null ? <span className="font-medium">{formatCurrency(amount)}</span> : 'To be decided'}</Row>
          <Row label="Received">{formatDateTime(job.createdAt)}</Row>
          <Row label="Branch">{job.branch.name}{job.currentBranch.id !== job.branch.id ? ` · now at ${job.currentBranch.name}` : ''}</Row>
          <Row label="Inward by">{job.inwardBy?.name ?? job.createdBy.name}</Row>
          {job.imei && <Row label="IMEI"><span className="font-mono">{job.imei}</span></Row>}
          {job.warranty && <Row label="Warranty">{WARRANTY_LABELS[job.warranty]}</Row>}
          {!isEngineer && <Row label="Balance">{job.balance ? <span className={job.balance > 0 ? 'font-medium text-amber-700' : ''}>{formatCurrency(Math.abs(job.balance))}{job.balance < 0 ? ' refund' : ''}</span> : '—'}</Row>}
        </dl>
        {canManage && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <Link to={`/jobs/${job.id}/print`}>
              <Button size="sm" variant="secondary">🖨 Print job sheet</Button>
            </Link>
            {job.invoice && user?.role !== ROLES.SUPER_ADMIN && (
              <Link to={`/jobs/${job.id}/invoice`}>
                <Button size="sm" variant="secondary">🧾 Invoice {job.invoice.invoiceNumber}</Button>
              </Link>
            )}
            {canRepeat && (
              <Button size="sm" variant="secondary" onClick={() => setRepeating(true)}>↻ Repeat repair</Button>
            )}
            {!closed && (!user?.branch || user.branch.id === job.branch.id) && (
              <>
                <Button size="sm" variant="secondary" onClick={() => { setTimerValue(job.dueAt); setTimerEditing(true); }}>
                  ⏱ {job.dueAt ? 'Edit timer' : 'Add timer'}
                </Button>
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
                device: job.accessoryName ?? `${job.brand?.name ?? ''} ${job.model?.name ?? ''}`.trim(),
                branchName: job.branch.name,
                branchPhone: job.branch.phone,
                estimate: job.quotedAmount ?? job.estimatedAmount,
                balance: (job.quotedAmount ?? 0) - job.payments.reduce((s, p) => s + (p.kind === 'REFUND' ? -p.amount : p.amount), 0),
              }}
            />
          </div>
        )}
      </section>

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit job sheet ${job.jobNumber}`} size="lg">
        {editing && <EditJobForm job={job} onDone={() => setEditing(false)} />}
      </Modal>
      <Modal open={timerEditing} onClose={() => setTimerEditing(false)} title={`Job timer · ${job.jobNumber}`}>
        {timerEditing && <div className="space-y-4">
          <DeadlinePicker value={timerValue} onChange={setTimerValue} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTimerEditing(false)}>Cancel</Button>
            <Button loading={saveTimer.isPending} onClick={() => saveTimer.mutate()}>Save timer</Button>
          </div>
        </div>}
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
      <DeliverJobDialog jobId={delivering ? job.id : null} onClose={() => setDelivering(false)} />
      <Modal open={repeating} onClose={() => setRepeating(false)} title={`Repeat repair · ${formatJobNumber(job.jobNumber)}`} size="sm">
        {repeating && <RepeatRepairForm job={job} onDone={() => setRepeating(false)} />}
      </Modal>
      <AssignEngineerDialog
        job={
          assigning
            ? { id: job.id, jobNumber: job.jobNumber, branchId: job.currentBranch.id, assignedEngineerId: job.assignedEngineer?.id ?? null }
            : null
        }
        onClose={() => setAssigning(false)}
      />

      <div className="sticky top-0 z-20 -mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Job sheet sections">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ${activeTab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {t.label}
              {t.key === 'work' && ACTION_STATUSES.includes(job.status) && <span className="ml-1.5 inline-block size-2 rounded-full bg-orange-500 align-middle" aria-label="Action needed" />}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {activeTab === 'overview' && (
          <>
            {!readOnlyViewer && ACTION_STATUSES.includes(job.status) && (
              <button type="button" onClick={() => setTab('work')} className="flex w-full items-center justify-between rounded-lg bg-orange-50 px-4 py-3 text-left text-sm ring-1 ring-orange-200 hover:bg-orange-100">
                <span><span className="font-semibold text-orange-950">Action needed:</span> <span className="text-orange-900">{JOB_PENDING_WITH[job.status]}</span></span>
                <span className="font-medium text-orange-800">Open repair work →</span>
              </button>
            )}
            <JobInfo job={job} readOnly={readOnlyViewer} />
          </>
        )}
        {activeTab === 'work' && (
          <>
            <StockPartsCard job={job} />
            <WorkPanel job={job} />
          </>
        )}
        {activeTab === 'payments' && <Estimate job={job} readOnly={readOnlyViewer} />}
        {activeTab === 'photos' && <Photos job={job} />}
        {activeTab === 'history' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {!readOnlyViewer && <div className="lg:col-span-2"><JobCallsCard job={job} /></div>}
            {!isEngineer && (
              <>
                <div className="space-y-5">
                  <StatusTimeline job={job} />
                  <Assignments job={job} />
                </div>
                <History jobId={job.id} />
              </>
            )}
          </div>
        )}
        {activeTab === 'l4' && (
          <>
            <L4Panel job={job} />
            <MovementsCard job={job} />
            {!job.movements.length && <p className="rounded-lg bg-white p-5 text-sm text-slate-500 ring-1 ring-slate-200">No L4 movements for this job.</p>}
          </>
        )}
      </div>
    </div>
  );
}

type DetailTab = 'overview' | 'work' | 'payments' | 'photos' | 'history' | 'l4';
/** Statuses where someone must act in the Repair work tab. */
const ACTION_STATUSES: readonly JobStatus[] = ['ASSIGNED', 'AWAITING_APPROVAL', 'CUSTOMER_REJECTED', 'IN_REPAIR', 'REPAIRED', 'TESTING', 'READY_FOR_DELIVERY', 'RWR_PENDING', 'RWR'];

/** CCO starts the job again as a new linked job sheet that goes straight to the engineer's diagnosis. */
function RepeatRepairForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const previousEngineer = job.assignedEngineer ?? job.assignments.at(-1)?.engineer ?? null;
  const [engineerId, setEngineerId] = useState(previousEngineer?.id ?? '');
  const [changing, setChanging] = useState(!previousEngineer);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const engineers = useQuery({
    queryKey: ['engineers', job.branch.id],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers?branchId=${job.branch.id}`),
  });
  const save = useMutation({
    mutationFn: () => api.post<{ id: string; jobNumber: string }>(`/jobs/${job.id}/repeat`, { engineerId: changing ? engineerId || null : null, note: note.trim() || null }),
    onSuccess: (created) => {
      toast.success(`Repeat job sheet ${formatJobNumber(created.jobNumber)} created — sent for diagnosis`, {
        duration: 10000,
        action: { label: '🖨 Print job sheet', onClick: () => navigate(`/jobs/${created.id}/print`) },
      });
      void queryClient.invalidateQueries();
      onDone();
      navigate(`/jobs/${created.id}`);
    },
    onError: (err) => setError(err.message),
  });
  return (
    <form onSubmit={(e) => (e.preventDefault(), engineerId || previousEngineer ? save.mutate() : setError('Select an engineer'))} className="space-y-4">
      <p className="text-sm text-slate-600">
        A new job sheet is created for the same customer and device, linked to {formatJobNumber(job.jobNumber)}. It goes straight to the engineer for diagnosis.
      </p>
      {!changing && previousEngineer ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <span>Assigned automatically to the same engineer: <strong>{previousEngineer.name}</strong></span>
          <button type="button" onClick={() => setChanging(true)} className="text-xs font-medium text-brand-700 hover:underline">Change</button>
        </div>
      ) : (
        <Field label="Engineer" required={!previousEngineer} hint={previousEngineer ? `Leave as is to keep ${previousEngineer.name}` : undefined}>
          <Combobox
            value={engineerId}
            onChange={setEngineerId}
            placeholder="Select engineer"
            emptyText="No active engineers in this branch"
            options={(engineers.data ?? []).map((e) => ({ value: e.id, label: e.name, hint: `${e.openJobs} open` }))}
          />
        </Field>
      )}
      <Field label="What is the problem now?" hint="Optional">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputClass} placeholder="e.g. Same display issue came back after 5 days" />
      </Field>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Start repeat repair" />
    </form>
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

function JobInfo({ job, readOnly = false }: { job: JobDto; readOnly?: boolean }) {
  const accessories = [...job.accessories, ...(job.accessoriesOther ? [job.accessoriesOther] : [])];
  const [editingDevice, setEditingDevice] = useState(false);
  return (
    <>
      <Card
        title="Customer & device"
        actions={
          !readOnly && !CLOSED_STATUSES.includes(job.status) && (
            <Button variant="link" onClick={() => setEditingDevice(true)}>
              {job.jobType === 'MOBILE' ? (job.imei || job.imei2 ? 'Edit IMEIs' : 'Add IMEIs') : (job.serialNumber ? 'Edit serial' : 'Add serial')}
            </Button>
          )
        }
      >
        {job.jobType === 'ACCESSORY' && !job.serialNumber && job.status !== 'DELIVERED' && (
          <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The serial number must be recorded before delivery.
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
          <Row label="Received as">{job.customerType === 'RETAILER' ? 'Retailer job' : 'Customer job'}</Row>
          <Row label="Retailer">{job.retailer}</Row>
          {job.devices.length <= 1 && <>
            <Row label="Device">
              {job.accessoryName ?? `${job.brand?.name ?? ''} ${job.model?.name ?? ''}`.trim()}
            </Row>
            <Row label="IMEI 1">{job.imei && <span className="font-mono">{job.imei}</span>}</Row>
            <Row label="IMEI 2">{job.imei2 && <span className="font-mono">{job.imei2}</span>}</Row>
            <Row label="Serial no.">{job.serialNumber && <span className="font-mono">{job.serialNumber}</span>}</Row>
            <Row label="Colour">{job.color}</Row>
          </>}
          <Row label="Warranty">{job.warranty && WARRANTY_LABELS[job.warranty]}</Row>
          <Row label="Phone damaged">{job.phoneDamaged ? <span className="font-medium text-amber-700">Yes</span> : 'No'}</Row>
        </dl>
        {job.devices.length > 1 && (
          <div className="mt-5">
            <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Items on this job sheet</div>
            <div className="grid gap-3 lg:grid-cols-2">
              {job.devices.map((device, index) => {
                const name = device.accessoryName ?? (device.manualBrand || device.manualModel
                  ? `${device.manualBrand ?? ''} ${device.manualModel ?? ''}`.trim()
                  : `${device.brand?.name ?? ''} ${device.model?.name ?? ''}`.trim());
                const received = [...device.accessories, ...(device.accessoriesOther ? [device.accessoriesOther] : [])];
                const problems = [...device.faults.map((fault) => fault.name), ...(device.manualFault ? [device.manualFault] : [])];
                return (
                  <div key={device.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm">
                    <div className="font-semibold text-slate-900">{index + 1}. {name || 'Unnamed item'}</div>
                    <div className="mt-1 text-xs text-slate-600">{device.jobType === 'MOBILE' ? 'Mobile / tablet' : 'Accessory'}{device.color ? ` · ${device.color}` : ''}</div>
                    {(device.imei || device.imei2 || device.serialNumber) && <div className="mt-1 font-mono text-xs text-slate-600">{[device.imei, device.imei2, device.serialNumber].filter(Boolean).join(' · ')}</div>}
                    <div className="mt-2"><span className="font-medium">Problem:</span> {problems.join(', ') || device.customerComplaint || '—'}</div>
                    <div className="mt-1"><span className="font-medium">Received:</span> {received.join(', ') || 'No accessories'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <Modal open={editingDevice} onClose={() => setEditingDevice(false)} title="IMEI / serial number" size="sm">
          {editingDevice && <DeviceForm job={job} onDone={() => setEditingDevice(false)} />}
        </Modal>
      </Card>
      <Card title="Problem & intake">
        <dl className="space-y-4">
          {job.devices.length <= 1 && <Row label="Faults reported">
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {job.faults.map((f) => (
                <li key={f.id} className="flex justify-between gap-3 px-3 py-1.5">
                  <span>{f.name}</span>
                  <span className="text-slate-600">
                    {f.price !== null ? `${f.priceLabel} — ${formatCurrency(f.price)}` : <span className="text-slate-400">To be decided</span>}
                  </span>
                </li>
              ))}
              {job.manualFault && (
                <li key="manual" className="flex justify-between gap-3 px-3 py-1.5">
                  <span>{job.manualFault}</span>
                  <span className="text-slate-400">Manual / To be decided</span>
                </li>
              )}
            </ul>
          </Row>}
          {job.devices.length <= 1 && <>
            <Row label="Customer complaint">{job.customerComplaint}</Row>
            <Row label="Extra added (items received)">{accessories.length ? accessories.join(', ') : 'None'}</Row>
            <Row label="Physical condition / remark">{job.conditionNotes}</Row>
          </>}
          {job.devices.length > 1 && <Row label="Combined intake">See each item above for its problem, identifiers, and received accessories.</Row>}
          <Row label="Inward by">{job.inwardBy?.name}</Row>
        </dl>
      </Card>
    </>
  );
}

function Estimate({ job, readOnly = false }: { job: JobDto; readOnly?: boolean }) {
  const { user } = useAuth();
  const [receiving, setReceiving] = useState(false);
  const [editingAmounts, setEditingAmounts] = useState(false);
  const canReceive =
    !readOnly && user?.role !== ROLES.ENGINEER && !CLOSED_STATUSES.includes(job.status) && job.balance > 0 && (!user?.branch || user.branch.id === job.branch.id);
  // CCO / manager may change the total and the advance at any stage until the phone is delivered.
  const canEditAmounts =
    !readOnly && (user?.role === ROLES.CCO || user?.role === ROLES.BRANCH_MANAGER) && !CLOSED_STATUSES.includes(job.status) && job.status !== 'RWR' &&
    !job.invoice && (!user?.branch || user.branch.id === job.branch.id);
  return (
    <Card
      title="Amount & payments"
      actions={(canReceive || canEditAmounts) && (
        <div className="flex gap-2">
          {canEditAmounts && <Button size="sm" variant="secondary" onClick={() => setEditingAmounts(true)}>Edit amounts</Button>}
          {canReceive && <Button size="sm" onClick={() => setReceiving(true)}>Receive payment</Button>}
        </div>
      )}
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
      <Modal open={editingAmounts} onClose={() => setEditingAmounts(false)} title="Total & advance amount" size="sm">
        {editingAmounts && <AmountsForm job={job} onDone={() => setEditingAmounts(false)} />}
      </Modal>
    </Card>
  );
}

function AmountsForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const hasTotal = job.totalAmount > 0 || job.estimatedAmount !== null || job.quotedAmount !== null;
  const [total, setTotal] = useState(hasTotal ? String(job.totalAmount) : '');
  const [advance, setAdvance] = useState(String(job.paidAmount));
  const [mode, setMode] = useState<(typeof PAYMENT_MODES)[number]>('CASH');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const advanceDelta = (Number(advance) || 0) - job.paidAmount;
  const save = useMutation({
    mutationFn: () => api.put(`/jobs/${job.id}/amounts`, {
      totalAmount: total.trim() === '' ? null : Number(total),
      advance: Number(advance) || 0,
      mode,
      reference: reference.trim() || null,
    }),
    onSuccess: () => {
      toast.success('Amounts updated');
      void queryClient.invalidateQueries({ queryKey: ['jobs', job.id] });
      onDone();
    },
    onError: (err) => {
      const d = err instanceof ApiError ? (err.details as Record<string, string[]> | undefined) : undefined;
      if (d) setErrors(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v?.[0]])));
      else toast.error(err.message);
    },
  });
  return (
    <form onSubmit={(e) => (e.preventDefault(), setErrors({}), save.mutate())} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Total Amount" error={errors.totalAmount} hint={job.diagnosedAt ? 'Parts stay; repair charge is adjusted' : 'Estimate before diagnosis'}>
          <div className="relative">
            <IndianRupee className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" autoFocus className={`${inputClass} py-2.5! pl-9!`} placeholder="Amount" />
          </div>
        </Field>
        <Field label="Advance Amount" error={errors.advance} hint="Total received so far">
          <div className="relative">
            <Banknote className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={advance} onChange={(e) => setAdvance(e.target.value)} inputMode="decimal" className={`${inputClass} py-2.5! pl-9!`} placeholder="Advance" />
          </div>
        </Field>
      </div>
      {advanceDelta !== 0 && Number.isFinite(advanceDelta) && (
        <div className="space-y-3 rounded-md bg-slate-50 p-3 text-sm">
          <p className={advanceDelta > 0 ? 'text-emerald-800' : 'text-orange-800'}>
            {advanceDelta > 0 ? `${formatCurrency(advanceDelta)} more advance will be recorded as received.` : `${formatCurrency(-advanceDelta)} will be recorded as refunded to the customer.`}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={advanceDelta > 0 ? 'Received by' : 'Refunded by'}>
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className={inputClass}>
                {PAYMENT_MODES.map((m) => <option key={m} value={m}>{PAYMENT_MODE_LABELS[m]}</option>)}
              </select>
            </Field>
            {mode !== 'CASH' && (
              <Field label="Reference">
                <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} className={inputClass} />
              </Field>
            )}
          </div>
        </div>
      )}
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Save amounts" />
    </form>
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
    defaultValues: { imei: job.imei ?? '', imei2: job.imei2 ?? '', serialNumber: job.serialNumber ?? '' },
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
      {job.jobType === 'MOBILE' ? <>
        <Field label="IMEI 1" error={errors.imei?.message} hint="15 digits — dial *#06#">
          <ImeiInput {...register('imei')} autoFocus />
        </Field>
        <ImeiWarning imei={watch('imei')} excludeJobId={job.id} />
        <Field label="IMEI 2" error={errors.imei2?.message} hint="15 digits — dial *#06#">
          <ImeiInput {...register('imei2')} />
        </Field>
        <ImeiWarning imei={watch('imei2')} excludeJobId={job.id} />
      </> : (
        <Field label="Serial number" error={errors.serialNumber?.message}>
          <input {...register('serialNumber')} autoFocus className={`${inputClass} font-mono uppercase`} />
        </Field>
      )}
      <FormActions onCancel={onDone} loading={save.isPending} />
    </form>
  );
}

function Photos({ job }: { job: JobDto }) {
  const { user } = useAuth();
  const canManage = user?.role === ROLES.CCO || user?.role === ROLES.BRANCH_MANAGER;
  // Photos can be added at every status; engineers add phone / condition photos.
  const canUpload = canManage || user?.role === ROLES.ENGINEER;
  // Engineers only get device photos from the API, so don't show empty customer/ID sections.
  const kinds = user?.role === ROLES.ENGINEER ? ENGINEER_VISIBLE_PHOTO_KINDS : PHOTO_KINDS;
  const [viewing, setViewing] = useState<JobPhotoDto | null>(null);
  const [removing, setRemoving] = useState<JobPhotoDto | null>(null);
  const canRemove = canManage && job.status !== 'DELIVERED' && (!user?.branch || user.branch.id === job.branch.id);
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
      <PhotoPicker label={PHOTO_KIND_LABELS[kind]} files={files} onChange={setFiles} multiple />
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
      return `Customer approved ${formatCurrency(Number(meta.amount ?? 0))}${meta.note ? ` — “${meta.note}”` : ''}${meta.model ? ` · Model: ${meta.model}` : ''}${meta.problem ? ` · Problem: ${meta.problem}` : ''}${meta.engineer ? ` · Engineer: ${meta.engineer}` : ''}${meta.cco ? ` · CCO: ${meta.cco}` : ''}`;
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
    case 'job.part_used':
      return `Part used from stock: ${meta.code} ${meta.name}${Number(meta.quantity) > 1 ? ` × ${meta.quantity}` : ''}`;
    case 'job.costing_updated':
      return `Costing updated — total ${formatCurrency(Number(meta.total ?? 0))}`;
    case 'job.repeat_started':
      return `Repeat repair started as ${meta.jobNumber}${meta.note ? ` — “${meta.note}”` : ''}`;
    case 'job.rwr_requested':
      return `RWR requested — “${meta.note ?? ''}”`;
    case 'job.rwr_finalized':
      return 'RWR approved by Branch Manager — back with CCO';
    case 'job.dead_risk_approved':
      return `Dead-device risk accepted by customer${meta.note ? ` — “${meta.note}”` : ''}`;
    case 'job.approved_estimate_changed':
      return `Approved amount changed ${formatCurrency(Number(meta.from ?? 0))} → ${formatCurrency(Number(meta.to ?? 0))}`;
    case 'job.part_cancelled':
      return `Part request cancelled: ${meta.code} ${meta.name}`;
    case 'job.delivered':
      return `Delivered to ${meta.deliveredTo} — ${meta.invoiceNumber ? `invoice ${meta.invoiceNumber}, total ${formatCurrency(Number(meta.total ?? 0))}` : 'no invoice (RWR)'}${Number(meta.refund) > 0 ? `, refunded ${formatCurrency(Number(meta.refund))}` : ''}`;
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
