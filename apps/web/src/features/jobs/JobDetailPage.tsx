import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ASSIGNABLE_STATUSES,
  ENGINEER_VISIBLE_PHOTO_KINDS,
  PHOTO_KIND_LABELS,
  PHOTO_KINDS,
  ROLES,
  type JobDto,
  type JobHistoryEntryDto,
  type JobPhotoDto,
  type PhotoKind,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/auth-context';
import { formatDateTime } from '@/lib/format';
import { AssignEngineerDialog } from './AssignEngineerDialog';
import { AuthImage } from './AuthImage';
import { uploadJobPhotos, useJob, useJobHistory } from './api';
import { JobStatusBadge } from './JobStatusBadge';
import { PhotoPicker } from './PhotoPicker';

export function JobDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { data: job, isLoading, error } = useJob(id);
  const [assigning, setAssigning] = useState(false);

  if (isLoading) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  if (error || !job) {
    return (
      <div className="p-10 text-center">
        <p className="text-slate-600">{error?.message ?? 'Job not found'}</p>
        <Link to="/jobs" className="mt-2 inline-block text-brand-600 hover:underline">
          Back to job sheets
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/jobs" className="text-sm text-slate-500 hover:underline">
            ← {user?.role === ROLES.ENGINEER ? 'My jobs' : 'Job sheets'}
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{job.jobNumber}</h1>
            <JobStatusBadge status={job.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Received {formatDateTime(job.createdAt)} at {job.branch.name} by {job.createdBy.name}
          </p>
        </div>
        <div className="rounded-lg bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
          <div className="text-xs text-slate-500">Engineer</div>
          <div className="mt-0.5 flex items-center gap-3">
            <span className="font-medium">{job.assignedEngineer?.name ?? <span className="text-amber-700">Not assigned</span>}</span>
            {user?.role !== ROLES.ENGINEER && ASSIGNABLE_STATUSES.includes(job.status) && (
              <Button size="sm" variant={job.assignedEngineer ? 'secondary' : 'primary'} onClick={() => setAssigning(true)}>
                {job.assignedEngineer ? 'Reassign' : 'Assign engineer'}
              </Button>
            )}
          </div>
          {job.assignedAt && <div className="mt-0.5 text-xs text-slate-500">since {formatDateTime(job.assignedAt)}</div>}
        </div>
      </div>
      <AssignEngineerDialog
        job={
          assigning
            ? { id: job.id, jobNumber: job.jobNumber, branchId: job.branch.id, assignedEngineerId: job.assignedEngineer?.id ?? null }
            : null
        }
        onClose={() => setAssigning(false)}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <JobInfo job={job} />
          <Photos job={job} />
        </div>
        <History jobId={job.id} />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function JobInfo({ job }: { job: JobDto }) {
  const accessories = [...job.accessories, ...(job.accessoriesOther ? [job.accessoriesOther] : [])];
  return (
    <>
      <Card title="Customer & device">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Row label="Customer">{job.customer.name}</Row>
          <Row label="Mobile">
            <a href={`tel:${job.customer.phone}`} className="text-brand-600 hover:underline">
              {job.customer.phone}
            </a>
          </Row>
          <Row label="Alternate mobile">{job.customer.altPhone}</Row>
          <Row label="Email">{job.customer.email}</Row>
          <div className="sm:col-span-2">
            <Row label="Address">{job.customer.address}</Row>
          </div>
          <Row label="Device">
            {job.brand.name} {job.model.name}
          </Row>
          <Row label="IMEI">{job.imei && <span className="font-mono">{job.imei}</span>}</Row>
          <Row label="Serial no.">{job.serialNumber && <span className="font-mono">{job.serialNumber}</span>}</Row>
          <Row label="Colour">{job.color}</Row>
        </dl>
      </Card>
      <Card title="Problem & intake">
        <dl className="space-y-4">
          <Row label="Faults reported">
            <div className="flex flex-wrap gap-1.5">
              {job.faults.map((f) => (
                <span key={f.id} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs">
                  {f.name}
                </span>
              ))}
            </div>
          </Row>
          <Row label="Customer complaint">{job.customerComplaint}</Row>
          <Row label="Accessories received">{accessories.length ? accessories.join(', ') : 'None'}</Row>
          <Row label="Physical condition">{job.conditionNotes}</Row>
        </dl>
      </Card>
    </>
  );
}

function Photos({ job }: { job: JobDto }) {
  const { user } = useAuth();
  const canUpload = user?.role === ROLES.CCO || user?.role === ROLES.BRANCH_MANAGER;
  // Engineers only get device photos from the API, so don't show empty customer/ID sections.
  const kinds = user?.role === ROLES.ENGINEER ? ENGINEER_VISIBLE_PHOTO_KINDS : PHOTO_KINDS;
  const [viewing, setViewing] = useState<JobPhotoDto | null>(null);
  const [adding, setAdding] = useState<PhotoKind | null>(null);
  const src = (p: JobPhotoDto) => `/jobs/${job.id}/photos/${p.id}`;

  return (
    <Card title="Photos">
      <div className="space-y-5">
        {kinds.map((kind) => {
          const list = job.photos.filter((p) => p.kind === kind);
          return (
            <div key={kind}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{PHOTO_KIND_LABELS[kind]}</span>
                {canUpload && (
                  <Button variant="link" onClick={() => setAdding(kind)}>
                    Add
                  </Button>
                )}
              </div>
              {list.length ? (
                <div className="flex flex-wrap gap-2">
                  {list.map((p) => (
                    <button key={p.id} type="button" onClick={() => setViewing(p)} className="overflow-hidden rounded-md ring-1 ring-slate-200">
                      <AuthImage src={src(p)} alt={PHOTO_KIND_LABELS[kind]} className="size-24 object-cover" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No photos</p>
              )}
            </div>
          );
        })}
      </div>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? PHOTO_KIND_LABELS[viewing.kind] : ''} size="lg">
        {viewing && <AuthImage src={src(viewing)} alt="" className="mx-auto max-h-[70vh] w-auto rounded" />}
      </Modal>
      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding ? `Add photos — ${PHOTO_KIND_LABELS[adding]}` : ''}>
        {adding && <AddPhotos jobId={job.id} kind={adding} onDone={() => setAdding(null)} />}
      </Modal>
    </Card>
  );
}

function AddPhotos({ jobId, kind, onDone }: { jobId: string; kind: PhotoKind; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await uploadJobPhotos(jobId, kind, files);
      toast.success('Photos added');
      await queryClient.invalidateQueries({ queryKey: ['jobs', jobId] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PhotoPicker label="Photos" files={files} onChange={setFiles} multiple />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={!files.length} loading={saving} onClick={() => void save()}>
          Upload
        </Button>
      </div>
    </div>
  );
}

function describe(entry: JobHistoryEntryDto) {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  switch (entry.action) {
    case 'job.created':
      return 'Job sheet created';
    case 'job.photos_added': {
      const kind = meta.kind as PhotoKind | undefined;
      const count = Number(meta.count ?? 0);
      return `${kind ? PHOTO_KIND_LABELS[kind] : 'Photos'}: ${count} photo${count === 1 ? '' : 's'} added`;
    }
    case 'job.assigned':
      return `Assigned to ${(meta.engineer as { name?: string } | undefined)?.name ?? 'engineer'}`;
    case 'job.reassigned':
      return `Reassigned from ${(meta.previousEngineer as { name?: string } | undefined)?.name ?? '—'} to ${(meta.engineer as { name?: string } | undefined)?.name ?? '—'}`;
    default:
      return entry.action;
  }
}

function History({ jobId }: { jobId: string }) {
  const { data } = useJobHistory(jobId);
  return (
    <Card title="History" className="h-fit">
      <ol className="relative space-y-4 border-l border-slate-200 pl-5">
        {data?.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
            <div className="text-sm font-medium">{describe(e)}</div>
            <div className="text-xs text-slate-500">
              {e.actor?.name ?? 'System'} · {formatDateTime(e.createdAt)}
            </div>
          </li>
        ))}
        {!data && <li className="text-sm text-slate-400">Loading…</li>}
      </ol>
    </Card>
  );
}
