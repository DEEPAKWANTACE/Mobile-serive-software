import {
  DELIVERABLE_STATUSES,
  JOB_STATUS_LABELS,
  ROLES,
  roundMoney,
  type BillPreviewDto,
  type DeliveryData,
  type InvoiceDto,
  type JobStatus,
} from '@msm/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Actor } from '../../lib/request-context.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { publicJobNumber } from '../jobs/job-number.ts';
import { loadForAccess } from '../jobs/jobs.service.ts';
import { endAssignment, recordStatus } from '../jobs/history.ts';

/**
 * Delivery & billing. The bill comes from the customer-approved estimate (repair) or an optional inspection charge
 * (RWR); the counter only adds a discount and records how the balance was paid. Amounts are always computed here.
 */

const billSelect = {
  id: true,
  jobNumber: true,
  branchId: true,
  status: true,
  jobType: true,
  imei: true,
  imei2: true,
  serialNumber: true,
  accessories: true,
  accessoriesOther: true,
  estimateLines: {
    select: {
      description: true,
      priceLabel: true,
      warranty: true,
      amount: true,
      fault: { select: { name: true } },
      part: { select: { code: true, name: true } },
    },
    orderBy: { sortOrder: 'asc' },
  },
  payments: { select: { kind: true, amount: true } },
  warrantyPeriod: true,
  warrantyTerms: true,
  branch: { select: { allowImeiNa: true, requireImeiAtDelivery: true, defaultWarrantyPeriod: true, defaultWarrantyTerms: true } },
} satisfies Prisma.JobSelect;

type BillJob = Prisma.JobGetPayload<{ select: typeof billSelect }>;

function lineText(l: BillJob['estimateLines'][number]) {
  const base = l.part ? l.part.name : l.fault ? `${l.fault.name}${l.priceLabel ? ` (${l.priceLabel})` : ''}` : (l.description ?? 'Service');
  return (l.part || l.fault) && l.description ? `${base} — ${l.description}` : base;
}

const netPaid = (payments: BillJob['payments']) =>
  roundMoney(payments.reduce((sum, p) => sum + (p.kind === 'REFUND' ? -1 : 1) * p.amount.toNumber(), 0));

const RWR_PHOTO_MESSAGE = 'Please upload the required mobile phone or PCB photographs before proceeding with delivery.';

function assertDeliverable(status: JobStatus) {
  if (!DELIVERABLE_STATUSES.includes(status)) {
    throw HttpError.conflict(`Only repaired (Ready) or RWR phones can be delivered — this job is "${JOB_STATUS_LABELS[status]}"`);
  }
}

async function loadBillJob(jobId: string, actor: Actor) {
  const access = await loadForAccess(jobId, actor);
  // The Branch Manager only approves an RWR; the CCO makes the final hand-over.
  if (access.status === 'RWR' && actor.role !== ROLES.CCO) {
    throw HttpError.forbidden('Only the CCO can deliver an RWR job after Branch Manager approval');
  }
  // The owning branch delivers, and only once the phone is physically back with it.
  if (actor.branchId && actor.branchId !== access.branchId) throw HttpError.forbidden('Only the branch that took in the phone can deliver it');
  if (access.location !== 'AT_BRANCH' || access.currentBranchId !== access.branchId) {
    throw HttpError.conflict('The phone is not back at the branch yet — receive it from L4 first');
  }
  if (access.status === 'RWR' && !(await prisma.jobPhoto.count({ where: { jobId, kind: 'RWR' } }))) {
    throw HttpError.badRequest(RWR_PHOTO_MESSAGE, { photos: [RWR_PHOTO_MESSAGE] });
  }
  return prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: billSelect });
}

function buildPreview(job: BillJob): BillPreviewDto {
  const isRwr = job.status === 'RWR';
  const lines = isRwr
    ? []
    : job.estimateLines.map((l) => ({ description: lineText(l), partCode: l.part?.code ?? null, warranty: l.warranty, amount: l.amount.toNumber() }));
  return {
    kind: isRwr ? 'RWR' : 'REPAIR',
    lines,
    subtotal: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
    paid: netPaid(job.payments),
    // Branch setting; never required for a phone returned without repair (or a cancelled job).
    imeiRequired: job.jobType === 'MOBILE' && !isRwr && job.branch.requireImeiAtDelivery,
    imeiAsked: job.jobType === 'MOBILE',
    allowImeiNa: job.branch.allowImeiNa || isRwr,
    warrantyPeriod: job.warrantyPeriod ?? job.branch.defaultWarrantyPeriod,
    warrantyTerms: job.warrantyTerms ?? job.branch.defaultWarrantyTerms,
    serialNumberRequired: !isRwr && job.jobType === 'ACCESSORY',
    accessories: [...job.accessories, ...(job.accessoriesOther ? [job.accessoriesOther] : [])],
  };
}

