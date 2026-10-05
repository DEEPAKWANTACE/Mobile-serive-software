import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

type Props = { open: boolean; onClose: () => void; onCapture: (file: File) => void; title?: string };

/**
 * Live webcam capture for the counter PC (customer face, Aadhaar card).
 * Needs a secure context: works on localhost and HTTPS, not plain-HTTP LAN addresses.
 */
export function CameraCapture({ open, onClose, onCapture, title = 'Take photo' }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      {open && <CameraView onClose={onClose} onCapture={onCapture} />}
    </Modal>
  );
}

function CameraView({ onClose, onCapture }: Omit<Props, 'open' | 'title'>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is not available. Use HTTPS (or localhost) and a browser with camera support.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch((e: Error) =>
        setError(e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in the browser.' : 'No camera found.'),
      );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }));
        onClose();
      },
      'image/jpeg',
      0.85,
    );
  };

  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onLoadedData={() => setReady(true)}
        className="mx-auto max-h-[60vh] w-full rounded bg-slate-900 object-contain"
      />
      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>
          Switch camera
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={capture}>
            Capture
          </Button>
        </div>
      </div>
    </div>
  );
}
