import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RWR_REASON_LABELS, RWR_REASONS, type JobDto, type RwrReason } from '@msm/shared';
import { Field, inputClass } from '@/components/ui/Field';
import { FormActions } from '@/components/ui/FormActions';
import { api, ApiError } from '@/lib/api-client';
import { compressImage } from '@/lib/image';
import { PhotoPicker } from './PhotoPicker';

export function SpareHoldForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [part, setPart] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/spare-hold`, { part, note: note.trim() || null }),
    onSuccess: () => {
      toast.success('Marked as spare not available');
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (part.trim().length < 2) return setError('Enter the part needed');
        save.mutate();
      }}
      className="space-y-4"
    >
      <Field label="Part needed" required error={error}>
        <input value={part} onChange={(e) => setPart(e.target.value)} autoFocus className={inputClass} placeholder={`e.g. Display – ${job.brand.name} ${job.model.name}`} />
      </Field>
      <Field label="Note">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputClass} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Mark spare not available" />
    </form>
  );
}

export function SpareReceivedForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/spare-received`, { note: note.trim() || null }),
    onSuccess: () => {
      toast.success('Spare received — job resumed');
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="space-y-4">
      <p className="text-sm text-slate-600">Part: {job.sparePart}</p>
      <Field label="Note">
        <input value={note} onChange={(e) => setNote(e.target.value)} autoFocus className={inputClass} placeholder="e.g. Received from main store" />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Spare received — resume" />
    </form>
  );
}

/** Return without repair: reason, explanation and motherboard photos are all compulsory. */
export function RwrForm({ job, onDone }: { job: JobDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const defaultReason: RwrReason | '' =
    job.status === 'CUSTOMER_REJECTED' ? 'CUSTOMER_REJECTED' : job.status === 'SPARE_PENDING' ? 'SPARE_NOT_AVAILABLE' : '';
  const [reason, setReason] = useState<RwrReason | ''>(defaultReason);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<{ reason?: string; note?: string; photos?: string }>({});

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('data', JSON.stringify({ reason, note }));
      for (const f of photos) form.append('photos', await compressImage(f), f.name.replace(/\.\w+$/, '') + '.jpg');
      return api.post(`/jobs/${job.id}/rwr`, form);
    },
    onSuccess: () => {
      toast.success('Returned without repair — phone goes back to the counter');
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err) => {
      const details = err instanceof ApiError ? (err.details as Record<string, string[]> | undefined) : undefined;
      if (details) setErrors({ reason: details.reason?.[0], note: details.note?.[0], photos: details.photos?.[0] });
      else toast.error(err.message);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const errs = {
          reason: reason ? undefined : 'Select a reason',
          note: note.trim().length >= 5 ? undefined : 'Explain why the phone is returned unrepaired',
          photos: photos.length ? undefined : 'Motherboard / internal photo is compulsory',
        };
        setErrors(errs);
        if (!errs.reason && !errs.note && !errs.photos) save.mutate();
      }}
      className="space-y-4"
    >
      <Field label="Reason" required error={errors.reason}>
        <select value={reason} onChange={(e) => setReason(e.target.value as RwrReason)} className={inputClass}>
          <option value="">Select reason</option>
          {RWR_REASONS.map((r) => (
            <option key={r} value={r}>
              {RWR_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Explanation" required error={errors.note}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder="e.g. Board already tampered at another shop, not safe to repair"
        />
      </Field>
      <PhotoPicker label="Motherboard / internal photos" required multiple files={photos} onChange={setPhotos} error={errors.photos} />
      <p className="text-xs text-slate-500">These photos are kept as proof of the condition in which the phone was returned.</p>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Return without repair" />
    </form>
  );
}
