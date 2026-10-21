import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { PAYMENT_MODE_LABELS, type JobDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useJob } from './api';
import { ShopHeader } from '@/features/settings/ShopHeader';

export function JobSheetPrintPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const copy = params.get('copy') === 'office' ? 'office' : params.get('copy') === 'customer' ? 'customer' : null;
  const { data: job, isLoading, error } = useJob(id);
  if (isLoading) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  if (error || !job) return <div className="p-10 text-center text-slate-600">{error?.message ?? 'Job not found'}</div>;
  return <div className="mx-auto max-w-4xl">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
      <Link to={`/jobs/${job.id}`} className="text-sm text-slate-500 hover:underline">← Back to job</Link>
      <div className="flex gap-2">
        <Link to={`/jobs/${job.id}/print?copy=customer`} target="_blank"><Button variant="secondary">Customer Copy</Button></Link>
        <Link to={`/jobs/${job.id}/print?copy=office`} target="_blank"><Button variant="secondary">Office Copy</Button></Link>
        {copy && <Button onClick={() => window.print()}>🖨 Print / Save PDF</Button>}
      </div>
    </div>
    {copy ? <Sheet job={job} copy={copy} /> : <div className="space-y-6"><Sheet job={job} copy="customer" /><Sheet job={job} copy="office" /></div>}
  </div>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex gap-2"><span className="w-28 shrink-0 font-semibold">{label}:</span><span>{children || '—'}</span></div>;
}

function PatternBoxes() {
  return <div className="grid w-28 grid-cols-3 gap-3">{Array.from({ length: 9 }, (_, i) => <span key={i} className="block aspect-square border-[3px] border-slate-900" />)}</div>;
}

function Sheet({ job, copy }: { job: JobDto; copy: 'customer' | 'office' }) {
  const accessories = [...job.accessories, ...(job.accessoriesOther ? [job.accessoriesOther] : [])];
  const advance = job.payments.filter((p) => p.kind === 'ADVANCE');
  const product = job.accessoryName ?? `${job.brand?.name ?? ''} ${job.model?.name ?? ''}`.trim();
  return <article className="min-h-[270mm] rounded-lg border border-slate-700 bg-white p-3 text-[13px] leading-snug print:min-h-0 print:rounded-none print:p-2">
    <header className="grid grid-cols-3 items-start border-b border-slate-700 pb-2">
      <div className="text-xs text-slate-500">{formatDateTime(job.createdAt)}</div>
      <div className="text-center"><div className="font-bold">Inward Slip</div><ShopHeader branch={job.branch} /></div>
      <div className="text-right"><div className="font-semibold uppercase">{copy === 'customer' ? 'Customer Copy' : 'Office Copy'}</div><div className="font-mono text-lg font-bold">{job.jobNumber}</div></div>
    </header>
    <div className="grid grid-cols-3 gap-x-5 gap-y-1 border-b border-slate-700 py-2">
      <Row label="Date">{formatDateTime(job.createdAt)}</Row><Row label="Job No.">{job.jobNumber}</Row><Row label="Inwarder">{job.inwardBy?.name ?? job.createdBy.name}</Row>
      <Row label="Customer">{job.customer.name}</Row><Row label="Mobile">{job.customer.phone}</Row><Row label="Alternate">{job.customer.altPhone}</Row>
      <div className="col-span-2"><Row label="Address">{job.customer.address ?? job.customer.city}</Row></div><Row label="Engineer">{job.assignedEngineer?.name}</Row>
    </div>
    <div className="grid grid-cols-2 gap-x-5 gap-y-1 border-b border-slate-700 py-2">
      <Row label={job.jobType === 'ACCESSORY' ? 'Accessory' : 'Product'}>{product}</Row><Row label="Serial No.">{job.serialNumber}</Row>
      {job.jobType === 'MOBILE' && <><Row label="IMEI 1"><span className="font-mono">{job.imei}</span></Row><Row label="IMEI 2"><span className="font-mono">{job.imei2}</span></Row></>}
      <Row label="Colour">{job.color}</Row><Row label="Type">{job.jobType === 'MOBILE' ? 'Mobile' : 'Accessory'}</Row>
    </div>
    <div className="grid min-h-28 grid-cols-2 gap-5 border-b border-slate-700 py-2">
      <div><div className="border-b border-slate-400 font-semibold">Problem</div><p className="pt-1">{job.faults.map((f) => f.name).join(', ')}</p><p>{job.customerComplaint}</p></div>
      <div><div className="border-b border-slate-400 font-semibold">Remark</div><p className="pt-1">{job.physicalConditionRemark ?? job.conditionNotes}</p></div>
    </div>
    <div className="grid grid-cols-3 gap-5 border-b border-slate-700 py-4">
      <div className="space-y-1">{accessories.map((a) => <div key={a}>☑ {a} Return</div>)}{!accessories.length && <div>☐ No accessory received</div>}</div>
      <div className="space-y-1"><div>{job.phoneDamaged ? '☑' : '☐'} Device Damaged</div><div>{job.warranty === 'IN_WARRANTY' ? '☑' : '☐'} In Warranty</div><div>{job.warranty === 'OUT_OF_WARRANTY' ? '☑' : '☐'} Out Warranty</div></div>
      <div><div className="mb-2 font-semibold">Password / Pattern</div><PatternBoxes /></div>
    </div>
    <div className="border-b border-slate-700 py-2 font-bold">Total Amount: {job.estimatedAmount !== null ? formatCurrency(job.estimatedAmount) : 'To be decided'}</div>
    {!!advance.length && <div className="border-b border-slate-300 py-2">Advance: <strong>{formatCurrency(advance.reduce((s, p) => s + p.amount, 0))}</strong> ({advance.map((p) => PAYMENT_MODE_LABELS[p.mode]).join(', ')})</div>}
    {(job.warrantyPeriod || job.warrantyTerms) && <div className="border-b border-slate-300 py-2 text-xs"><strong>Repair warranty:</strong> {job.warrantyPeriod || 'As stated'}{job.warrantyTerms && ` — ${job.warrantyTerms}`}</div>}
    <ol className="list-decimal space-y-1 py-3 pl-5 text-xs text-slate-700">
      <li>Please bring this job sheet when collecting the device.</li><li>The estimate may change after inspection; work starts only after customer approval.</li><li>We are not responsible for data loss or devices not collected within 30 days of intimation.</li><li>Devices opened or tampered elsewhere may be returned without repair.</li><li>Repair cost may increase only after customer approval.</li>
    </ol>
    <footer className="mt-8 flex justify-between border-t border-slate-700 pt-10 text-xs font-semibold"><span>Customer Signature</span><span>Authorised Signature</span></footer>
  </article>;
}
