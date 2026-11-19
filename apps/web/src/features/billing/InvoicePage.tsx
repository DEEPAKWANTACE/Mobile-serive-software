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

/** Printable / shareable invoice laid out like the shop's boxed paper bill (A4). */
export function InvoicePage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const requested = params.get('copy');
  const [target, setTarget] = useState<PrintTarget>(requested === 'office' || requested === 'both' ? requested : 'customer');
  const [sharing, setSharing] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
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

  const printCopies = (next: PrintTarget) => {
    setTarget(next);
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      await document.fonts.ready;
      window.print();
    }));
  };
  // Opened from the "Delivered" toast with ?print=1: print the requested copies once the invoice has loaded.
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (inv && qr && params.get('print') === '1' && !autoPrinted.current) {
      autoPrinted.current = true;
      printCopies(target);
    }
  });

  const share = async () => {
    if (!inv || !sheetRef.current) return;
    setSharing(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);
      const canvas = await html2canvas(sheetRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const w = pageW - margin * 2;
      const h = Math.min((canvas.height * w) / canvas.width, pageH - margin * 2);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, w, h);
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
  const blue = 'bg-[#1d5fb8] text-white';
  /** Item-table cell: only vertical rules, like the paper bill. */
  const col = 'border-x border-black px-1.5';
  const lines = inv.lines.length ? inv.lines : [{ description: 'No charge', partCode: null, warranty: null, amount: 0 }];
  const field = (label: string, value: string, mono = false) => (
    <tr>
      <td className="pr-1 align-top whitespace-nowrap">{label}</td>
      <td className={mono ? 'font-mono text-[12px]' : ''}>: {value}</td>
    </tr>
  );
  const total = (label: string, value: string, bold = false) => (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}><span>{label}</span><span>{value}</span></div>
  );

  const sheet = (copy: 'customer' | 'office', ref?: Ref<HTMLElement>) => (
    <article ref={ref} className="bg-white p-6 font-[Arial,Helvetica,sans-serif] text-[13px] leading-snug text-black shadow-sm ring-1 ring-slate-200 print:p-0 print:shadow-none print:ring-0">
      <div className="border-[1.5px] border-black">
        {/* Title band */}
        <div className="border-b border-black bg-[#e1eaf8] py-1 text-center">
          <div className="text-[16px] leading-tight font-bold">INVOICE</div>
          <div className="text-[11px] font-bold uppercase">{copy === 'office' ? 'Office copy' : 'Customer copy'}</div>
        </div>

        {/* Shop | customer & device */}
        <div className="grid grid-cols-2 border-b-2 border-black">
          <div className="flex items-start gap-2 px-1.5 py-1.5">
            {shop?.hasLogo && <AuthImage src={`/settings/shop/logo?v=${shop.logoVersion}`} alt="" className="h-12 w-auto max-w-16 object-contain" />}
            <div className="min-w-0 text-[10px] leading-tight">
              <div className="text-[17px] leading-tight font-bold uppercase">{shopName}</div>
              {address && <div>{address}</div>}
              {phone && <div>Phone : {phone}</div>}
              {shop?.email && <div className="text-[#1d5fb8]">E-Mail Id : {shop.email}</div>}
              <div className="mt-1 text-[12px] font-bold">Branch : {inv.branch.name}</div>
            </div>
          </div>
          <div className="flex items-start justify-between gap-2 px-1.5 py-1.5">
            <table>
              <tbody>
                <tr>
                  <td className="pr-1 align-top text-[15px] whitespace-nowrap">Customer :</td>
                  <td className="text-[15px] leading-tight font-bold uppercase">{inv.customer.name}</td>
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
            {qr && <img src={qr} alt="Invoice QR code" className="size-16 shrink-0" />}
          </div>
        </div>

        {/* Job / invoice number / date */}
        <div className="flex justify-between gap-4 border-b border-black px-1.5 py-0.5 text-[12px] font-bold">
          <span>Job No. : {inv.job.jobNumber}</span>
          <span>Invoice No. : {inv.invoiceNumber}</span>
          <span>Invoice Date : {dateTime(inv.createdAt)}</span>
        </div>

        {/* Items */}
        <table className="w-full border-collapse">
          <colgroup><col className="w-12" /><col /><col className="w-28" /><col className="w-32" /></colgroup>
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
                <td className={`${col} pt-1`}>
                  {l.description}
                  {l.partCode && <span className="ml-1 font-mono text-[11px]">({l.partCode})</span>}
                </td>
                <td className={`${col} pt-1 text-right`}>{l.warranty ?? ''}</td>
                <td className={`${col} border-r-0 pt-1 text-right`}>{money(l.amount)}</td>
              </tr>
            ))}
            {/* Filler keeps the column rules running down like the paper bill. */}
            <tr className="h-24">
              <td className={`${col} border-l-0`} /><td className={col} /><td className={col} /><td className={`${col} border-r-0`} />
            </tr>
            <tr className="border-t border-black font-bold text-[#1d5fb8]">
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
            <div className="text-[10px] whitespace-pre-line italic">{terms}</div>
            <div className="mt-2 text-right text-[12px] font-bold">For {shopName}</div>
            <div className="mt-10 flex items-end justify-between gap-4 text-[12px] font-bold">
              <span>Customer Signature</span>
              <span>Authorised Signatory</span>
            </div>
          </div>
          <div className="flex w-60 shrink-0 flex-col border-l border-black">
            <div className="flex-1 space-y-0.5 px-1.5 py-1 text-[12px]">
              {total(`Discount${inv.discountReason ? ` (${inv.discountReason})` : ''}`, money(inv.discount))}
              {total('Amount Paid', money(inv.paid))}
              {total('Due Payment', money(inv.due), inv.due > 0)}
            </div>
            <div className={`${blue} flex items-center justify-between gap-2 border-t border-black px-1.5 py-1.5`}>
              <span className="font-bold">Grand Total</span>
              <span className="text-[17px] font-bold">{money(inv.total)}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-1 text-[10px] text-slate-600">
        {inv.job.deliveredTo && `Delivered to ${inv.job.deliveredTo} · `}Billed by {inv.createdBy.name}
      </div>
    </article>
  );

  return (
    <div className="mx-auto max-w-3xl pb-24 print:pb-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to={`/jobs/${inv.job.id}`} className="text-sm text-slate-500 hover:underline">← Back to job</Link>
        <Button size="sm" variant="secondary" onClick={() => printCopies('both')}>Print with office copy</Button>
      </div>

      <div className={target === 'office' ? 'print:hidden' : ''}>{sheet('customer', sheetRef)}</div>
      <div className={`hidden ${target === 'customer' ? '' : 'print:block print:break-before-page'}`}>{sheet('office')}</div>

      {/* Bottom action bar, like the shop's mobile bill viewer. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-slate-900 print:hidden">
        <div className="mx-auto flex max-w-3xl">
          <button type="button" onClick={() => printCopies('customer')} className="flex flex-1 items-center justify-center gap-2 py-3.5 text-sm font-medium text-white hover:bg-white/10">
            <Printer className="size-5" /> Print
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
