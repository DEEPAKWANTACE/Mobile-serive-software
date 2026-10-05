import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  approvalSchema,
  diagnosisSchema,
  DIAGNOSABLE_STATUSES,
  ENGINEER_TRANSITIONS,
  ROLES,
  RWR_REASON_LABELS,
  RWR_STATUSES,
  SPARE_HOLD_STATUSES,
  TRANSFERABLE_STATUSES,
  type ApprovalData,
  type ApprovalInput,
  type DiagnosisData,
  type DiagnosisInput,
  type FaultDto,
  type JobDto,
  type JobStatus,
  type ModelPriceDto,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { FormActions } from '@/components/ui/FormActions';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/lib/api-client';
import { useOptions } from '@/lib/crud';
import { handleFormError } from '@/lib/form-errors';
import { formatCurrency, formatDateTime, timeAgo } from '@/lib/format';
import { RwrForm, SpareHoldForm, SpareReceivedForm } from './HoldAndRwrForms';
import { CancelTransferButton, TransferRequestForm, TransferResponseButtons } from './TransferActions';
import { PartCodeInput } from '@/features/inventory/PartCodeInput';
import { DeliveryForm } from '@/features/billing/DeliveryForm';
import { L4Panel } from '@/features/l4/L4Actions';
import { Link } from 'react-router';

