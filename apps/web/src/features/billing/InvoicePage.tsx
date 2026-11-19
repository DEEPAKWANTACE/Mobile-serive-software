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

/** Printable / shareable invoice laid out like the shop's paper bill (A4). */
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
  const cell = 'border border-black px-2.5 py-1.5';
  const head = `${cell} bg-[#e2e2e2] font-bold`;

  const sheet = (copy: 'customer' | 'office', ref?: Ref<HTMLElement>) => (
    <article ref={ref} className="bg-white p-8 font-[Arial,Helvetica,sans-serif] text-[13px] leading-snug text-black shadow-sm ring-1 ring-slate-200 print:p-0 print:shadow-none print:ring-0">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {shop?.hasLogo && <AuthImage src={`/settings/shop/logo?v=${shop.logoVersion}`} alt="" className="h-14 w-auto max-w-20 object-contain" />}
          <div className="min-w-0">
            <div className="text-[22px] leading-tight font-bold uppercase">{shopName}</div>
            {address && <div className="text-[11px]">Address : {address}</div>}
            {phone && <div className="text-[11px]">Phone : {phone}</div>}
            {shop?.gstin && <div className="text-[11px]">GSTIN : {shop.gstin}</div>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[22px] leading-tight font-bold">INVOICE</div>
          <div className="text-[11px] font-bold">Invoice No : {inv.invoiceNumber}</div>
          <div className="text-[11px]">Date : {dateTime(inv.createdAt)}</div>
          {copy === 'office' && <div className="text-[10px] font-semibold uppercase">Office copy</div>}
          {qr && <img src={qr} alt="Invoice QR code" className="mt-1 ml-auto size-20" />}
        </div>
      </header>

      <hr className="mt-3 border-black" />

      <section className="mt-3">
        <div className="font-bold">Bill To:</div>
        <div className="mt-1 flex justify-between gap-4">
          <span>Name : {inv.customer.name}</span>
          <span>Phone : {inv.customer.phone}</span>
        </div>
      </section>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="text-left">
            <th className={`${head} w-[36%]`}>Model</th>
            <th className={`${head} w-[36%]`}>Problems in Device</th>
            <th className={head}>Delivery Date</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cell}>
              {inv.job.device}
              {inv.job.imei && <div className="font-mono text-[11px]">IMEI {inv.job.imei}</div>}
              {inv.job.serialNumber && <div className="font-mono text-[11px]">S/N {inv.job.serialNumber}</div>}
            </td>
            <td className={cell}>{inv.job.problems}</td>
            <td className={cell}>{inv.job.deliveredAt ? dateOnly(inv.job.deliveredAt) : '-'}</td>
          </tr>
        </tbody>
      </table>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="text-left">
            <th className={head}>Repairing Cost</th>
            <th className={`${head} w-32 text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.job.rwrReason && (
            <tr>
              <td className={cell} colSpan={2}>Returned without repair — {RWR_REASON_LABELS[inv.job.rwrReason as RwrReason] ?? inv.job.rwrReason}</td>
            </tr>
          )}
          {inv.lines.length ? (
            inv.lines.map((l, i) => (
              <tr key={i}>
                <td className={cell}>
                  {l.description}
                  {l.partCode && <span className="ml-1 font-mono text-[11px]">({l.partCode})</span>}
                  {l.warranty && <span className="ml-1 text-[11px]">· Warranty {l.warranty}</span>}
                </td>
                <td className={`${cell} text-right`}>{money(l.amount)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td className={cell}>No charge</td>
              <td className={`${cell} text-right`}>{money(0)}</td>
            </tr>
          )}
          {inv.discount > 0 && (
            <tr>
              <td className={cell}>Discount{inv.discountReason && ` (${inv.discountReason})`}</td>
              <td className={`${cell} text-right`}>− {money(inv.discount)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <table className="w-[38%] min-w-56 border-collapse">
          <tbody>
            <tr><td className={cell}>Total</td><td className={`${cell} font-bold`}>{money(inv.total)}</td></tr>
            <tr><td className={cell}>Amount Paid</td><td className={`${cell} font-bold`}>{money(inv.paid)}</td></tr>
            <tr><td className={cell}>Due Payment</td><td className={`${cell} font-bold`}>{money(inv.due)}</td></tr>
          </tbody>
        </table>
      </div>

      <section className="mt-4">
        <div className="font-bold">Total Amount in Words</div>
        <div>{amountInWords(inv.total)}</div>
      </section>

      {(inv.job.warrantyPeriod || inv.job.warrantyTerms) && (
        <section className="mt-3">
          <div className="font-bold">Repair Warranty</div>
          <div>{inv.job.warrantyPeriod ?? 'As stated'}{inv.job.warrantyTerms && ` — ${inv.job.warrantyTerms}`}</div>
        </section>
      )}

      <section className="mt-3">
        <div className="font-bold">Terms &amp; Conditions</div>
        <div className="whitespace-pre-line">{terms}</div>
      </section>

      <footer className="mt-14 flex justify-between gap-8 text-[11px] font-bold">
        <div className="w-44 border-t border-black pt-2 text-center">Customer Signature</div>
        <div className="w-44 border-t border-black pt-2 text-center">Authorized Signature</div>
      </footer>
      <div className="mt-6 text-[10px] text-slate-600">
        Job {inv.job.jobNumber}{inv.job.deliveredTo && ` · Delivered to ${inv.job.deliveredTo}`} · Billed by {inv.createdBy.name}
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
