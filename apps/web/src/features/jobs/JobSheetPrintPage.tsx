import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { PAYMENT_MODE_LABELS, type JobDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useJob } from './api';
import { makeTestJob } from './testJob';
import { ShopHeader } from '@/features/settings/ShopHeader';

export function JobSheetPrintPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const copy = params.get('copy') === 'office' ? 'office' : params.get('copy') === 'customer' ? 'customer' : null;
  const isTest = id === 'test';
  const query = useJob(id, !isTest);
  const { isLoading, error } = query;
  const testJob = useMemo(() => (isTest ? makeTestJob() : null), [isTest]);
  const job = testJob ?? query.data;
  if (!isTest && isLoading) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  if (error || !job) return <div className="p-10 text-center text-slate-600">{error?.message ?? 'Job not found'}</div>;
  return <div className="mx-auto max-w-4xl">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
      <Link to={isTest ? "/jobs" : `/jobs/${job.id}`} className="text-sm text-slate-500 hover:underline">← Back to job</Link>
      <div className="flex gap-2">
        <Link to={`/jobs/${job.id}/print?copy=customer`} target="_blank"><Button variant="secondary">Customer Copy</Button></Link>
        <Link to={`/jobs/${job.id}/print?copy=office`} target="_blank"><Button variant="secondary">Office Copy</Button></Link>
      </div>
    </div>
    {copy ? <SheetPdf job={job} copy={copy} /> : <div className="space-y-6"><Sheet job={job} copy="customer" /><Sheet job={job} copy="office" /></div>}
  </div>;
}

/** Shows one copy and opens the browser print dialog, so "Save as PDF" gives a small text PDF. */
function SheetPdf({ job, copy }: { job: JobDto; copy: 'customer' | 'office' }) {
  useEffect(() => {
    const timer = setTimeout(async () => {
      await document.fonts.ready;
      window.print();
    }, 800);
    return () => clearTimeout(timer);
  }, [job, copy]);
  return <>
    <div className="mb-3 flex justify-end print:hidden"><Button onClick={() => window.print()}>Print / Save as PDF</Button></div>
    <Sheet job={job} copy={copy} />
  </>;
}

/** Printed serial without the legacy branch/month prefix. */
const serial = (jobNumber: string) => jobNumber.match(/\d+$/)?.[0] ?? jobNumber;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex min-w-0 gap-2 print:gap-1"><span className="w-[5.5rem] shrink-0 font-semibold print:w-[17mm]">{label}:</span><span className="min-w-0 break-words">{children || '—'}</span></div>;
}

function PatternBoxes() {
  return <div className="grid w-[58px] grid-cols-3 gap-1">{Array.from({ length: 9 }, (_, i) => <span key={i} className="block aspect-square border border-slate-900" />)}</div>;
}

function PrintCheckbox({ checked, children }: { checked: boolean; children: ReactNode }) {
  return <div className="flex items-center gap-1.5">
    <span className="flex size-3.5 shrink-0 items-center justify-center border border-slate-900 text-[10px] font-bold leading-none">{checked ? '✓' : ''}</span>
    <span>{children}</span>
  </div>;
}