/** Diagnosis / quote, customer approval and work-progress actions for one job. */
export function WorkPanel({ job }: { job: JobDto }) {
  const { user } = useAuth();
  const isAssignedEngineer = user?.role === ROLES.ENGINEER && job.assignedEngineer?.id === user.id;
  const canApprove = user?.role === ROLES.CCO || user?.role === ROLES.BRANCH_MANAGER || user?.role === ROLES.SUPER_ADMIN;
  const [diagnosing, setDiagnosing] = useState(false);
  const [approving, setApproving] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [transition, setTransition] = useState<{ to: JobStatus; label: string; noteRequired?: boolean } | null>(null);
  const [action, setAction] = useState<'transfer' | 'spare' | 'spareReceived' | 'rwr' | 'deliver' | null>(null);
  const atHome = job.location === 'AT_BRANCH' && job.currentBranch.id === job.branch.id;
  const canDeliver = canApprove && atHome && (job.status === 'READY_FOR_DELIVERY' || job.status === 'RWR') && (!user?.branch || user.branch.id === job.branch.id);

  const isManager = user?.role === ROLES.BRANCH_MANAGER || user?.role === ROLES.SUPER_ADMIN;
  const pending = job.pendingTransfer;
  const isTransferTarget = !!pending && pending.to.id === user?.id;
  const canCancelTransfer = !!pending && (pending.from.id === user?.id || isManager);
  const canTransfer = isAssignedEngineer && !pending && TRANSFERABLE_STATUSES.includes(job.status);
  const canHold = isAssignedEngineer && SPARE_HOLD_STATUSES.includes(job.status);
  const canRwr = isAssignedEngineer && RWR_STATUSES.includes(job.status);
  const canMarkSpareReceived = job.status === 'SPARE_PENDING' && (isAssignedEngineer || isManager);

  const agreed = job.approvedAmount ?? job.estimatedAmount;
  const canDiagnose = isAssignedEngineer && DIAGNOSABLE_STATUSES.includes(job.status);
  const transitions = isAssignedEngineer ? (ENGINEER_TRANSITIONS[job.status] ?? []) : [];

  if (job.status === 'RECEIVED' && job.location === 'AT_BRANCH' && job.currentBranch.id === job.branch.id && !job.diagnosedAt) {
    return <L4Panel job={job} />;
  }

  return (
    <Card
      title="Repair work"
      actions={
        canDiagnose && (
          <Button size="sm" variant={job.diagnosedAt ? 'secondary' : 'primary'} onClick={() => setDiagnosing(true)}>
            {job.diagnosedAt ? 'Update estimate' : 'Add diagnosis & estimate'}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <L4Panel job={job} />
        {job.status === 'DELIVERED' && (
          <div className="rounded-md bg-slate-800 p-4 text-sm text-white">
            <div className="font-medium">
              Delivered to {job.deliveredTo} {job.deliveredAt && `on ${formatDateTime(job.deliveredAt)}`}
              {job.deliveredBy && ` by ${job.deliveredBy.name}`}
            </div>
            {job.deliveryNote && <p className="mt-1 text-slate-300">{job.deliveryNote}</p>}
            {job.invoice && canApprove && (
              <Link to={`/jobs/${job.id}/invoice`} className="mt-2 inline-block font-medium text-sky-300 hover:underline">
                Invoice {job.invoice.invoiceNumber} · {formatCurrency(job.invoice.total)} — view / print
              </Link>
            )}
          </div>
        )}
        {canDeliver && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-emerald-50 p-4 ring-1 ring-emerald-200">
            <div className="text-sm text-emerald-900">
              <div className="font-medium">{job.status === 'RWR' ? 'Ready to return to customer (unrepaired)' : 'Repaired — ready for the customer'}</div>
              <a href={`tel:${job.customer.phone}`} className="underline">
                Call {job.customer.name} ({job.customer.phone})
              </a>
            </div>
            <Button onClick={() => setAction('deliver')}>Deliver & bill</Button>
          </div>
        )}
        {pending && (
          <div className="rounded-md bg-sky-50 p-4 ring-1 ring-sky-200">
            <div className="font-medium text-sky-900">
              🔁 Transfer requested: {pending.from.name} → {pending.to.name}
            </div>
            <p className="mt-1 text-sm text-sky-800">
              “{pending.reason}” · {timeAgo(pending.createdAt)} ago.{' '}
              {isTransferTarget ? 'Accept to take over this job.' : `Waiting for ${pending.to.name} to accept — the job stays with ${pending.from.name} until then.`}
            </p>
            <div className="mt-3 flex gap-2">
              {isTransferTarget && <TransferResponseButtons transferId={pending.id} />}
              {canCancelTransfer && !isTransferTarget && <CancelTransferButton transferId={pending.id} />}
            </div>
          </div>
        )}
        {job.status === 'SPARE_PENDING' && (
          <div className="rounded-md bg-yellow-50 p-4 ring-1 ring-yellow-200">
            <div className="font-medium text-yellow-900">Spare not available: {job.sparePart}</div>
            <p className="mt-1 text-sm text-yellow-800">Waiting since {job.spareRequestedAt ? formatDateTime(job.spareRequestedAt) : '—'}.</p>
            {canMarkSpareReceived && (
              <Button size="sm" className="mt-3" onClick={() => setAction('spareReceived')}>
                Spare received — resume work
              </Button>
            )}
          </div>
        )}
        {job.status === 'RWR' && (
          <div className="rounded-md bg-slate-100 p-4 text-sm">
            <div className="font-medium">Returned without repair — {job.rwrReason ? RWR_REASON_LABELS[job.rwrReason] : ''}</div>
            <p className="mt-1 whitespace-pre-line text-slate-700">{job.rwrNote}</p>
            <p className="mt-1 text-xs text-slate-500">
              {job.rwrAt && formatDateTime(job.rwrAt)} · motherboard photos are in the Photos section below.
            </p>
          </div>
        )}
        {job.status === 'AWAITING_APPROVAL' && (
          <div className="rounded-md bg-orange-50 p-4 ring-1 ring-orange-200">
            <div className="font-medium text-orange-900">Customer approval needed — {formatCurrency(job.quotedAmount ?? 0)}</div>
            <p className="mt-1 text-sm text-orange-800">
              {agreed !== null ? `Customer had agreed to ${formatCurrency(agreed)}. ` : 'No price was agreed at intake. '}
              {canApprove ? (
                <>
                  Call{' '}
                  <a href={`tel:${job.customer.phone}`} className="font-semibold underline">
                    {job.customer.name} ({job.customer.phone})
                  </a>{' '}
                  and record their answer.
                </>
              ) : (
                'Waiting for the counter to call the customer.'
              )}
            </p>
            {canApprove && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => setApproving('APPROVED')}>
                  Customer approved
                </Button>
                <Button size="sm" variant="danger" onClick={() => setApproving('REJECTED')}>
                  Customer rejected
                </Button>
              </div>
            )}
          </div>
        )}
        {job.status === 'CUSTOMER_REJECTED' && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
            Customer rejected the estimate{job.customerResponse && `: “${job.customerResponse}”`}.{' '}
            {isAssignedEngineer ? 'Return the phone using “Return without repair” (motherboard photo required).' : 'Waiting for the engineer to return the phone.'}
          </div>
        )}
        {job.status === 'ASSIGNED' && !job.diagnosedAt && (
          <p className="text-sm text-slate-500">
            {isAssignedEngineer ? 'Check the phone and add your diagnosis and estimate.' : 'Waiting for the engineer to diagnose.'}
          </p>
        )}

        {job.diagnosedAt && (
          <div>
            <div className="text-xs text-slate-500">Engineer's findings · {formatDateTime(job.diagnosedAt)}</div>
            <p className="mt-0.5 text-sm whitespace-pre-line">{job.diagnosisNotes}</p>
            <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
              {job.estimateLines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 px-3 py-1.5">
                  <span>
                    {l.part && <span className="font-mono">{l.part.code} </span>}
                    {l.part?.name ?? l.fault?.name ?? l.description}
                    {l.fault && l.description && <span className="text-slate-500"> — {l.description}</span>}
                    {l.priceLabel && <span className="text-slate-500"> ({l.priceLabel})</span>}
                  </span>
                  <span>{formatCurrency(l.amount)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 bg-slate-50 px-3 py-2 font-semibold">
                <span>Total estimate</span>
                <span>{formatCurrency(job.quotedAmount ?? 0)}</span>
              </li>
            </ul>
            {job.approvedAmount !== null && job.status !== 'AWAITING_APPROVAL' && job.status !== 'CUSTOMER_REJECTED' && (
              <p className="mt-2 text-xs text-emerald-700">
                ✓ Customer agreed to {formatCurrency(job.approvedAmount)}
                {job.approvedBy ? ` — confirmed by ${job.approvedBy.name}` : ' at intake'}
                {job.customerResponse && ` (“${job.customerResponse}”)`}
              </p>
            )}
          </div>
        )}

        {(transitions.length > 0 || canTransfer || canHold || canRwr) && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {transitions.map((t) => (
              <Button key={t.to} variant={t.noteRequired ? 'secondary' : 'primary'} onClick={() => setTransition(t)}>
                {t.label}
              </Button>
            ))}
            {canHold && (
              <Button variant="secondary" onClick={() => setAction('spare')}>
                Spare not available
              </Button>
            )}
            {canTransfer && (
              <Button variant="secondary" onClick={() => setAction('transfer')}>
                Transfer to engineer
              </Button>
            )}
            {canRwr && (
              <Button variant={job.status === 'CUSTOMER_REJECTED' ? 'primary' : 'secondary'} className={job.status === 'CUSTOMER_REJECTED' ? '' : 'text-red-700!'} onClick={() => setAction('rwr')}>
                Return without repair (RWR)
              </Button>
            )}
          </div>
        )}
      </div>

      <Modal open={diagnosing} onClose={() => setDiagnosing(false)} title="Diagnosis & estimate" size="lg">
        {diagnosing && <DiagnosisForm job={job} onDone={() => setDiagnosing(false)} />}
      </Modal>
      <Modal
        open={!!approving}
        onClose={() => setApproving(null)}
        title={approving === 'APPROVED' ? 'Customer approved the estimate' : 'Customer rejected the estimate'}
        size="sm"
      >
        {approving && <ApprovalForm job={job} decision={approving} onDone={() => setApproving(null)} />}
      </Modal>
      <Modal open={action === 'deliver'} onClose={() => setAction(null)} title={`Deliver ${job.jobNumber}`} size="lg">
        {action === 'deliver' && <DeliveryForm job={job} onDone={() => setAction(null)} />}
      </Modal>
      <Modal open={action === 'transfer'} onClose={() => setAction(null)} title="Transfer job to another engineer" size="sm">
        {action === 'transfer' && <TransferRequestForm job={job} onDone={() => setAction(null)} />}
      </Modal>
      <Modal open={action === 'spare'} onClose={() => setAction(null)} title="Spare not available" size="sm">
        {action === 'spare' && <SpareHoldForm job={job} onDone={() => setAction(null)} />}
      </Modal>
      <Modal open={action === 'spareReceived'} onClose={() => setAction(null)} title="Spare received" size="sm">
        {action === 'spareReceived' && <SpareReceivedForm job={job} onDone={() => setAction(null)} />}
      </Modal>
      <Modal open={action === 'rwr'} onClose={() => setAction(null)} title="Return without repair (RWR)">
        {action === 'rwr' && <RwrForm job={job} onDone={() => setAction(null)} />}
      </Modal>
      <Modal open={!!transition} onClose={() => setTransition(null)} title={transition?.label ?? ''} size="sm">
        {transition && <TransitionForm job={job} transition={transition} onDone={() => setTransition(null)} />}
      </Modal>
    </Card>
  );
}

