import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CloudUpload, Images } from 'lucide-react';
import { PHOTO_MAX_PER_UPLOAD } from '@msm/shared';
import { CameraCapture } from './CameraCapture';

type Props = {
  label: string;
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  required?: boolean;
  error?: string;
};

/** Phones/tablets open their own camera app; the counter PC uses the live webcam dialog. */
const isTouchDevice = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** "Upload images" box with Gallery and Camera buttons, thumbnails and remove buttons. */
export function PhotoPicker({ label, files, onChange, multiple = false, required, error }: Props) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const max = multiple ? PHOTO_MAX_PER_UPLOAD : 1;
  const add = (list: FileList | null) => {
    if (!list) return;
    const images = Array.from(list).filter((f) => f.type.startsWith('image/'));
    onChange(multiple ? [...files, ...images].slice(0, max) : images.slice(0, 1));
  };
  const openCamera = () => (isTouchDevice() ? cameraRef.current?.click() : setCameraOpen(true));
  const full = files.length >= max;

  const button = 'flex flex-1 items-center justify-center gap-2 rounded-lg bg-white px-3 py-3 text-sm font-medium text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-brand-700 hover:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold text-slate-700">
        {label}
        {required ? <span className="text-red-500"> *</span> : <span className="font-normal text-slate-400"> (optional)</span>}
      </div>
      <div className={`rounded-xl border p-3 ${error ? 'border-red-300 bg-red-50/40' : 'border-slate-300 bg-slate-50/40'}`}>
        <div className="mb-2.5 flex items-center gap-2 text-sm font-medium text-slate-600">
          <CloudUpload className="size-5 text-brand-700" aria-hidden />
          Upload {label.toLowerCase()}
          {multiple && <span className="ml-auto text-xs font-normal text-slate-400">{files.length}/{max}</span>}
        </div>
        <div className="flex gap-3">
          <button type="button" disabled={full} onClick={() => galleryRef.current?.click()} className={button}>
            <Images className="size-5 text-brand-700" aria-hidden />
            Gallery
          </button>
          <button type="button" disabled={full} onClick={openCamera} className={button}>
            <Camera className="size-5 text-brand-700" aria-hidden />
            Camera
          </button>
        </div>
        {previews.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {previews.map((url, i) => (
              <div key={url} className="relative size-20 overflow-hidden rounded-md ring-1 ring-slate-200">
                <img src={url} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                  aria-label="Remove photo"
                  className="absolute top-1 right-1 rounded-full bg-black/60 px-1.5 text-xs text-white hover:bg-black/80"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <CameraCapture
        open={cameraOpen}
        title={label}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => onChange(multiple ? [...files, file].slice(0, max) : [file])}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
