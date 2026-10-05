import {
  DELIVERABLE_STATUSES,
  JOB_STATUS_LABELS,
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
import { period } from '../jobs/job-number.ts';
import { loadForAccess } from '../jobs/jobs.service.ts';

/**
 * Delivery & billing. The bill comes from the customer-approved estimate (repair) or an optional inspection charge
 * (RWR); the counter only adds a discount and records how the balance was paid. Amounts are always computed here.
 */

const billSelect = {
  id: true,
  branchId: true,
  status: true,
  imei: true,
  serialNumber: true,
  accessories: true,
  accessoriesOther: true,
  estimateLines: {
    select: {
      description: true,
      priceLabel: true,
      amount: true,
      fault: { select: { name: true } },
      part: { select: { code: true, name: true } },
    },
    orderBy: { sortOrder: 'asc' },
  },
  payments: { select: { kind: true, amount: true } },
} satisfies Prisma.JobSelect;

type BillJob = Prisma.JobGetPayload<{ select: typeof billSelect }>;

function lineText(l: BillJob['estimateLines'][number]) {
  const base = l.part ? `${l.part.code} ${l.part.name}` : l.fault ? `${l.fault.name}${l.priceLabel ? ` (${l.priceLabel})` : ''}` : (l.description ?? 'Service');
  return (l.part || l.fault) && l.description ? `${base} — ${l.description}` : base;
}

const netPaid = (payments: BillJob['payments']) =>
  roundMoney(payments.reduce((sum, p) => sum + (p.kind === 'REFUND' ? -1 : 1) * p.amount.toNumber(), 0));

function assertDeliverable(status: JobStatus) {
  if (!DELIVERABLE_STATUSES.includes(status)) {
    throw HttpError.conflict(`Only repaired (Ready) or RWR phones can be delivered — this job is "${JOB_STATUS_LABELS[status]}"`);
  }
}

async function loadBillJob(jobId: string, actor: Actor) {
  await loadForAccess(jobId, actor);
  return prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: billSelect });
}

function buildPreview(job: BillJob): BillPreviewDto {
  const isRwr = job.status === 'RWR';
  const lines = isRwr ? [] : job.estimateLines.map((l) => ({ description: lineText(l), amount: l.amount.toNumber() }));
  return {
    kind: isRwr ? 'RWR' : 'REPAIR',
    lines,
    subtotal: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
    paid: netPaid(job.payments),
    imeiRequired: !isRwr,
    accessories: [...job.accessories, ...(job.accessoriesOther ? [job.accessoriesOther] : [])],
  };
}

export async function preview(jobId: string, actor: Actor): Promise<BillPreviewDto> {
  const job = await loadBillJob(jobId, actor);
  assertDeliverable(job.status);
  return buildPreview(job);
}

const invalid = (field: string, message: string) => HttpError.badRequest('Invalid request', { [field]: [message] });

export async function deliver(jobId: string, data: DeliveryData, actor: Actor) {
  const job = await loadBillJob(jobId, actor);
  assertDeliverable(job.status);
  const bill = buildPreview(job);

  if (bill.imeiRequired && !job.imei && !job.serialNumber) throw invalid('imei', 'Add the IMEI / serial number before delivering a repaired phone');
  if (bill.accessories.length && !data.accessoriesReturned) throw invalid('accessoriesReturned', 'Confirm the accessories were returned');

  const lines = bill.kind === 'RWR' && data.inspectionCharge > 0 ? [{ description: 'Inspection / diagnosis charge', amount: data.inspectionCharge }] : bill.lines;
  const subtotal = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  if (data.discount > subtotal) throw invalid('discount', 'Discount cannot be more than the bill');
  const total = roundMoney(subtotal - data.discount);
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
      data: { status: 'DELIVERED', deliveredAt: now, deliveredById: actor.sub, deliveredTo: data.deliveredTo, deliveryNote: data.note ?? null },
    });
    if (!count) throw HttpError.conflict('This job was just updated by someone else. Refresh and try again.');

    const branch = await tx.branch.findUniqueOrThrow({ where: { id: job.branchId }, select: { id: true, code: true } });
    const p = `INV-${period(now)}`; // invoice series shares the per-branch counter table under its own key
    const [row] = await tx.$queryRaw<{ last_seq: number }[]>`
      INSERT INTO job_counters (branch_id, period, last_seq) VALUES (${branch.id}::uuid, ${p}, 1)
      ON CONFLICT (branch_id, period) DO UPDATE SET last_seq = job_counters.last_seq + 1
      RETURNING last_seq`;
    const invoiceNumber = `INV-${branch.code}-${period(now)}-${String(row!.last_seq).padStart(4, '0')}`;

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        jobId,
        branchId: job.branchId,
        subtotal,
        discount: data.discount,
        discountReason: data.discount > 0 ? (data.discountReason ?? null) : null,
        total,
        createdById: actor.sub,
        lines: { create: lines.map((l, i) => ({ ...l, sortOrder: i })) },
      },
      select: { id: true, invoiceNumber: true },
    });

    // Earlier advances belong to this invoice too.
    await tx.payment.updateMany({ where: { jobId, invoiceId: null }, data: { invoiceId: invoice.id } });
    const payments = [
      ...data.payments.map((pay) => ({ ...pay, kind: 'FINAL' as const })),
      ...(data.refund ? [{ ...data.refund, kind: 'REFUND' as const }] : []),
    ];
    for (const pay of payments) {
      await tx.payment.create({
        data: {
          jobId,
          branchId: job.branchId,
          invoiceId: invoice.id,
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
          discount: data.discount,
          collected,
          refund: data.refund?.amount ?? 0,
          deliveredTo: data.deliveredTo,
        },
        ip: actor.ip,
      },
      tx,
    );
    return { invoiceId: invoice.id, invoiceNumber, total, collected, refund: data.refund?.amount ?? 0 };
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
      lines: { select: { description: true, amount: true }, orderBy: { sortOrder: 'asc' } },
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
          brand: { select: { name: true } },
          deviceModel: { select: { name: true } },
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
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    createdAt: inv.createdAt.toISOString(),
    subtotal: inv.subtotal.toNumber(),
    discount: inv.discount.toNumber(),
    discountReason: inv.discountReason,
    total: inv.total.toNumber(),
    lines: inv.lines.map((l) => ({ description: l.description, amount: l.amount.toNumber() })),
    payments: job.payments.map((p) => ({ ...p, amount: p.amount.toNumber(), createdAt: p.createdAt.toISOString() })),
    createdBy: inv.createdBy,
    job: {
      id: job.id,
      jobNumber: job.jobNumber,
      receivedAt: job.createdAt.toISOString(),
      device: `${job.brand.name} ${job.deviceModel.name}`,
      imei: job.imei,
      serialNumber: job.serialNumber,
      status: job.status,
      rwrReason: job.rwrReason,
      deliveredTo: job.deliveredTo,
    },
    customer: job.customer,
    branch: inv.branch,
  };
}
