import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { ScanBarcode, Ticket } from 'lucide-react';
import { isValidImei } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

/** First valid 15-digit IMEI in scanned text (box labels often read "IMEI1: 35…/IMEI2: 35…"). */
export function extractImei(text: string): string | null {
  const runs = text.match(/\d{15,17}/g) ?? [];
  for (const run of runs) {
    // IMEISV / padded values: try every 15-digit window.
    for (let i = 0; i + 15 <= run.length; i += 1) {
      const candidate = run.slice(i, i + 15);
      if (isValidImei(candidate)) return candidate;
    }
  }
  return null;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value?: string;
  onChange?: (e: { target: { value: string; name?: string } }) => void;
  /** Called with the scanned IMEI (use when the field is not a plain registered input). */
  onScan?: (imei: string) => void;
  invalid?: boolean;
};

/** IMEI text box with a barcode / QR scan button (camera). Works with react-hook-form `register`. */
export const ImeiInput = forwardRef<HTMLInputElement, Props>(function ImeiInput({ onScan, invalid, className, onChange, ...rest }, ref) {
  const [scanning, setScanning] = useState(false);
  const innerRef = useRef<HTMLInputElement | null>(null);

  const apply = (imei: string) => {
    const el = innerRef.current;
    if (el) {
      // Set through the native setter so react-hook-form's registered onChange sees the new value.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, imei);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    onScan?.(imei);
  };

  return (
    <div className="flex items-stretch gap-2">
      <div className="relative min-w-0 flex-1">
        <Ticket className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          ref={(el) => {
            innerRef.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          inputMode="numeric"
          maxLength={15}
          placeholder="Enter 15-digit IMEI"
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 15);
            onChange?.(e);
          }}
          {...rest}
          className={`${inputClass} pl-9! font-mono ${className ?? ''}`}
        />
      </div>
      <button
        type="button"
        onClick={() => setScanning(true)}
        title="Scan IMEI barcode"
        aria-label="Scan IMEI barcode"
        className="grid w-11 shrink-0 place-items-center rounded-lg bg-brand-700 text-white shadow-sm hover:bg-brand-600"
      >
        <ScanBarcode className="size-5" />
      </button>
      {scanning && createPortal(
        <Modal open onClose={() => setScanning(false)} title="Scan IMEI barcode" size="lg">
          <ImeiScanner
            onClose={() => setScanning(false)}
            onResult={(imei) => {
              apply(imei);
              setScanning(false);
            }}
          />
        </Modal>,
        document.body,
      )}
    </div>
  );
});

/** Live camera barcode reader (Code-128 on boxes, the *#06# screen, QR / Data Matrix stickers). */
function ImeiScanner({ onResult, onClose }: { onResult: (imei: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRead, setLastRead] = useState<string | null>(null);
  const done = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    let controls: { stop: () => void } | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is not available. Use HTTPS and a browser with camera support, or type the IMEI.');
      return;
    }
    void (async () => {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      try {
        const c = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
          videoRef.current!,
          (result) => {
            if (!result || done.current) return;
            const text = result.getText();
            const imei = extractImei(text);
            if (imei) {
              done.current = true;
              navigator.vibrate?.(80);
              onResultRef.current(imei);
            } else {
              setLastRead(text);
            }
          },
        );
        if (cancelled) c.stop();
        else controls = c;
      } catch (e) {
        const name = (e as Error).name;
        setError(name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in the browser.' : 'Could not start the camera.');
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  const readPhoto = async (file: File) => {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const url = URL.createObjectURL(file);
    try {
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
      const imei = extractImei(result.getText());
      if (imei) onResult(imei);
      else setLastRead(result.getText());
    } catch {
      setLastRead('No barcode found in the photo');
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600">{error}</p>
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg bg-slate-900">
        <video ref={videoRef} autoPlay playsInline muted className="mx-auto max-h-[60vh] w-full object-contain" />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-20 -translate-y-1/2 rounded-md border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
      </div>
      <p className="text-xs text-slate-600">
        Point the camera at the IMEI barcode on the box, sticker or the <span className="font-mono">*#06#</span> screen. It fills in automatically.
      </p>
      {lastRead && <p className="text-xs text-amber-700">Read “{lastRead.slice(0, 60)}” — not a valid IMEI. Try the IMEI barcode.</p>}
      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>Scan from photo</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void readPhoto(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
