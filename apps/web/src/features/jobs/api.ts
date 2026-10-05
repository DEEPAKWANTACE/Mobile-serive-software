import { useQuery } from '@tanstack/react-query';
import type { JobDto, JobHistoryEntryDto, JobPhotoDto, PhotoKind } from '@msm/shared';
import { api } from '@/lib/api-client';
import { compressImage } from '@/lib/image';

export const useJob = (id: string) => useQuery({ queryKey: ['jobs', id], queryFn: () => api.get<JobDto>(`/jobs/${id}`) });

export const useJobHistory = (id: string) =>
  useQuery({ queryKey: ['jobs', id, 'history'], queryFn: () => api.get<JobHistoryEntryDto[]>(`/jobs/${id}/history`) });

/** Compresses and uploads photos of one kind to a job. */
export async function uploadJobPhotos(jobId: string, kind: PhotoKind, files: File[]) {
  const form = new FormData();
  form.append('kind', kind);
  for (const file of files) {
    const blob = await compressImage(file);
    form.append('photos', blob, file.name.replace(/\.\w+$/, '') + (blob === file ? '' : '.jpg'));
  }
  return api.post<JobPhotoDto[]>(`/jobs/${jobId}/photos`, form);
}
