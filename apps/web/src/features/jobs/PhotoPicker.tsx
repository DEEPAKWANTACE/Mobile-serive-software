import { useEffect, useMemo, useRef, useState } from 'react';
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

/** Pick or capture photos (opens the camera on phones/tablets) with thumbnails and remove buttons. */
export function PhotoPicker({ label, files, onChange, multiple = false, required, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const max = multiple ? PHOTO_MAX_PER_UPLOAD : 1;
  const add = (list: FileList | null) => {
    if (!list) return;
    const images = Array.from(list).filter((f) => f.type.startsWith('image/'));
    onChange(multiple ? [...files, ...images].slice(0, max) : images.slice(0, 1));
  };

  return (
    <div>
      <div className="mb-1 text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {previews.map((url, i) => (
          <div key={url} className="relative size-24 overflow-hidden rounded-md ring-1 ring-slate-200">
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
        {files.length < max && (
          <>
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="flex size-24 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500 hover:text-brand-600"
            >
              <span className="text-xl">📷</span>
              Camera
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex size-24 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500 hover:text-brand-600"
            >
              <span className="text-xl">＋</span>
              Upload
            </button>
          </>
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
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={multiple}
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
