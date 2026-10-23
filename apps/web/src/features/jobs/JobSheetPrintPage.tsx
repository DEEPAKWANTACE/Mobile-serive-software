import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
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

/** Renders the sheet off-screen, converts it to an A4 PDF and shows it in an embedded viewer. */
function SheetPdf({ job, copy }: { job: JobDto; copy: 'customer' | 'office' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const timer = setTimeout(async () => {
      const node = ref.current;
      if (!node) return;
      try {
        await document.fonts.ready;
        // Give the logo (fetched with auth) time to load before capturing.
        await Promise.all([...node.querySelectorAll('img')].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
        const png = await toPng(node, { pixelRatio: 2, backgroundColor: '#ffffff' });
        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        const props = pdf.getImageProperties(png);
        const width = 200;
        const height = Math.min((props.height * width) / props.width, 287);
        pdf.addImage(png, 'PNG', 5, 5, width, height);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(pdf.output('blob'));
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [job, copy]);
  return <>
    <div className="pointer-events-none fixed top-0 -left-[10000px] w-[794px]" aria-hidden><div ref={ref}><Sheet job={job} copy={copy} /></div></div>
    {url ? <iframe src={url} title="Job sheet PDF" className="h-[85vh] w-full rounded-lg border border-slate-300" />
      : failed ? <Sheet job={job} copy={copy} />
      : <div className="p-10 text-center text-slate-500">Generating PDF…</div>}
  </>;
}

/** Printed serial: only the last 4 digits of the job number, e.g. "0001". */
const serial = (jobNumber: string) => jobNumber.slice(-4);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex gap-2"><span className="w-[5.5rem] shrink-0 font-semibold">{label}:</span><span>{children || '—'}</span></div>;
}

function PatternBoxes() {
  return <div className="grid w-24 grid-cols-3 gap-2">{Array.from({ length: 9 }, (_, i) => <span key={i} className="block aspect-square border-2 border-slate-900" />)}</div>;
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
  return <article className="min-h-[270mm] rounded-lg border border-slate-700 bg-white p-3 text-[14.5px] leading-snug print:min-h-0 print:rounded-none print:p-2">
    <header className="grid grid-cols-3 items-start border-b border-slate-700 pb-2">
      <div className="text-xs text-slate-500">{formatDateTime(job.createdAt)}</div>
      <div className="text-center"><div className="font-bold">Inward Slip</div><ShopHeader branch={job.branch} compact /></div>
      <div className="text-right"><div className="font-semibold uppercase">{copy === 'customer' ? 'Customer Copy' : 'Office Copy'}</div><div className="font-mono text-lg font-bold">{serial(job.jobNumber)}</div></div>
    </header>
    <div className="grid grid-cols-3 gap-x-5 border-b border-slate-700 py-2">
      <div className="space-y-1"><Row label="Date">{formatDateTime(job.createdAt)}</Row><Row label="Customer">{job.customer.name}</Row><Row label="Address">{job.customer.address ?? job.customer.city}</Row></div>
      <div className="space-y-1"><Row label="Job No.">{serial(job.jobNumber)}</Row><Row label="Mobile">{job.customer.phone}</Row><Row label="Alternate">{job.customer.altPhone}</Row></div>
      <div className="space-y-1"><Row label="Inwarder">{job.inwardBy?.name ?? job.createdBy.name}</Row><Row label="Engineer">{job.assignedEngineer?.name}</Row></div>
    </div>
    <div className="grid grid-cols-3 gap-x-5 gap-y-1 border-b border-slate-700 py-2">
      <Row label={job.jobType === 'ACCESSORY' ? 'Accessory' : 'Product'}>{product}</Row><Row label="Colour">{job.color}</Row><Row label="Type">{job.jobType === 'MOBILE' ? 'Mobile' : 'Accessory'}</Row>
      {job.imei && <Row label="IMEI 1"><span className="font-mono">{job.imei}</span></Row>}
      {job.imei2 && <Row label="IMEI 2"><span className="font-mono">{job.imei2}</span></Row>}
      {job.serialNumber && <Row label="Serial No."><span className="font-mono">{job.serialNumber}</span></Row>}
    </div>
    <div className="grid min-h-28 grid-cols-2 gap-5 border-b border-slate-700 py-2">
      <div><div className="border-b border-slate-400 font-semibold">Problem</div><p className="pt-1">{job.faults.map((f) => f.name).join(', ')}</p><p>{job.customerComplaint}</p></div>
      <div><div className="border-b border-slate-400 font-semibold">Remark</div><p className="pt-1">{job.physicalConditionRemark ?? job.conditionNotes}</p></div>
    </div>
    <div className="grid grid-cols-3 gap-5 border-b border-slate-700 py-4">
      <div className="space-y-1">
        <PrintCheckbox checked={accessoryChecked('SIM Card', 'SIM')}>SIM Card Return</PrintCheckbox>
        <PrintCheckbox checked={accessoryChecked('Memory Card', 'Memory')}>Memory Card Return</PrintCheckbox>
        <PrintCheckbox checked={accessoryChecked('Back Cover', 'Cover')}>Back Cover Return</PrintCheckbox>
        {otherAccessories.map((accessory) => <PrintCheckbox key={accessory} checked>{accessory} Return</PrintCheckbox>)}
        <PrintCheckbox checked={!accessories.length}>No accessory received</PrintCheckbox>
      </div>
      <div className="space-y-1"><PrintCheckbox checked={job.phoneDamaged}>Device Damaged</PrintCheckbox><PrintCheckbox checked={job.warranty === 'IN_WARRANTY'}>In Warranty</PrintCheckbox><PrintCheckbox checked={job.warranty === 'OUT_OF_WARRANTY'}>Out Warranty</PrintCheckbox></div>
      <div>
        <div className="mb-3 flex items-end gap-2"><span className="font-semibold">Password:</span><span className="min-w-28 flex-1 border-b border-slate-900 px-1 font-mono">{job.devicePassword}</span></div>
        <div className="mb-2 font-semibold">Pattern:</div><PatternBoxes />
      </div>
    </div>
    <div className="border-b border-slate-700 py-2 font-bold">Estimate Amount: {job.estimatedAmount !== null ? formatCurrency(job.estimatedAmount) : 'To be decided'}</div>
    {!!advance.length && <div className="border-b border-slate-300 py-2">Advance: <strong>{formatCurrency(advance.reduce((s, p) => s + p.amount, 0))}</strong> ({advance.map((p) => PAYMENT_MODE_LABELS[p.mode]).join(', ')})</div>}
    {(job.warrantyPeriod || job.warrantyTerms) && <div className="border-b border-slate-300 py-2 text-xs"><strong>Repair warranty:</strong> {job.warrantyPeriod || 'As stated'}{job.warrantyTerms && ` — ${job.warrantyTerms}`}</div>}
    <div lang="mr" className="py-3 text-[12px] leading-relaxed text-slate-800">
      <strong>सुचना:</strong>
      <p>१) पावती आणल्याशिवाय मोबाईल मिळणार नाही.</p>
      <p>२) आऊट वारंटी मोबाईल ३० दिवसाचे आत घेऊन जाणे.</p>
      <p>३) आऊट वारंटी मोबाईलमध्ये जी तक्रार आहे, त्यापेक्षा तक्रार वाढू शकते. किंवा मोबाईल बंद पडू शकतो.</p>
      <p>४) मोबाईल रिपेयर झाल्यानंतर मोबाईल चेक करून घेणे. नंतर कुठलीही तक्रार ऐकून घेतल्या जाणार नाही.</p>
      <p>५) खर्च वाढू शकतो.</p>
    </div>
    <footer className="mt-8 flex justify-between border-t border-slate-700 pt-10 text-xs font-semibold"><span>Customer Signature</span><span>Authorised Signature</span></footer>
  </article>;
}
