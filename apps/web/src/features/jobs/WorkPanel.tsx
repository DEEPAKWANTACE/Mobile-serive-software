import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  approvalSchema,
  deadRiskApprovalSchema,
  diagnosisSchema,
  DIAGNOSABLE_STATUSES,
  ENGINEER_TRANSITIONS,
  JOB_PENDING_WITH,
  ROLES,
  negotiatedEstimateSchema,
  RWR_REASON_LABELS,
  RWR_STATUSES,
  SPARE_HOLD_STATUSES,
  TRANSFERABLE_STATUSES,
  type ApprovalData,
  type ApprovalInput,
  type DeadRiskApprovalData,
  type DiagnosisData,
  type DiagnosisInput,
  type FaultDto,
  type JobDto,
  type JobStatus,
  type ModelPriceDto,
  type NegotiatedEstimateData,
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
import { LogCallForm } from '@/features/calling/LogCallForm';
import { WhatsAppButton } from '@/features/messages/WhatsAppButton';

/** Diagnosis / quote, customer approval and work-progress actions for one job. */
export function WorkPanel({ job }: { job: JobDto }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAssignedEngineer = user?.role === ROLES.ENGINEER && job.assignedEngineer?.id === user.id;
  const canApprove = user?.role === ROLES.CCO || user?.role === ROLES.BRANCH_MANAGER;
  const [diagnosing, setDiagnosing] = useState(false);
  const [approving, setApproving] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [approvingDeadRisk, setApprovingDeadRisk] = useState(false);
  const [negotiating, setNegotiating] = useState(false);
  const [directApproveOptionId, setDirectApproveOptionId] = useState<string | null>(null);
  const [transition, setTransition] = useState<{ to: JobStatus; label: string; noteRequired?: boolean } | null>(null);
  const [action, setAction] = useState<'transfer' | 'spare' | 'spareReceived' | 'rwr' | 'deliver' | null>(null);
  const [loggingCall, setLoggingCall] = useState(false);
  const atHome = job.location === 'AT_BRANCH' && job.currentBranch.id === job.branch.id;
  const canDeliver = atHome && (job.status === 'READY_FOR_DELIVERY' || job.status === 'RWR') &&
    user?.branch?.id === job.branch.id && (job.status === 'RWR' ? user.role === ROLES.BRANCH_MANAGER : canApprove);

  const isManager = user?.role === ROLES.BRANCH_MANAGER;
  const pending = job.pendingTransfer;
  const isTransferTarget = !!pending && pending.to.id === user?.id;
  const canCancelTransfer = !!pending && (pending.from.id === user?.id || isManager);
  const canTransfer = isAssignedEngineer && !pending && TRANSFERABLE_STATUSES.includes(job.status);
  const canHold = isAssignedEngineer && SPARE_HOLD_STATUSES.includes(job.status);
  const canRwr = (isAssignedEngineer || user?.role === ROLES.CCO) && RWR_STATUSES.includes(job.status);
  const canMarkSpareReceived = job.status === 'SPARE_PENDING' && (isAssignedEngineer || isManager);

  const messageContext = {
    customerName: job.customer.name,
    jobNumber: job.jobNumber,
    device: job.devices.map((device) => device.accessoryName ?? `${device.brand?.name ?? device.manualBrand ?? ''} ${device.model?.name ?? device.manualModel ?? ''}`.trim()).filter(Boolean).join(', '),
    branchName: job.branch.name,
    branchPhone: job.branch.phone,
    estimate: job.quotedAmount ?? job.estimatedAmount,
    balance: (job.quotedAmount ?? 0) - job.payments.reduce((s, p) => s + (p.kind === 'REFUND' ? -p.amount : p.amount), 0),
  };

  const agreed = job.approvedAmount ?? job.estimatedAmount;
  const canDiagnose = isAssignedEngineer && DIAGNOSABLE_STATUSES.includes(job.status);
  const transitions = isAssignedEngineer ? (ENGINEER_TRANSITIONS[job.status] ?? []) : [];
  const finalizeRwr = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/rwr/finalize`, {}),
    onSuccess: () => {
      toast.success('RWR finalized — ready for Branch Manager delivery');
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e.message),
  });

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
          <div className="rounded-lg bg-emerald-50 p-5 ring-1 ring-emerald-300 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-emerald-950">
                  {job.status === 'RWR' ? 'Phone ready to return to customer (unrepaired)' : 'Phone repaired — ready at counter for customer pickup'}
                </div>
                <p className="text-sm text-emerald-800 mt-0.5">
                  Notify the customer via call or WhatsApp, then collect payment and deliver.
                </p>
              </div>
              <Button size="md" onClick={() => setAction('deliver')}>Deliver & bill</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-emerald-200">
              <a href={`tel:${job.customer.phone}`}>
                <Button size="sm" variant="secondary">
                  📞 Call {job.customer.name} ({job.customer.phone})
                </Button>
              </a>
              {canApprove && (
                <Button size="sm" variant="secondary" onClick={() => setLoggingCall(true)}>
                  📝 Log customer call
                </Button>
              )}
              <WhatsAppButton
                phone={job.customer.phone}
                status={job.status}
                context={messageContext}
                size="sm"
                label="💬 Send WhatsApp pickup message"
              />
            </div>
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
        {job.status === 'RWR_PENDING' && (
          <div className="rounded-lg bg-amber-50 p-5 ring-1 ring-amber-300">
            <div className="font-semibold text-amber-950">RWR requested — locked for CCO and engineer</div>
            <p className="mt-1 text-sm text-amber-900">{job.rwrNote}</p>
            {user?.role === ROLES.BRANCH_MANAGER && user.branch?.id === job.branch.id && (
              <Button className="mt-3" loading={finalizeRwr.isPending} onClick={() => finalizeRwr.mutate()}>
                Finalize RWR
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
          <div className="rounded-lg bg-orange-50 p-5 ring-1 ring-orange-300 shadow-xs space-y-3">
            <div>
              <div className="text-base font-semibold text-orange-950">
                {job.approvedAt ? 'Dead-risk acknowledgement pending' : 'Customer approval needed'} — {formatCurrency(job.quotedAmount ?? 0)}
              </div>
              <p className="mt-1 text-sm text-orange-900">
                {agreed !== null ? `Customer had agreed to ${formatCurrency(agreed)}. ` : 'No price was agreed at intake. '}
                {canApprove ? (
                  <>
                    Contact{' '}
                    <a href={`tel:${job.customer.phone}`} className="font-semibold underline">
                      {job.customer.name} ({job.customer.phone})
                    </a>{' '}
                    and record {job.approvedAt ? 'the separate dead-risk acknowledgement' : 'their decision'} below.
                  </>
                ) : (
                  'Waiting for the counter to call the customer.'
                )}
              </p>
            </div>
            {canApprove && !job.approvedAt && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-orange-200">
                <Button size="sm" onClick={() => setApproving('APPROVED')}>
                  ✓ Customer approved
                </Button>
                <Button size="sm" variant="danger" onClick={() => setApproving('REJECTED')}>
                  ✕ Customer rejected
                </Button>
                <a href={`tel:${job.customer.phone}`}>
                  <Button size="sm" variant="secondary">
                    📞 Call customer
                  </Button>
                </a>
                <Button size="sm" variant="secondary" onClick={() => setLoggingCall(true)}>
                  📝 Log call result
                </Button>
                <WhatsAppButton
                  phone={job.customer.phone}
                  status={job.status}
                  context={messageContext}
                  size="sm"
                  label="💬 Send WhatsApp approval quote"
                />
              </div>
            )}
            {job.approvedAt && (
              <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
                ✓ Estimate approved at {formatCurrency(job.approvedAmount ?? job.quotedAmount ?? 0)}
                {job.approvedBy ? ` by ${job.approvedBy.name}` : ''}.
              </div>
            )}
          </div>
        )}
        {job.deadRiskRequested && (
          <div className={`rounded-lg p-4 ring-1 ${job.deadRiskApprovedAt ? 'bg-emerald-50 ring-emerald-200' : 'bg-red-50 ring-red-300'}`}>
            <div className={`font-semibold ${job.deadRiskApprovedAt ? 'text-emerald-900' : 'text-red-950'}`}>
              {job.deadRiskApprovedAt ? '✓ Dead-risk separately approved' : 'Dead-device risk requires separate approval'}
            </div>
            {job.deadRiskNote && <p className={`mt-1 text-sm ${job.deadRiskApprovedAt ? 'text-emerald-800' : 'text-red-900'}`}>{job.deadRiskNote}</p>}
            {job.deadRiskApprovedAt ? (
              <p className="mt-1 text-xs text-emerald-700">
                {formatDateTime(job.deadRiskApprovedAt)}{job.deadRiskApprovedBy ? ` · confirmed by ${job.deadRiskApprovedBy.name}` : ''}
              </p>
            ) : canApprove ? (
              <Button size="sm" variant="danger" className="mt-3" onClick={() => setApprovingDeadRisk(true)}>
                Record dead-risk approval
              </Button>
            ) : <p className="mt-2 text-xs text-red-800">Waiting for the CCO to explain the risk and record customer approval.</p>}
          </div>
        )}
        {job.status === 'CUSTOMER_REJECTED' && (
          <div className="rounded-lg bg-red-50 p-5 ring-1 ring-red-300 shadow-xs space-y-3">
            <div>
              <div className="text-base font-semibold text-red-950">Customer rejected the estimate</div>
              {job.customerResponse && <p className="mt-1 text-sm text-red-900">Customer feedback: “{job.customerResponse}”</p>}
              <p className="mt-1 text-xs text-red-800">
                Please complete Return Without Repair (RWR) so the device can be returned to the counter.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-red-200">
              {canRwr && (
                <Button size="sm" variant="primary" onClick={() => setAction('rwr')}>
                  Finalize RWR (return to counter)
                </Button>
              )}
              {canApprove && (
                <Button size="sm" variant="secondary" onClick={() => setLoggingCall(true)}>
                  📝 Log customer call
                </Button>
              )}
              <WhatsAppButton
                phone={job.customer.phone}
                status={job.status}
                context={messageContext}
                size="sm"
                label="💬 WhatsApp rejection / collect message"
              />
            </div>
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
            {job.estimateOptions && job.estimateOptions.length > 0 && (
              <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-indigo-900">
                  Engineer Proposed Options ({job.estimateOptions.length})
                </div>
                <div className="mt-2 space-y-2">
                  {job.estimateOptions.map((opt, i) => (
                    <div
                      key={opt.id}
                      className={`flex items-start justify-between gap-3 rounded-md border p-2.5 text-xs ${opt.isApproved ? 'border-emerald-500 bg-emerald-50/80' : 'border-indigo-100 bg-white'}`}
                    >
                      <div>
                        <div className="font-semibold text-slate-800">
                          {opt.title} {opt.isApproved && <span className="ml-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">APPROVED BY CUSTOMER</span>}
                        </div>
                        {opt.description && <div className="mt-0.5 text-slate-600">{opt.description}</div>}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="font-bold text-slate-900">{formatCurrency(opt.amount)}</div>
                        {canApprove && job.status === 'AWAITING_APPROVAL' && !job.approvedAt && !opt.isApproved && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setDirectApproveOptionId(opt.id);
                              setApproving('APPROVED');
                            }}
                          >
                            ✓ Approve this
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {job.approvedAmount !== null && job.status !== 'AWAITING_APPROVAL' && job.status !== 'CUSTOMER_REJECTED' && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-emerald-700">
                  ✓ Customer agreed to {formatCurrency(job.approvedAmount)}
                  {job.approvedBy ? ` — confirmed by ${job.approvedBy.name}` : ' at intake'}
                  {job.customerResponse && ` (“${job.customerResponse}”)`}
                </p>
                {canApprove && !job.invoice && job.status !== 'DELIVERED' && job.status !== 'CANCELLED' && (
                  <Button size="sm" variant="secondary" onClick={() => setNegotiating(true)}>Edit negotiated amount</Button>
                )}
              </div>
            )}
            <p className={`mt-2 text-xs ${job.status === 'AWAITING_APPROVAL' ? 'font-semibold text-orange-700' : 'text-slate-600'}`}>
              Now pending with: {JOB_PENDING_WITH[job.status]}
            </p>
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
        size="md"
      >
        {approving && <ApprovalForm job={job} decision={approving} initialOptionId={directApproveOptionId} onDone={() => { setApproving(null); setDirectApproveOptionId(null); }} />}
      </Modal>
      <Modal open={approvingDeadRisk} onClose={() => setApprovingDeadRisk(false)} title="Separate dead-risk approval" size="sm">
        {approvingDeadRisk && <DeadRiskApprovalForm job={job} onDone={() => setApprovingDeadRisk(false)} />}
      </Modal>
      <Modal open={negotiating} onClose={() => setNegotiating(false)} title="Edit negotiated estimate" size="sm">
        {negotiating && <NegotiatedEstimateForm job={job} onDone={() => setNegotiating(false)} />}
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
      <Modal open={loggingCall} onClose={() => setLoggingCall(false)} title="Log customer call">
        {loggingCall && (
          <LogCallForm
            jobId={job.id}
            jobNumber={job.jobNumber}
            status={job.status}
            customer={job.customer}
            onDone={() => setLoggingCall(false)}
          />
        )}
      </Modal>
      <Modal open={!!transition} onClose={() => setTransition(null)} title={transition?.label ?? ''} size="sm">
        {transition && <TransitionForm job={job} transition={transition} onDone={() => setTransition(null)} />}
      </Modal>
    </Card>
  );
}

// ─── Diagnosis form (engineer) ──────────────────────────────────────────────

function DiagnosisForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const faults = useOptions<FaultDto>('faults', { branchId: job.branch.id });
  const findings = useQuery({
    queryKey: ['settings', 'diagnosis-findings'],
    queryFn: () => api.get<{ id: string; label: string; sortOrder: number; isActive: boolean }[]>('/settings/diagnosis-findings'),
  });
  const prices = useQuery({
    queryKey: ['models', job.model?.id ?? 'accessory', 'prices'],
    queryFn: () => job.model ? api.get<ModelPriceDto[]>(`/models/${job.model.id}/prices`) : Promise.resolve([]),
  });
  // Native selects need their options present before the form mounts, or they show the wrong choice.
  if (!faults.data || !prices.data || !findings.data) return <p className="text-sm text-slate-500">Loading…</p>;
  return <DiagnosisFormInner job={job} faults={faults.items} prices={prices.data} findings={findings.data} onDone={onDone} />;
}

function DiagnosisFormInner({ job, faults, prices, findings, onDone }: { job: JobDto; faults: FaultDto[]; prices: ModelPriceDto[]; findings: { id: string; label: string }[]; onDone: () => void }) {
  const queryClient = useQueryClient();

  // Start from the previous estimate, else from the faults reported at intake (with their chosen price).
  const intakeLines: DiagnosisInput['lines'] = job.devices.flatMap((device, deviceIndex) => {
    const deviceLabel = job.devices.length > 1
      ? `Item ${deviceIndex + 1}: ${device.accessoryName ?? `${device.brand?.name ?? device.manualBrand ?? ''} ${device.model?.name ?? device.manualModel ?? ''}`.trim()}`
      : '';
    return [
      ...device.faults.map((fault) => ({
        faultId: fault.id,
        priceId: null,
        partId: null,
        description: [deviceLabel, fault.priceLabel].filter(Boolean).join(' — '),
        amount: fault.price ?? ('' as unknown as number),
      })),
      ...(device.manualFault ? [{
        faultId: null,
        priceId: null,
        partId: null,
        description: [deviceLabel, device.manualFault].filter(Boolean).join(' — '),
        amount: '' as unknown as number,
      }] : []),
    ];
  });
  const initialLines: DiagnosisInput['lines'] = job.estimateLines.length
    ? job.estimateLines.map((l) => ({ faultId: l.fault?.id ?? null, priceId: null, partId: l.part?.id ?? null, description: l.description ?? '', amount: l.amount }))
    : intakeLines;

  const initialOptions: DiagnosisInput['options'] = (job.estimateOptions && job.estimateOptions.length > 0)
    ? job.estimateOptions.map((o) => ({ id: o.id, title: o.title, description: o.description ?? '', amount: o.amount }))
    : [];

  const { register, control, handleSubmit, watch, setValue, setError, formState: { errors } } = useForm<DiagnosisInput, unknown, DiagnosisData>({
    resolver: zodResolver(diagnosisSchema),
    defaultValues: {
      notes: job.diagnosisNotes ?? '',
      findingIds: job.diagnosisFindings.map((finding) => finding.id),
      lines: initialLines,
      options: initialOptions,
      deadRiskRequested: job.deadRiskRequested,
      deadRiskNote: job.deadRiskNote ?? '',
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const { fields: optionFields, append: appendOption, remove: removeOption } = useFieldArray({ control, name: 'options' });
  const lines = watch('lines');
  const options = watch('options');
  const deadRiskRequested = watch('deadRiskRequested');
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
    onSuccess: () => {
      toast.success('Estimate sent to the CCO for customer approval');
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => handleFormError(err, setError),
  });

  return (
    <form onSubmit={handleSubmit((d) => save.mutate(d))} className="space-y-4">
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">What did you find?</div>
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-2">
          {findings.map((finding) => (
            <label key={finding.id} className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" value={finding.id} {...register('findingIds')} className="mt-0.5 size-4 accent-brand-600" />
              {finding.label}
            </label>
          ))}
        </div>
      </div>
      <Field label="Additional finding / notes" error={errors.notes?.message} hint="Select a preset above, enter notes, or use both">
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

      <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h4 className="text-sm font-semibold text-indigo-950">Propose Alternative Options (Optional)</h4>
            <p className="text-xs text-indigo-700">Give the CCO 2–3 options to present to the customer (e.g. Option 1: Original Part ₹3,500, Option 2: Compatible Part ₹2,200).</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => appendOption({ title: `Option ${(optionFields.length + 1)}`, description: '', amount: '' as unknown as number })}
          >
            + Add option
          </Button>
        </div>
        {optionFields.length > 0 ? (
          <div className="mt-3 space-y-3">
            {optionFields.map((field, idx) => (
              <div key={field.id} className="grid grid-cols-1 gap-2 rounded-md border border-indigo-200 bg-white p-3 sm:grid-cols-12 sm:items-center">
                <div className="sm:col-span-4">
                  <input
                    {...register(`options.${idx}.title`)}
                    placeholder="e.g. Compatible Screen"
                    className={inputClass}
                  />
                  {errors.options?.[idx]?.title && <p className="mt-1 text-xs text-red-600">{errors.options[idx]?.title?.message}</p>}
                </div>
                <div className="sm:col-span-5">
                  <input
                    {...register(`options.${idx}.description`)}
                    placeholder="Notes (e.g. 1 month warranty)"
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <input
                    {...register(`options.${idx}.amount`)}
                    type="number"
                    step="0.01"
                    placeholder="Amount ₹"
                    className={inputClass}
                  />
                  {errors.options?.[idx]?.amount && <p className="mt-1 text-xs text-red-600">{errors.options[idx]?.amount?.message}</p>}
                </div>
                <div className="flex justify-end sm:col-span-1">
                  <button
                    type="button"
                    onClick={() => removeOption(idx)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    title="Remove option"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500 italic">No alternative options added. The standard line total below will be sent as the default quote.</p>
        )}
      </div>

      <div className={`rounded-lg border p-4 ${deadRiskRequested ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50/50'}`}>
        <label className="flex items-start gap-3 text-sm font-medium text-slate-800">
          <input type="checkbox" {...register('deadRiskRequested')} className="mt-0.5 size-4 accent-red-600" />
          <span>
            Dead-device risk — repair/opening could make the phone fully dead or worsen its condition
            <span className="mt-1 block text-xs font-normal text-slate-600">The CCO must record a separate customer acknowledgement before repair can begin.</span>
          </span>
        </label>
        {deadRiskRequested && (
          <Field label="Explain the risk" required className="mt-3" error={errors.deadRiskNote?.message}>
            <textarea {...register('deadRiskNote')} rows={2} className={inputClass} placeholder="e.g. Phone is water damaged; board work may cause permanent no-power condition" />
          </Field>
        )}
      </div>

      <div className="flex items-center justify-between rounded-md bg-slate-50 px-4 py-3">
        <div className="text-sm text-slate-600">
          Total estimate
          <span className="block text-xs text-orange-700">
            CCO must call the customer and record approval{agreed !== null ? ` (earlier amount: ${formatCurrency(agreed)})` : ''}
          </span>
        </div>
        <span className="text-lg font-semibold">{formatCurrency(total)}</span>
      </div>

      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Submit estimate" />
    </form>
  );
}