// ─── Diagnosis form (engineer) ──────────────────────────────────────────────

function DiagnosisForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const faults = useOptions<FaultDto>('faults');
  const prices = useQuery({
    queryKey: ['models', job.model.id, 'prices'],
    queryFn: () => api.get<ModelPriceDto[]>(`/models/${job.model.id}/prices`),
  });
  // Native selects need their options present before the form mounts, or they show the wrong choice.
  if (!faults.data || !prices.data) return <p className="text-sm text-slate-500">Loading…</p>;
  return <DiagnosisFormInner job={job} faults={faults.items} prices={prices.data} onDone={onDone} />;
}

function DiagnosisFormInner({ job, faults, prices, onDone }: { job: JobDto; faults: FaultDto[]; prices: ModelPriceDto[]; onDone: () => void }) {
  const queryClient = useQueryClient();

  // Start from the previous estimate, else from the faults reported at intake (with their chosen price).
  const initialLines: DiagnosisInput['lines'] = job.estimateLines.length
    ? job.estimateLines.map((l) => ({ faultId: l.fault?.id ?? null, priceId: null, partId: l.part?.id ?? null, description: l.description ?? '', amount: l.amount }))
    : job.faults.map((f) => ({ faultId: f.id, priceId: null, description: f.priceLabel ?? '', amount: f.price ?? ('' as unknown as number) }));

  const { register, control, handleSubmit, watch, setValue, setError, formState: { errors } } = useForm<DiagnosisInput, unknown, DiagnosisData>({
    resolver: zodResolver(diagnosisSchema),
    defaultValues: { notes: job.diagnosisNotes ?? '', lines: initialLines },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = watch('lines');
  // Parts added by code in this session (name/price shown on the line).
  const [partInfo, setPartInfo] = useState<Record<string, { code: string; name: string; price: number }>>(() =>
    Object.fromEntries(job.estimateLines.flatMap((l) => (l.part ? [[l.part.id, { code: l.part.code, name: l.part.name, price: l.amount }]] : []))),
  );

  const optionsFor = (faultId?: string | null) => prices.filter((p) => p.faultId === faultId);
  const amountOf = (l: DiagnosisInput['lines'][number]) => {
    const option = prices.find((p) => p.id === l.priceId);
    if (option) return option.price;
    if (l.partId && partInfo[l.partId]) return partInfo[l.partId]!.price;
    return Number(l.amount) || 0;
  };
  const total = lines.reduce((sum, l) => sum + amountOf(l), 0);
  const agreed = job.approvedAmount ?? job.estimatedAmount;

  const save = useMutation({
    mutationFn: (data: DiagnosisData) =>
      api.put<{ status: JobStatus; autoApproved: boolean }>(`/jobs/${job.id}/diagnosis`, data),
    onSuccess: (r) => {
      toast.success(r.autoApproved ? 'Within the agreed amount — you can start the repair' : 'Estimate sent to the counter for customer approval');
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => handleFormError(err, setError),
  });

  return (
    <form onSubmit={handleSubmit((d) => save.mutate(d))} className="space-y-4">
      <Field label="What did you find?" required error={errors.notes?.message}>
        <textarea {...register('notes')} rows={3} autoFocus className={inputClass} placeholder="e.g. Phone dead — PMIC IC faulty, display OK" />
      </Field>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Work & charges</div>
        <div className="space-y-2">
          {fields.map((field, i) => {
            const line = lines[i];
            const opts = optionsFor(line?.faultId);
            const lineErr = errors.lines?.[i];
            const part = line?.partId ? partInfo[line.partId] : undefined;
            if (part) {
              return (
                <div key={field.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
                  <span>
                    <span className="font-mono font-semibold">{part.code}</span> · {part.name}
                  </span>
                  <span className="flex items-center gap-2">
                    {formatCurrency(part.price)}
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      aria-label="Remove line"
                      className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              );
            }
            return (
              <div key={field.id} className="rounded-md border border-slate-200 p-2">
                <div className="flex flex-wrap items-start gap-2">
                  <select
                    {...register(`lines.${i}.faultId`, {
                      setValueAs: (v: string | null) => v || null,
                      onChange: () => setValue(`lines.${i}.priceId`, null),
                    })}
                    aria-label="Fault"
                    className={`${inputClass} w-52!`}
                  >
                    <option value="">Other / custom work</option>
                    {faults.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.category ? `${f.category.name} › ` : ''}
                        {f.name}
                      </option>
                    ))}
                  </select>
                  {opts.length > 0 && (
                    <select
                      {...register(`lines.${i}.priceId`, { setValueAs: (v: string | null) => v || null })}
                      aria-label="Price option"
                      className={`${inputClass} w-48!`}
                    >
                      <option value="">Enter amount manually</option>
                      {opts.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label} — {formatCurrency(o.price)}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    {...register(`lines.${i}.description`)}
                    placeholder={line?.faultId ? 'Note (optional)' : 'Work, e.g. IC level issue'}
                    aria-label="Description"
                    className={`${inputClass} min-w-40 flex-1`}
                  />
                  {!line?.priceId && (
                    <input
                      {...register(`lines.${i}.amount`)}
                      inputMode="decimal"
                      placeholder="₹ Amount"
                      aria-label="Amount"
                      className={`${inputClass} w-28!`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label="Remove line"
                    className="rounded px-2 py-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
                {(lineErr?.description || lineErr?.amount || lineErr?.root) && (
                  <p className="mt-1 text-xs text-red-600">
                    {lineErr.description?.message ?? lineErr.amount?.message ?? lineErr.root?.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {errors.lines?.message && <p className="mt-1 text-xs text-red-600">{errors.lines.message}</p>}
        <div className="mt-2 flex flex-wrap items-start gap-4">
          <Button variant="link" className="mt-2" onClick={() => append({ faultId: null, priceId: null, partId: null, description: '', amount: '' as unknown as number })}>
            + Add item
          </Button>
          <div>
            <div className="mb-1 text-xs text-slate-500">Add a part by code — price is filled in automatically</div>
            <PartCodeInput
              branchId={job.branch.id}
              actionLabel="Add part"
              onFound={(p) => {
                setPartInfo((info) => ({ ...info, [p.id]: { code: p.code, name: p.name, price: p.sellingPrice } }));
                append({ faultId: null, priceId: null, partId: p.id, description: '', amount: null });
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md bg-slate-50 px-4 py-3">
        <div className="text-sm text-slate-600">
          Total estimate
          {agreed !== null && (
            <span className={`block text-xs ${total > agreed ? 'text-orange-700' : 'text-emerald-700'}`}>
              {total > agreed
                ? `More than the agreed ${formatCurrency(agreed)} — counter will call the customer`
                : `Within the agreed ${formatCurrency(agreed)} — no approval needed`}
            </span>
          )}
          {agreed === null && <span className="block text-xs text-orange-700">No price agreed at intake — counter will call the customer</span>}
        </div>
        <span className="text-lg font-semibold">{formatCurrency(total)}</span>
      </div>

      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Submit estimate" />
    </form>
  );
}

// ─── Approval (CCO) ─────────────────────────────────────────────────────────

function ApprovalForm({ job, decision, onDone }: { job: JobDto; decision: 'APPROVED' | 'REJECTED'; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<ApprovalInput, unknown, ApprovalData>({
    resolver: zodResolver(approvalSchema),
    defaultValues: { decision, note: '' },
  });
  const save = useMutation({
    mutationFn: (data: ApprovalData) => api.post(`/jobs/${job.id}/approval`, data),
    onSuccess: () => {
      toast.success(decision === 'APPROVED' ? 'Approved — sent to engineer for repair' : 'Marked as rejected by customer');
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => handleFormError(err, setError),
  });

  return (
    <form onSubmit={handleSubmit((d) => save.mutate(d))} className="space-y-4">
      <p className="text-sm text-slate-600">
        {job.customer.name} · estimate <span className="font-semibold">{formatCurrency(job.quotedAmount ?? 0)}</span>
      </p>
      <Field
        label={decision === 'APPROVED' ? 'Note (optional)' : "Customer's reason"}
        required={decision === 'REJECTED'}
        error={errors.note?.message}
      >
        <textarea {...register('note')} rows={2} autoFocus className={inputClass} placeholder={decision === 'REJECTED' ? 'e.g. Too costly, will buy a new phone' : 'e.g. Approved on call'} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel={decision === 'APPROVED' ? 'Confirm approval' : 'Confirm rejection'} />
    </form>
  );
}

// ─── Engineer status move ───────────────────────────────────────────────────

function TransitionForm({
  job,
  transition,
  onDone,
}: {
  job: JobDto;
  transition: { to: JobStatus; label: string; noteRequired?: boolean };
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setErr] = useState<string>();
  const save = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/status`, { status: transition.to, note: note.trim() || null }),
    onSuccess: () => {
      toast.success(transition.label);
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => setErr(err.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (transition.noteRequired && !note.trim()) return setErr('Enter a reason');
        save.mutate();
      }}
      className="space-y-4"
    >
      <Field label={transition.noteRequired ? 'Reason' : 'Note (optional)'} required={transition.noteRequired} error={error}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoFocus className={inputClass} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Confirm" />
    </form>
  );
}
