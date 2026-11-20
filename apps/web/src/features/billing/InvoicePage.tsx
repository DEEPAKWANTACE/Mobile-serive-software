import { useEffect, useRef, useState, type Ref } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Printer, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { RWR_REASON_LABELS, type InvoiceDto, type RwrReason } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api-client';
import { amountInWords } from '@/lib/format';
import { AuthImage } from '@/features/jobs/AuthImage';
import { useShopSettings } from '@/features/settings/useShopSettings';

const DEFAULT_TERMS = 'We are not liable for any loss or damage if the handset is not collected within 10 days of service.';

const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(',', '');
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Printable / shareable invoice laid out like the shop's boxed paper bill (A5). */
export function InvoicePage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const requested = params.get('copy');
  const [target, setTarget] = useState<PrintTarget>(requested === 'office' || requested === 'both' ? requested : 'customer');
  const [sharing, setSharing] = useState(false);
  const [printing, setPrinting] = useState(false);
  /** Off-screen, fixed-width copies used to render the PDF (print + share). */
  const pdfSheets = useRef<Partial<Record<'customer' | 'office', HTMLElement | null>>>({});
  const printFrame = useRef<HTMLIFrameElement | null>(null);
  const { data: shop } = useShopSettings();
  const { data: inv, isLoading, error } = useQuery({ queryKey: ['jobs', id, 'invoice'], queryFn: () => api.get<InvoiceDto>(`/jobs/${id}/invoice`) });
  const [qr, setQr] = useState<string>();

  useEffect(() => {
    if (!inv) return;
    const text = [
      `Invoice ${inv.invoiceNumber}`,
      `Job ${inv.job.jobNumber}`,
      `${inv.customer.name} ${inv.customer.phone}`,
      `${inv.job.device}`,
      `Total Rs ${money(inv.total)} | Paid Rs ${money(inv.paid)}`,
      shop?.shopName ?? inv.branch.name,
    ].join('\n');
    void import('qrcode').then((QR) => QR.toDataURL(text, { margin: 0, width: 220, errorCorrectionLevel: 'M' })).then(setQr);
  }, [inv, shop?.shopName]);

  /** Renders the requested copies (one A5 page each) from the off-screen sheets into a PDF. */
  const buildPdf = async (copies: ('customer' | 'office')[]) => {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);
    await document.fonts.ready;
    const pdf = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 6;
    for (const [i, copy] of copies.entries()) {
      const el = pdfSheets.current[copy];
      if (!el) throw new Error('Invoice not ready');
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      // Fit inside the printable area without stretching.
      const ratio = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height);
      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      if (i > 0) pdf.addPage('a5', 'portrait');
      toGrayscale(canvas);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (pageW - w) / 2, margin, w, h);
    }
    return pdf;
  };

  const printCopies = async (next: PrintTarget) => {
    if (!inv || printing) return;
    setTarget(next);
    setPrinting(true);
    try {
      const pdf = await buildPdf(next === 'both' ? ['customer', 'office'] : [next]);
      const fileName = `Invoice-${inv.invoiceNumber}.pdf`;
      if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        // Mobile browsers cannot print a PDF from a page: hand it to the share sheet (Print / printer app) or download it.
        const file = new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: fileName });
        else { pdf.save(fileName); toast.success('Invoice PDF downloaded — open it and print'); }
        return;
      }
      pdf.autoPrint();
      const url = URL.createObjectURL(pdf.output('blob'));
      printFrame.current?.remove();
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      frame.src = url;
      frame.onload = () => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          pdf.save(fileName);
        }
      };
      document.body.appendChild(frame);
      printFrame.current = frame;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('Could not create the invoice PDF');
    } finally {
      setPrinting(false);
    }
  };
  // Opened from the "Delivered" toast with ?print=1: print the requested copies once the invoice has loaded.
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (inv && qr && params.get('print') === '1' && !autoPrinted.current) {
      autoPrinted.current = true;
      requestAnimationFrame(() => void printCopies(target));
    }
  });
  useEffect(() => () => printFrame.current?.remove(), []);

  const share = async () => {
    if (!inv) return;
    setSharing(true);
    try {
      const pdf = await buildPdf(['customer']);
      const fileName = `Invoice-${inv.invoiceNumber}.pdf`;
      const file = new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
      const shareText = `${shop?.shopName ?? inv.branch.name} — Invoice ${inv.invoiceNumber} for ${inv.job.device}. Total ₹${money(inv.total)}.`;
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName, text: shareText });
      } else {
        pdf.save(fileName);
        toast.success('Invoice PDF downloaded — attach it in WhatsApp / email');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('Could not create the PDF');
    } finally {
      setSharing(false);
    }
  };
  if (isLoading) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  if (error || !inv) return <div className="p-10 text-center text-slate-600">{error?.message ?? 'Invoice not found'}</div>;

  const shopName = shop?.shopName ?? inv.branch.name;
  const address = shop?.address ?? inv.branch.address;
  const phone = shop?.phone ?? inv.branch.phone;
  const terms = shop?.invoiceTerms?.trim() || DEFAULT_TERMS;
  const blue = 'bg-black text-white';
  /** Item-table cell: only vertical rules, like the paper bill. */
  const col = 'border-x border-black px-1.5';
  const lines = inv.lines.length ? inv.lines : [{ description: 'No charge', partCode: null, warranty: null, amount: 0 }];
  const field = (label: string, value: string, mono = false) => (
    <tr>
      <td className="pr-1 align-top whitespace-nowrap">{label}</td>
      <td className={mono ? 'font-mono text-[12px] break-all print:text-[9px]' : ''}>: {value}</td>
    </tr>
  );
  const total = (label: string, value: string, bold = false) => (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}><span>{label}</span><span>{value}</span></div>
  );

  const sheet = (copy: 'customer' | 'office', ref?: Ref<HTMLElement>) => (
    <article ref={ref} className="bg-white p-6 grayscale font-[Arial,Helvetica,sans-serif] text-[13px] leading-snug text-black shadow-sm ring-1 ring-slate-200 [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:box-border print:w-[136mm] print:break-inside-avoid print:p-0 print:text-[10px] print:leading-tight print:shadow-none print:ring-0">
      <div className="border-[1.5px] border-black">
        {/* Title band */}
        <div className="border-b border-black bg-white py-1 text-center">
          <div className="text-[16px] leading-tight font-bold print:text-[13px]">INVOICE</div>
          <div className="text-[11px] font-bold uppercase print:text-[8.5px]">{copy === 'office' ? 'Office copy' : 'Customer copy'}</div>
        </div>

        {/* Shop | customer & device */}
        <div className="grid grid-cols-2 border-b-2 border-black">
          <div className="flex items-start gap-2 px-1.5 py-1.5">
            {shop?.hasLogo && <AuthImage src={`/settings/shop/logo?v=${shop.logoVersion}`} alt="" className="h-12 w-auto max-w-16 object-contain print:h-[10mm] print:max-w-[12mm]" />}
            <div className="min-w-0 text-[10px] leading-tight break-words print:text-[8px]">
              <div className="text-[17px] leading-tight font-bold uppercase print:text-[12px]">{shopName}</div>
              {address && <div>{address}</div>}
              {phone && <div>Phone : {phone}</div>}
              {shop?.email && <div>E-Mail Id : {shop.email}</div>}
              <div className="mt-1 text-[12px] font-bold print:text-[9px]">Branch : {inv.branch.name}</div>
            </div>
          </div>
          <div className="flex min-w-0 items-start justify-between gap-2 px-1.5 py-1.5 print:gap-1">
            <table className="min-w-0 break-words">
              <tbody>
                <tr>
                  <td className="pr-1 align-top text-[15px] whitespace-nowrap print:text-[11px]">Customer :</td>
                  <td className="text-[15px] leading-tight font-bold uppercase print:text-[11px]">{inv.customer.name}</td>
                </tr>
                {field('Phone No.', inv.customer.phone)}
                {inv.customer.address && field('Address', inv.customer.address)}
                {field('Model', inv.job.device)}
                {inv.job.imei && field('IMEI', inv.job.imei, true)}
                {inv.job.serialNumber && field('S/N', inv.job.serialNumber, true)}
                {field('Problem', inv.job.problems)}
                {field('Delivery', inv.job.deliveredAt ? dateOnly(inv.job.deliveredAt) : '-')}
              </tbody>
            </table>
            {qr && <img src={qr} alt="Invoice QR code" className="size-16 shrink-0 print:size-[15mm]" />}
          </div>
        </div>

        {/* Job / invoice number / date */}
        <div className="flex flex-wrap justify-between gap-x-4 border-b border-black px-1.5 py-0.5 text-[12px] font-bold print:gap-x-2 print:text-[9px]">
          <span>Job No. : {inv.job.jobNumber}</span>
          <span>Invoice No. : {inv.invoiceNumber}</span>
          <span>Invoice Date : {dateTime(inv.createdAt)}</span>
        </div>

        {/* Items */}
        <table className="w-full table-fixed border-collapse">
          <colgroup><col className="w-[9%]" /><col /><col className="w-[18%]" /><col className="w-[20%]" /></colgroup>
          <thead>
            <tr className={blue}>
              <th className="px-1.5 py-1 text-left">S.no.</th>
              <th className="px-1.5 py-1 text-left">Repairing Cost</th>
              <th className="px-1.5 py-1 text-right">Warranty</th>
              <th className="px-1.5 py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="align-top">
            {inv.job.rwrReason && (
              <tr>
                <td className={`${col} border-l-0`} />
                <td className={`${col} pt-1`} colSpan={2}>Returned without repair — {RWR_REASON_LABELS[inv.job.rwrReason as RwrReason] ?? inv.job.rwrReason}</td>
                <td className={`${col} border-r-0`} />
              </tr>
            )}
            {lines.map((l, i) => (
              <tr key={i}>
                <td className={`${col} border-l-0 pt-1 text-right`}>{i + 1}</td>
                <td className={`${col} pt-1 break-words`}>
                  {l.description}
                  {l.partCode && <span className="ml-1 font-mono text-[11px]">({l.partCode})</span>}
                </td>
                <td className={`${col} pt-1 text-right`}>{l.warranty ?? ''}</td>
                <td className={`${col} border-r-0 pt-1 text-right`}>{money(l.amount)}</td>
              </tr>
            ))}
            {/* Filler keeps the column rules running down like the paper bill. */}
            <tr className="h-24 print:h-[16mm]">
              <td className={`${col} border-l-0`} /><td className={col} /><td className={col} /><td className={`${col} border-r-0`} />
            </tr>
            <tr className="border-t border-black font-bold">
              <td colSpan={2} />
              <td className="border-l border-black px-1.5 py-0.5">Sub Total</td>
              <td className="px-1.5 py-0.5 text-right">{money(inv.subtotal)}</td>
            </tr>
          </tbody>
        </table>

        {/* Words, terms, signatures | totals */}
        <div className="flex border-t border-black">
          <div className="flex min-w-0 flex-1 flex-col px-1.5 py-1">
            <div className="font-bold">Total Amount in Words : <span className="font-normal">{amountInWords(inv.total)}</span></div>
            {(inv.job.warrantyPeriod || inv.job.warrantyTerms) && (
              <div className="mt-1.5 text-[11px]">
                <span className="font-bold italic underline">Repair Warranty:</span>{' '}
                {inv.job.warrantyPeriod ?? 'As stated'}{inv.job.warrantyTerms && ` — ${inv.job.warrantyTerms}`}
              </div>
            )}
            <div className="mt-1.5 text-[11px] font-bold italic underline">Terms &amp; Conditions:</div>
            <div className="text-[10px] whitespace-pre-line italic print:text-[8px]">{terms}</div>
            <div className="mt-2 text-right text-[12px] font-bold print:text-[9px]">For {shopName}</div>
            <div className="mt-10 flex items-end justify-between gap-2 text-[12px] font-bold print:mt-[9mm] print:text-[9px]">
              <span>Customer Signature</span>
              <span>Authorised Signatory</span>
            </div>
          </div>
          <div className="flex w-[38%] shrink-0 flex-col border-l border-black">
            <div className="flex-1 space-y-0.5 px-1.5 py-1 text-[12px] print:text-[9.5px]">
              {total(`Discount${inv.discountReason ? ` (${inv.discountReason})` : ''}`, money(inv.discount))}
              {total('Amount Paid', money(inv.paid))}
              {total('Due Payment', money(inv.due), inv.due > 0)}
            </div>
            <div className={`${blue} flex items-center justify-between gap-2 border-t border-black px-1.5 py-1.5`}>
              <span className="font-bold">Grand Total</span>
              <span className="text-[17px] font-bold print:text-[12px]">{money(inv.total)}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-1 text-[10px] print:text-[8px]">
        {inv.job.deliveredTo && `Delivered to ${inv.job.deliveredTo} · `}Billed by {inv.createdBy.name}
      </div>
    </article>
  );

  return (
    <div className="mx-auto max-w-3xl pb-24 print:pb-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to={`/jobs/${inv.job.id}`} className="text-sm text-slate-500 hover:underline">← Back to job</Link>
        <Button size="sm" variant="secondary" disabled={printing} onClick={() => void printCopies('both')}>Print with office copy</Button>
      </div>

      <div className={target === 'office' ? 'print:hidden' : ''}>{sheet('customer')}</div>
      <div className={`hidden ${target === 'customer' ? '' : 'print:block print:break-before-page'}`}>{sheet('office')}</div>

      {/* Fixed-width copies rendered off-screen so the PDF looks the same on every device. */}
      <div aria-hidden className="pointer-events-none fixed top-0 left-[-10000px] w-[720px] print:hidden">
        {sheet('customer', (el) => { pdfSheets.current.customer = el; })}
        {sheet('office', (el) => { pdfSheets.current.office = el; })}
      </div>

      {/* Bottom action bar, like the shop's mobile bill viewer. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-slate-900 print:hidden">
        <div className="mx-auto flex max-w-3xl">
          <button type="button" onClick={() => void printCopies('customer')} disabled={printing} className="flex flex-1 items-center justify-center gap-2 py-3.5 text-sm font-medium text-white hover:bg-white/10">
            <Printer className="size-5" /> {printing ? 'Preparing…' : 'Print'}
          </button>
          <button type="button" onClick={() => void share()} disabled={sharing} className="flex flex-1 items-center justify-center gap-2 py-3.5 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-60">
            <Share2 className="size-5" /> {sharing ? 'Preparing PDF…' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  );
}

type PrintTarget = 'both' | 'customer' | 'office';

/** Printed / shared invoices are black and white: drop any colour (logo, QR, fills) from the rendered page. */
function toGrayscale(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(img, 0, 0);
}