// ─── Approval (CCO) ─────────────────────────────────────────────────────────

function ApprovalForm({ job, decision, initialOptionId, onDone }: { job: JobDto; decision: 'APPROVED' | 'REJECTED'; initialOptionId?: string | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(() => {
    if (initialOptionId) return initialOptionId;
    if (job.estimateOptions && job.estimateOptions.length > 0) {
      const approved = job.estimateOptions.find((o) => o.isApproved);
      return approved ? approved.id : job.estimateOptions[0]!.id;
    }
    return null;
  });

  const { register, handleSubmit, setError, setValue, formState: { errors } } = useForm<ApprovalInput, unknown, ApprovalData>({
    resolver: zodResolver(approvalSchema),
    defaultValues: {
      decision,
      note: '',
      selectedOptionId,
      amount: selectedOptionId
        ? job.estimateOptions.find((option) => option.id === selectedOptionId)?.amount ?? job.quotedAmount
        : job.quotedAmount,
    },
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
    <form onSubmit={handleSubmit((d) => save.mutate({ ...d, selectedOptionId: decision === 'APPROVED' ? selectedOptionId : null }))} className="space-y-4">
      <p className="text-sm text-slate-600">
        Customer: <strong>{job.customer.name}</strong> ({job.customer.phone})
      </p>

      {decision === 'APPROVED' && job.estimateOptions && job.estimateOptions.length > 0 && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-2">
          <div className="text-xs font-semibold text-indigo-950 uppercase tracking-wide">
            Select the option agreed with the customer:
          </div>
          <div className="space-y-2">
            {job.estimateOptions.map((opt) => (
              <label
                key={opt.id}
                className={`flex cursor-pointer items-start justify-between rounded-md border p-2.5 transition ${selectedOptionId === opt.id ? 'border-brand-600 bg-brand-50/80 ring-1 ring-brand-500' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
              >
                <div className="flex items-start gap-2.5">
                  <input
                    type="radio"
                    name="estimateOptionChoice"
                    checked={selectedOptionId === opt.id}
                    onChange={() => {
                      setSelectedOptionId(opt.id);
                      setValue('amount', opt.amount, { shouldValidate: true });
                    }}
                    className="mt-0.5 size-4 accent-brand-600"
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{opt.title}</div>
                    {opt.description && <div className="text-xs text-slate-600">{opt.description}</div>}
                  </div>
                </div>
                <div className="text-sm font-bold text-slate-900">{formatCurrency(opt.amount)}</div>
              </label>
            ))}
            <label
              className={`flex cursor-pointer items-start justify-between rounded-md border p-2.5 transition ${selectedOptionId === null ? 'border-brand-600 bg-brand-50/80 ring-1 ring-brand-500' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <div className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="estimateOptionChoice"
                  checked={selectedOptionId === null}
                  onChange={() => {
                    setSelectedOptionId(null);
                    setValue('amount', job.quotedAmount, { shouldValidate: true });
                  }}
                  className="mt-0.5 size-4 accent-brand-600"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-900">Default Line Item Total</div>
                  <div className="text-xs text-slate-600">Standard sum of fault/part estimates</div>
                </div>
              </div>
              <div className="text-sm font-bold text-slate-900">{formatCurrency(job.quotedAmount ?? 0)}</div>
            </label>
          </div>
        </div>
      )}

      {(!job.estimateOptions || job.estimateOptions.length === 0) && (
        <p className="text-sm text-slate-600">
          Estimate: <span className="font-semibold">{formatCurrency(job.quotedAmount ?? 0)}</span>
        </p>
      )}
      {decision === 'APPROVED' && (
        <Field label="Final amount agreed with customer (₹)" required error={errors.amount?.message} hint="CCO may change this after negotiation">
          <input {...register('amount')} inputMode="decimal" className={inputClass} />
        </Field>
      )}
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

function DeadRiskApprovalForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<z.input<typeof deadRiskApprovalSchema>, unknown, DeadRiskApprovalData>({
    resolver: zodResolver(deadRiskApprovalSchema),
    defaultValues: { approved: false as unknown as true, note: '' },
  });
  const save = useMutation({
    mutationFn: (data: DeadRiskApprovalData) => api.post(`/jobs/${job.id}/dead-risk-approval`, data),
    onSuccess: () => {
      toast.success(job.approvedAt ? 'Dead risk approved — repair may proceed' : 'Dead risk approved — estimate approval is still required');
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (error) => handleFormError(error, setError),
  });
  return (
    <form onSubmit={handleSubmit((data) => save.mutate(data))} className="space-y-4">
      <div className="rounded-lg bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
        <strong>Engineer warning:</strong> {job.deadRiskNote || 'Working on this dead device could worsen its condition.'}
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
        <input type="checkbox" {...register('approved')} className="mt-0.5 size-4 accent-red-600" />
        <span>I explained this risk to the customer and the customer separately approved proceeding.</span>
      </label>
      {errors.approved && <p className="text-xs text-red-600">{errors.approved.message}</p>}
      <Field label="Call note (optional)" error={errors.note?.message}>
        <textarea {...register('note')} rows={2} className={inputClass} placeholder="e.g. Customer accepted risk on phone call" />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Confirm dead-risk approval" />
    </form>
  );
}

function NegotiatedEstimateForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<z.input<typeof negotiatedEstimateSchema>, unknown, NegotiatedEstimateData>({
    resolver: zodResolver(negotiatedEstimateSchema),
    defaultValues: { amount: job.approvedAmount ?? job.quotedAmount ?? 0, note: '' },
  });
  const save = useMutation({
    mutationFn: (data: NegotiatedEstimateData) => api.patch(`/jobs/${job.id}/approved-estimate`, data),
    onSuccess: () => {
      toast.success('Negotiated amount updated');
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (error) => handleFormError(error, setError),
  });
  return (
    <form onSubmit={handleSubmit((data) => save.mutate(data))} className="space-y-4">
      <p className="text-sm text-slate-600">Current approved amount: <strong>{formatCurrency(job.approvedAmount ?? 0)}</strong></p>
      <Field label="New agreed amount (₹)" required error={errors.amount?.message}>
        <input {...register('amount')} inputMode="decimal" className={inputClass} autoFocus />
      </Field>
      <Field label="Negotiation reason" required error={errors.note?.message}>
        <textarea {...register('note')} rows={3} className={inputClass} placeholder="e.g. Customer negotiated after approval; final amount agreed on call" />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Update approved amount" />
    </form>
  );
}

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