export async function preview(jobId: string, actor: Actor): Promise<BillPreviewDto> {
  const job = await loadBillJob(jobId, actor);
  assertDeliverable(job.status);
  return buildPreview(job);
}

const invalid = (field: string, message: string) => HttpError.badRequest('Invalid request', { [field]: [message] });

/**
 * Invoice number mirrors the job-sheet number so the bill and the inward slip match
 * (job 0697 at branch B1 -> INV-B1-0697). Job numbers are globally unique and a job has
 * at most one invoice, so this is unique. Legacy prefixed job numbers already carry
 * their branch and period, so they are used whole to avoid colliding with new numbers.
 */
function invoiceNumberFor(branch: { code: string }, jobNumber: string) {
  return /^\d+$/.test(jobNumber) ? `INV-${branch.code}-${jobNumber}` : `INV-${jobNumber}`;
}

export async function deliver(jobId: string, data: DeliveryData, actor: Actor) {
  const job = await loadBillJob(jobId, actor);
  assertDeliverable(job.status);
  const bill = buildPreview(job);

  const deliveryImei = job.jobType === 'MOBILE' ? (data.imei ?? job.imei) : null;
  if (deliveryImei === 'N/A' && data.imei === 'N/A' && !bill.allowImeiNa) {
    throw invalid('imei', 'IMEI N/A is turned off for this branch — enter the IMEI');
  }
  if (bill.imeiRequired && (!deliveryImei || (deliveryImei === 'N/A' && !bill.allowImeiNa))) {
    throw invalid('imei', bill.allowImeiNa ? 'Enter the IMEI or explicitly select N/A before delivery' : 'Enter the IMEI before delivery');
  }
  if (bill.serialNumberRequired && !job.serialNumber) {
    throw invalid('serialNumber', 'Add the serial number before delivering a repaired accessory');
  }
  if (bill.accessories.length && !data.accessoriesReturned) throw invalid('accessoriesReturned', 'Confirm the accessories were returned');

  // No invoice and no charge for a phone returned without repair: any advance is simply refunded.
  const isRwr = bill.kind === 'RWR';
  const lines = isRwr ? [] : bill.lines;
  const subtotal = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  const discount = isRwr ? 0 : data.discount;
  if (discount > subtotal) throw invalid('discount', 'Discount cannot be more than the bill');
  const total = roundMoney(subtotal - discount);
  const due = roundMoney(total - bill.paid);

  const collected = roundMoney(data.payments.reduce((s, p) => s + p.amount, 0));
  if (due >= 0) {
    if (collected !== due) throw invalid('payments', `Collect exactly ₹${due.toFixed(2)} (entered ₹${collected.toFixed(2)})`);
    if (data.refund) throw invalid('refund', 'No refund is due');
  } else {
    if (collected > 0) throw invalid('payments', 'Nothing to collect — the customer has paid more than the bill');
    if (!data.refund || roundMoney(data.refund.amount) !== -due) throw invalid('refund', `Refund exactly ₹${(-due).toFixed(2)} to the customer`);
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: job.status },
      data: {
        status: 'DELIVERED',
        dueAt: null,
        deliveredAt: now,
        deliveredById: actor.sub,
        deliveredTo: data.deliveredTo,
        deliveryNote: data.note ?? null,
        ...(deliveryImei && { imei: deliveryImei }),
        // Repair warranty is decided at delivery (branch default pre-filled).
        ...(data.warrantyPeriod !== undefined && { warrantyPeriod: data.warrantyPeriod }),
        ...(data.warrantyTerms !== undefined && { warrantyTerms: data.warrantyTerms }),
      },
    });
    if (!count) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');
    await endAssignment(tx, jobId, 'CLOSED');
    await recordStatus(tx, { jobId, from: job.status, to: 'DELIVERED', actorId: actor.sub, remark: `Delivered to ${data.deliveredTo}${data.note ? ` — ${data.note}` : ''}` });

    const branch = await tx.branch.findUniqueOrThrow({ where: { id: job.branchId }, select: { id: true, code: true } });
    const invoiceNumber = isRwr ? null : invoiceNumberFor(branch, job.jobNumber);

    const invoice = isRwr
      ? null
      : await tx.invoice.create({
          data: {
            invoiceNumber: invoiceNumber!,
            jobId,
            branchId: job.branchId,
            subtotal,
            discount,
            discountReason: discount > 0 ? (data.discountReason ?? null) : null,
            total,
            createdById: actor.sub,
            lines: { create: lines.map((l, i) => ({ ...l, sortOrder: i })) },
          },
          select: { id: true, invoiceNumber: true },
        });

    // Earlier advances belong to this invoice too.
    if (invoice) await tx.payment.updateMany({ where: { jobId, invoiceId: null }, data: { invoiceId: invoice.id } });
    const payments = [
      ...data.payments.map((pay) => ({ ...pay, kind: 'FINAL' as const })),
      ...(data.refund ? [{ ...data.refund, kind: 'REFUND' as const }] : []),
    ];
    for (const pay of payments) {
      await tx.payment.create({
        data: {
          jobId,
          branchId: job.branchId,
          invoiceId: invoice?.id ?? null,
          kind: pay.kind,
          mode: pay.mode,
          amount: pay.amount,
          reference: pay.reference ?? null,
          receivedById: actor.sub,
        },
      });
    }

    // Part requests still open on a closed job are withdrawn.
    await tx.jobPart.updateMany({
      where: { jobId, status: { in: ['REQUESTED', 'NOT_AVAILABLE'] } },
      data: { status: 'CANCELLED', handledById: actor.sub, handledAt: now, note: 'Job delivered' },
    });

    await recordAudit(
      {
        actorId: actor.sub,
        action: 'job.delivered',
        entityType: 'job',
        entityId: jobId,
        branchId: job.branchId,
        metadata: {
          invoiceNumber,
          total,
          discount,
          collected,
          refund: data.refund?.amount ?? 0,
          deliveredTo: data.deliveredTo,
        },
        ip: actor.ip,
      },
      tx,
    );
    return { invoiceId: invoice?.id ?? null, invoiceNumber, total, collected, refund: data.refund?.amount ?? 0 };
  });
}