function Sheet({ job, copy }: { job: JobDto; copy: 'customer' | 'office' }) {
  const accessories = [...job.accessories, ...(job.accessoriesOther ? [job.accessoriesOther] : [])];
  const normalizedAccessories = accessories.map((accessory) => accessory.trim().toLocaleLowerCase());
  const accessoryChecked = (...names: string[]) => names.some((name) => normalizedAccessories.includes(name.toLocaleLowerCase()));
  const standardAccessoryNames = new Set(['sim card', 'sim', 'memory card', 'memory', 'back cover', 'cover']);
  const otherAccessories = accessories.filter((accessory) => !standardAccessoryNames.has(accessory.trim().toLocaleLowerCase()));
  const advance = job.payments.filter((p) => p.kind === 'ADVANCE');
  const product = job.accessoryName ?? `${job.brand?.name ?? ''} ${job.model?.name ?? ''}`.trim();
  return <article className="flex min-h-[270mm] flex-col rounded-lg border border-slate-700 bg-white p-3 text-[14.5px] leading-snug print:box-border print:h-[197mm] print:min-h-0 print:w-[136mm] print:break-inside-avoid print:overflow-hidden print:rounded-none print:p-2 print:text-[10.5px] print:leading-tight">
    <header className="relative border-b border-slate-700 px-24 pb-2 text-center print:min-h-[24mm] print:shrink-0 print:px-[25mm] print:pb-1">
      <div className="font-bold">Inward Slip</div>
      <ShopHeader branch={job.branch} compact />
      <div className="absolute top-0 right-0 text-right font-semibold uppercase">{copy === 'customer' ? 'Customer Copy' : 'Office Copy'}</div>
    </header>
    <div className="grid grid-cols-2 gap-x-5 gap-y-1 border-b border-slate-700 py-2 print:min-h-[28mm] print:shrink-0 print:gap-x-3 print:py-1.5">
      <Row label="Date"><span className="whitespace-nowrap">{formatDateTime(job.createdAt)}</span></Row>
      <Row label="Job No."><span className="font-mono whitespace-nowrap">{serial(job.jobNumber)}</span></Row>
      <Row label="Customer">{job.customer.name}</Row>
      <Row label="Mobile"><span className="whitespace-nowrap">{job.customer.phone}</span></Row>
      <Row label="Address">{job.customer.address ?? job.customer.city}</Row>
      <Row label="Alternate"><span className="whitespace-nowrap">{job.customer.altPhone}</span></Row>
      <Row label="Inwarder">{job.inwardBy?.name ?? job.createdBy.name}</Row>
      <Row label="Engineer">{job.assignedEngineer?.name}</Row>
    </div>
    <div className="space-y-1 border-b border-slate-700 py-2 print:min-h-[22mm] print:shrink-0 print:py-1">
      <Row label={job.jobType === 'ACCESSORY' ? 'Accessory' : 'Product'}>{product}</Row>
      <div className="grid grid-cols-2 gap-x-5 print:gap-x-3">
        <Row label="Type">{job.jobType === 'MOBILE' ? 'Mobile' : 'Accessory'}</Row>
        <Row label="Colour">{job.color}</Row>
      </div>
      <div className="grid grid-cols-2 gap-x-5 print:gap-x-3">
        <Row label="IMEI 1"><span className="font-mono">{job.imei}</span></Row>
        <Row label="IMEI 2"><span className="font-mono">{job.imei2}</span></Row>
      </div>
      <Row label="Serial No."><span className="font-mono">{job.serialNumber}</span></Row>
    </div>
    <div className="grid min-h-28 grid-cols-2 gap-5 border-b border-slate-700 py-2 print:min-h-[22mm] print:shrink-0 print:gap-3 print:py-1">
      <div><div className="border-b border-slate-400 font-semibold">Problem</div><p className="pt-1">{job.faults.map((f) => f.name).join(', ')}</p><p>{job.customerComplaint}</p></div>
      <div><div className="border-b border-slate-400 font-semibold">Remark</div><p className="pt-1">{job.physicalConditionRemark ?? job.conditionNotes}</p></div>
    </div>
    <div className="grid grid-cols-3 gap-5 border-b border-slate-700 py-4 print:min-h-[34mm] print:shrink-0 print:items-center print:gap-3 print:py-1">
      <div className="col-span-2">
        <div className="grid grid-cols-2 gap-x-4">
          <div className="space-y-1">
            <PrintCheckbox checked={accessoryChecked('SIM Card', 'SIM')}>SIM Card Return</PrintCheckbox>
            <PrintCheckbox checked={accessoryChecked('Memory Card', 'Memory')}>Memory Card Return</PrintCheckbox>
            <PrintCheckbox checked={accessoryChecked('Back Cover', 'Cover')}>Back Cover Return</PrintCheckbox>
          </div>
          <div className="space-y-1">
            <PrintCheckbox checked={job.phoneDamaged}>Device Damaged</PrintCheckbox>
            <PrintCheckbox checked={job.warranty === 'IN_WARRANTY'}>In Warranty</PrintCheckbox>
            <PrintCheckbox checked={job.warranty === 'OUT_OF_WARRANTY'}>Out Warranty</PrintCheckbox>
          </div>
        </div>
        <div className="mt-2 border-t border-slate-300 pt-1">
          <PrintCheckbox checked={!accessories.length}>No accessory received</PrintCheckbox>
          {!!otherAccessories.length && <div className="mt-1 text-[0.9em] text-slate-700">Other accessories: {otherAccessories.join(', ')}</div>}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-end gap-2"><span className="font-semibold">Password:</span><span className="min-w-28 flex-1 px-1 font-mono">{job.devicePassword}</span></div>
        <div className="mb-1 font-semibold">Pattern:</div><PatternBoxes />
      </div>
    </div>
    <div className="border-b border-slate-700 py-2 font-bold print:flex print:min-h-[7mm] print:shrink-0 print:items-center print:py-1">Estimate Amount: {job.estimatedAmount !== null ? formatCurrency(job.estimatedAmount) : 'To be decided'}</div>
    {!!advance.length && <div className="border-b border-slate-300 py-2 print:shrink-0 print:py-1">Advance: <strong>{formatCurrency(advance.reduce((s, p) => s + p.amount, 0))}</strong> ({advance.map((p) => PAYMENT_MODE_LABELS[p.mode]).join(', ')})</div>}
    {(job.warrantyPeriod || job.warrantyTerms) && <div className="border-b border-slate-300 py-2 text-xs print:shrink-0 print:py-1 print:text-[9px]"><strong>Repair warranty:</strong> {job.warrantyPeriod || 'As stated'}{job.warrantyTerms && ` — ${job.warrantyTerms}`}</div>}
    <div lang="mr" className="flex-1 py-3 text-[12px] leading-relaxed text-slate-800 print:min-h-0 print:overflow-hidden print:py-1 print:text-[9px] print:leading-snug">
      <strong>सुचना:</strong>
      <p>१) पावती आणल्याशिवाय मोबाईल मिळणार नाही.</p>
      <p>२) आऊट वारंटी मोबाईल ३० दिवसाचे आत घेऊन जाणे.</p>
      <p>३) आऊट वारंटी मोबाईलमध्ये जी तक्रार आहे, त्यापेक्षा तक्रार वाढू शकते. किंवा मोबाईल बंद पडू शकतो.</p>
      <p>४) मोबाईल रिपेयर झाल्यानंतर मोबाईल चेक करून घेणे. नंतर कुठलीही तक्रार ऐकून घेतल्या जाणार नाही.</p>
      <p>५) सांगितलेल्या खर्चात बदल होऊ शकतो.</p>
    </div>
    <footer className="mt-auto flex min-h-[20mm] items-end justify-between border-t border-slate-700 pt-6 text-xs font-semibold print:min-h-[14mm] print:shrink-0 print:pb-1 print:pt-2 print:text-[9px]"><span>Customer Signature</span><span>Authorised Signature</span></footer>
  </article>;
}
