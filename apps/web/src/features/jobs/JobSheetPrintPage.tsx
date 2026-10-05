import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { PAYMENT_MODE_LABELS, type JobDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useJob } from './api';

/** Two copies on one A4 sheet: customer copy (with contact & money) and engineer copy (goes with the phone). */
export function JobSheetPrintPage() {
  const { id = '' } = useParams();
  const { data: job, isLoading, error } = useJob(id);
  if (isLoading) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  if (error || !job) return <div className="p-10 text-center text-slate-600">{error?.message ?? 'Job not found'}</div>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to={`/jobs/${job.id}`} className="text-sm text-slate-500 hover:underline">
          ← Back to job
        </Link>
        <Button onClick={() => window.print()}>🖨 Print job sheet (2 copies)</Button>
      </div>
      <div className="space-y-6 print:space-y-0">
        <Sheet job={job} copy="customer" />
        <div className="border-t-2 border-dashed border-slate-400 text-center text-xs text-slate-400 print:my-3">✂ cut here</div>
        <Sheet job={job} copy="engineer" />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-28 shrink-0 text-slate-500">{label}</span>
      <span className="font-medium">{children || '—'}</span>
    </div>
  );
}

function Sheet({ job, copy }: { job: JobDto; copy: 'customer' | 'engineer' }) {
  const isCustomer = copy === 'customer';
  const accessories = [...job.accessories, ...(job.accessoriesOther ? [job.accessoriesOther] : [])];
  const advance = job.payments.filter((p) => p.kind === 'ADVANCE');
  return (
    <article className="rounded-lg bg-white p-6 text-[13px] leading-snug ring-1 ring-slate-200 print:break-inside-avoid print:rounded-none print:p-2 print:ring-0">
      <header className="flex items-start justify-between border-b border-slate-300 pb-2">
        <div>
          <div className="text-base font-bold">{job.branch.name}</div>
          {job.branch.address && <div className="text-slate-600">{job.branch.address}</div>}
          {job.branch.phone && <div className="text-slate-600">Ph: {job.branch.phone}</div>}
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{isCustomer ? 'Customer copy' : 'Engineer copy'}</div>
          <div className="font-mono text-xl font-bold">{job.jobNumber}</div>
          <div className="text-slate-600">{formatDateTime(job.createdAt)}</div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 py-2">
        {isCustomer && (
          <>
            <Row label="Customer">{job.customer.name}</Row>
            <Row label="Mobile">{job.customer.phone}{job.customer.altPhone && ` / ${job.customer.altPhone}`}</Row>
            {job.customer.address && (
              <div className="col-span-2">
                <Row label="Address">{job.customer.address}</Row>
              </div>
            )}
          </>
        )}
        <Row label="Device">{job.brand.name} {job.model.name}</Row>
        <Row label="Colour">{job.color}</Row>
        <Row label="IMEI">{job.imei && <span className="font-mono">{job.imei}</span>}</Row>
        <Row label="Serial no.">{job.serialNumber && <span className="font-mono">{job.serialNumber}</span>}</Row>
        <Row label="Received by">{job.createdBy.name}</Row>
        <Row label="Engineer">{job.assignedEngineer?.name}</Row>
      </div>

      <div className="space-y-1 border-t border-slate-200 py-2">
        <Row label="Problems">{job.faults.map((f) => f.name).join(', ')}</Row>
        <Row label="Complaint">{job.customerComplaint}</Row>
        <Row label="Accessories">{accessories.length ? accessories.join(', ') : 'None'}</Row>
        <Row label="Condition">{job.conditionNotes}</Row>
      </div>

      {isCustomer ? (
        <>
          <div className="flex justify-between border-t border-slate-200 py-2">
            <Row label="Estimate">{job.estimatedAmount !== null ? formatCurrency(job.estimatedAmount) : 'To be informed after checking'}</Row>
            {advance.length > 0 && (
              <span>
                Advance paid:{' '}
                <span className="font-semibold">
                  {formatCurrency(advance.reduce((s, p) => s + p.amount, 0))} ({advance.map((p) => PAYMENT_MODE_LABELS[p.mode]).join(', ')})
                </span>
              </span>
            )}
          </div>
          <ol className="list-decimal space-y-0.5 border-t border-slate-200 py-2 pl-5 text-[11px] text-slate-600">
            <li>Please bring this job sheet when collecting the phone.</li>
            <li>The estimate may change after inspection; we will call for your approval before any extra work.</li>
            <li>We are not responsible for data loss, or for phones not collected within 30 days of intimation.</li>
            <li>Phones already opened or tampered elsewhere may be returned without repair.</li>
          </ol>
          <footer className="flex justify-between pt-6 text-xs text-slate-500">
            <span>Customer signature: ____________________</span>
            <span>For {job.branch.name}: ____________________</span>
          </footer>
        </>
      ) : (
        <footer className="flex justify-between border-t border-slate-200 pt-6 text-xs text-slate-500">
          <span>Engineer: ____________________</span>
          <span>Checked by: ____________________</span>
        </footer>
      )}
    </article>
  );
}