export async function getInvoice(jobId: string, actor: Actor): Promise<InvoiceDto> {
  await loadForAccess(jobId, actor);
  const inv = await prisma.invoice.findUnique({
    where: { jobId },
    select: {
      id: true,
      invoiceNumber: true,
      createdAt: true,
      subtotal: true,
      discount: true,
      discountReason: true,
      total: true,
      createdBy: { select: { name: true } },
      lines: { select: { description: true, partCode: true, warranty: true, amount: true }, orderBy: { sortOrder: 'asc' } },
      branch: { select: { name: true, code: true, address: true, phone: true } },
      job: {
        select: {
          id: true,
          jobNumber: true,
          createdAt: true,
          imei: true,
          serialNumber: true,
          status: true,
          rwrReason: true,
          deliveredTo: true,
          deliveredAt: true,
          warrantyPeriod: true,
          warrantyTerms: true,
          manualFault: true,
          customerComplaint: true,
          faults: { select: { fault: { select: { name: true } } } },
          devices: { select: { manualFault: true, faults: { select: { fault: { select: { name: true } } } } }, orderBy: { sortOrder: 'asc' } },
          brand: { select: { name: true } },
          deviceModel: { select: { name: true } },
          manualBrand: true,
          manualModel: true,
          accessoryName: true,
          jobType: true,
          customer: { select: { name: true, phone: true, address: true } },
          payments: {
            select: { kind: true, mode: true, amount: true, reference: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });
  if (!inv) throw HttpError.notFound('No invoice for this job yet');
  const { job } = inv;
  const paid = roundMoney(job.payments.reduce((s, p) => s + (p.kind === 'REFUND' ? -1 : 1) * p.amount.toNumber(), 0));
  const total = inv.total.toNumber();
  const reported = job.devices.length
    ? job.devices.flatMap((d) => [...d.faults.map((f) => f.fault.name), ...(d.manualFault ? [d.manualFault] : [])])
    : [...job.faults.map((f) => f.fault.name), ...(job.manualFault ? [job.manualFault] : [])];
  const problems = [...new Set(reported)].join(', ') || job.customerComplaint || '—';
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    createdAt: inv.createdAt.toISOString(),
    subtotal: inv.subtotal.toNumber(),
    discount: inv.discount.toNumber(),
    discountReason: inv.discountReason,
    total: inv.total.toNumber(),
    lines: inv.lines.map((l) => ({ description: l.description, partCode: l.partCode, warranty: l.warranty, amount: l.amount.toNumber() })),
    payments: job.payments.map((p) => ({ ...p, amount: p.amount.toNumber(), createdAt: p.createdAt.toISOString() })),
    createdBy: inv.createdBy,
    job: {
      id: job.id,
      jobNumber: publicJobNumber(job.jobNumber),
      receivedAt: job.createdAt.toISOString(),
      device: job.jobType === 'ACCESSORY'
        ? (job.accessoryName ?? 'Accessory')
        : (job.manualBrand || job.manualModel
            ? `${job.manualBrand ?? ''} ${job.manualModel ?? ''}`.trim()
            : `${job.brand?.name ?? ''} ${job.deviceModel?.name ?? ''}`.trim()) || 'Mobile',
      imei: job.imei,
      serialNumber: job.serialNumber,
      status: job.status,
      rwrReason: job.rwrReason,
      deliveredTo: job.deliveredTo,
      deliveredAt: job.deliveredAt?.toISOString() ?? null,
      problems,
      warrantyPeriod: job.warrantyPeriod,
      warrantyTerms: job.warrantyTerms,
    },
    paid,
    due: Math.max(0, roundMoney(total - paid)),
    customer: job.customer,
    branch: inv.branch,
  };
}
