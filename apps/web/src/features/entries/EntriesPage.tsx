import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Pencil, Plus, Table2, Trash2 } from 'lucide-react';
import {
  ADMIN_REASSIGNABLE_STATUSES,
  ASSIGNABLE_STATUSES,
  CLOSED_STATUSES,
  ENGINEER_TRANSITIONS,
  JOB_STATUS_LABELS,
  JOB_STATUSES,
  ROLES,
  type BranchDto,
  type EngineerWorkloadDto,
  type JobListItemDto,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, inputClass } from '@/components/ui/Field';
import { FilterBar, FilterSelect, SearchInput } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/auth-context';
import { JobLookup } from '@/features/jobs/JobLookup';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { api } from '@/lib/api-client';
import { toQueryString, useList, useOptions } from '@/lib/crud';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatDateTime } from '@/lib/format';

type Tab = 'show' | 'add' | 'edit' | 'delete';

/**
 * Entry Master: the engineer work entry for each job (entry id = job no). Add = assign an engineer,
 * Edit = reassign / move status / retailer, Delete = take the job back from the engineer.
 * Every change is kept in the job's assignment and status history.
 */
export function EntriesPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'show';
  const setTab = (t: Tab) => setParams(t === 'show' ? {} : { tab: t }, { replace: true });
  const tabs: { key: Tab; label: string; icon: typeof Table2 }[] = [
    { key: 'show', label: 'Show', icon: Table2 },
    { key: 'add', label: 'Add', icon: Plus },
    { key: 'edit', label: 'Edit', icon: Pencil },
    { key: 'delete', label: 'Delete', icon: Trash2 },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Entry Master" description="Engineer work entries for each job — assignment, status, retailer and transfer details" />
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'show' && <ShowEntries />}
      {tab === 'add' && <AddEntry />}
      {tab === 'edit' && <EditEntry />}
      {tab === 'delete' && <DeleteEntry />}
    </div>
  );
}

function useEngineers(branchId: string | undefined) {
  return useQuery({
    queryKey: ['engineers', branchId],
    queryFn: () => api.get<EngineerWorkloadDto[]>(`/jobs/engineers?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

// ─── Show ───────────────────────────────────────────────────────────────────

function ShowEntries() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [engineerId, setEngineerId] = useState('');
  const [branchId, setBranchId] = useState('');
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1));

  const params = { page, pageSize: 25, sort: 'newest', search, from, to, status, engineerId, branchId };
  const { data, isLoading } = useList<JobListItemDto>('jobs', params);
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: isSuperAdmin });
  const engineerBranch = isSuperAdmin ? branchId : user?.branch?.id;
  const engineers = useEngineers(engineerBranch);

  const nowrap = (v: React.ReactNode) => <span className="whitespace-nowrap">{v ?? '—'}</span>;
  const columns: Column<JobListItemDto>[] = [
    { header: 'Entry ID', cell: (j) => <span className="font-mono text-xs whitespace-nowrap">{j.jobNumber}</span> },
    { header: 'User ID', cell: (j) => nowrap(j.assignedEngineer?.username) },
    {
      header: 'Job',
      cell: (j) => (
        <Link to={`/jobs/${j.id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">
          {j.jobNumber}
        </Link>
      ),
    },
    { header: 'Retailer', cell: (j) => nowrap(j.retailer) },
    { header: 'Entry Date', cell: (j) => nowrap(formatDate(j.createdAt)) },
    { header: 'Product', cell: (j) => nowrap(j.device) },
    { header: 'Problem', cell: (j) => <span className="block max-w-56 truncate" title={j.faults.join(', ')}>{j.faults.join(', ')}</span> },
    { header: 'Engineer', cell: (j) => nowrap(j.assignedEngineer?.name ?? <span className="text-slate-400">Unassigned</span>) },
    { header: 'Assign Date', cell: (j) => nowrap(j.assignedAt ? formatDateTime(j.assignedAt) : null) },
    { header: 'Status', cell: (j) => <JobStatusBadge status={j.status} /> },
    {
      header: 'Transfer Details',
      cell: (j) => (j.assignmentChain.includes('→') ? <span className="whitespace-nowrap text-sm">{j.assignmentChain}</span> : <span className="text-slate-400">—</span>),
    },
  ];

  const exportCsv = async () => {
    const all = await api.get<{ items: JobListItemDto[] }>(`/jobs?${toQueryString({ ...params, page: 1, pageSize: 200 })}`);
    downloadCsv(
      `entries_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Entry ID', 'User ID', 'Retailer', 'Entry Date', 'Product', 'Problem', 'Engineer', 'Assign Date', 'Status', 'Transfer Details'],
      all.items.map((j) => [
        j.jobNumber, j.assignedEngineer?.username, j.retailer, formatDate(j.createdAt), j.device, j.faults.join('; '), j.assignedEngineer?.name,
        j.assignedAt ? formatDateTime(j.assignedAt) : '', JOB_STATUS_LABELS[j.status], j.assignmentChain,
      ]),
    );
  };

  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchInput onSearch={reset(setSearch)} placeholder="Job no, customer, mobile" />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          From <input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className={`${inputClass} w-38!`} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          To <input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className={`${inputClass} w-38!`} />
        </label>
        <FilterSelect value={status} onChange={reset(setStatus)} placeholder="All statuses" options={JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] }))} />
        <FilterSelect
          value={engineerId}
          onChange={reset(setEngineerId)}
          placeholder={engineerBranch ? 'All engineers' : 'Select branch for engineers'}
          disabled={!engineerBranch}
          options={[{ value: 'none', label: 'Unassigned' }, ...(engineers.data ?? []).map((e) => ({ value: e.id, label: e.name }))]}
        />
        {isSuperAdmin && (
          <FilterSelect value={branchId} onChange={(v) => (setBranchId(v), setEngineerId(''), setPage(1))} placeholder="All branches" options={branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))} />
        )}
        <Button variant="secondary" onClick={() => void exportCsv()}>
          <Download className="size-4" /> Excel
        </Button>
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(j) => j.id} isLoading={isLoading} emptyMessage="No entries match these filters" />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </div>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────

function JobSummary({ job }: { job: JobListItemDto }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-slate-500">Job</dt><dd><Link to={`/jobs/${job.id}`} className="font-mono font-semibold text-brand-600 hover:underline">{job.jobNumber}</Link></dd></div>
      <div><dt className="text-xs text-slate-500">Product</dt><dd>{job.device}</dd></div>
      <div><dt className="text-xs text-slate-500">Problem</dt><dd>{job.faults.join(', ')}</dd></div>
      <div><dt className="text-xs text-slate-500">Customer</dt><dd>{job.customer.name}</dd></div>
      <div><dt className="text-xs text-slate-500">Engineer</dt><dd>{job.assignedEngineer?.name ?? '—'}</dd></div>
      <div><dt className="text-xs text-slate-500">Status</dt><dd><JobStatusBadge status={job.status} /></dd></div>
      {job.assignmentChain.includes('→') && (
        <div className="sm:col-span-3"><dt className="text-xs text-slate-500">Transfer details</dt><dd>{job.assignmentChain}</dd></div>
      )}
    </dl>
  );
}

function useEntryLookup() {
  const queryClient = useQueryClient();
  const [found, setFound] = useState<JobListItemDto | null>(null);
  /** Re-fetch the looked-up job after a change so the summary shows the new state. */
  const refresh = async () => {
    void queryClient.invalidateQueries();
    if (!found) return;
    const res = await api.get<{ items: JobListItemDto[] }>(`/jobs?search=${encodeURIComponent(found.jobNumber)}&pageSize=5`);
    setFound(res.items.find((j) => j.id === found.id) ?? null);
  };
  return { found, setFound, refresh };
}

function useCanAssign() {
  const { user } = useAuth();
  const isManager = user?.role === ROLES.SUPER_ADMIN || user?.role === ROLES.BRANCH_MANAGER;
  return {
    isManager,
    canAssign: (j: JobListItemDto) =>
      (isManager ? ADMIN_REASSIGNABLE_STATUSES : ASSIGNABLE_STATUSES).includes(j.status) &&
      j.location === 'AT_BRANCH' &&
      (!user?.branch || user.branch.id === j.currentBranch.id),
  };
}

function EngineerSelect({ branchId, value, onChange, exclude }: { branchId: string; value: string; onChange: (v: string) => void; exclude?: string }) {
  const engineers = useEngineers(branchId);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="">{engineers.isLoading ? 'Loading…' : 'Select engineer'}</option>
      {(engineers.data ?? [])
        .filter((e) => e.id !== exclude)
        .map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} ({e.openJobs} open)
          </option>
        ))}
    </select>
  );
}

// ─── Add ────────────────────────────────────────────────────────────────────

function AddEntry() {
  const { found, setFound, refresh } = useEntryLookup();
  const { canAssign } = useCanAssign();
  const [sameAsJob, setSameAsJob] = useState(true);
  const [engineerId, setEngineerId] = useState('');
  const [retailer, setRetailer] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      if (retailer.trim() !== (found!.retailer ?? '')) await api.patch(`/jobs/${found!.id}`, { retailer: retailer.trim() || null });
      return api.post<{ assignedEngineer: { name: string } }>(`/jobs/${found!.id}/assign`, { engineerId });
    },
    onSuccess: ({ assignedEngineer }) => {
      toast.success(`Entry ${found!.jobNumber} added — assigned to ${assignedEngineer.name}`);
      setEngineerId('');
      void refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const pick = (j: JobListItemDto | null) => {
    setFound(j);
    setRetailer(j?.retailer ?? '');
    setEngineerId('');
  };

  return (
    <Card title="Add entry" subtitle="Search the job, then assign the engineer who will work on it" icon={Plus}>
      <JobLookup onFound={pick} />
      {found && (
        <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
          <JobSummary job={found} />
          {found.assignedEngineer ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This job already has an entry for {found.assignedEngineer.name}. Use <strong>Edit</strong> to reassign it.
            </p>
          ) : !canAssign(found) ? (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">An engineer can't be assigned at this stage ({JOB_STATUS_LABELS[found.status]}).</p>
          ) : (
            <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Entry ID">
                <input value={sameAsJob ? found.jobNumber : ''} readOnly disabled className={`${inputClass} font-mono`} />
              </Field>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <input type="checkbox" checked={sameAsJob} onChange={(e) => setSameAsJob(e.target.checked)} className="size-4 accent-brand-600" />
                Same as Job ID
              </label>
              <Field label="Product">
                <input value={found.device} readOnly disabled className={inputClass} />
              </Field>
              <Field label="Problem">
                <input value={found.faults.join(', ')} readOnly disabled className={inputClass} />
              </Field>
              <Field label="Assign engineer" required>
                <EngineerSelect branchId={found.currentBranch.id} value={engineerId} onChange={setEngineerId} />
              </Field>
              <Field label="Retailer">
                <input value={retailer} onChange={(e) => setRetailer(e.target.value)} maxLength={100} className={inputClass} />
              </Field>
              {!sameAsJob && <p className="text-sm text-amber-700 sm:col-span-2">Entries are always linked to their job — the entry ID is the job number.</p>}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!engineerId || !sameAsJob} loading={save.isPending}>Add entry</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Edit ───────────────────────────────────────────────────────────────────

function EditEntry() {
  const { found, setFound, refresh } = useEntryLookup();
  const { canAssign, isManager } = useCanAssign();
  const [engineerId, setEngineerId] = useState('');
  const [retailer, setRetailer] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const [note, setNote] = useState('');

  const pick = (j: JobListItemDto | null) => {
    setFound(j);
    setRetailer(j?.retailer ?? '');
    setEngineerId('');
    setNextStatus('');
    setNote('');
  };
  const ok = (msg: string) => {
    toast.success(msg);
    setEngineerId('');
    setNextStatus('');
    setNote('');
    void refresh();
  };
  const reassign = useMutation({
    mutationFn: () => api.post<{ assignedEngineer: { name: string } }>(`/jobs/${found!.id}/assign`, { engineerId }),
    onSuccess: ({ assignedEngineer }) => ok(`Reassigned to ${assignedEngineer.name}`),
    onError: (err) => toast.error(err.message),
  });
  const saveRetailer = useMutation({
    mutationFn: () => api.patch(`/jobs/${found!.id}`, { retailer: retailer.trim() || null }),
    onSuccess: () => ok('Retailer saved'),
    onError: (err) => toast.error(err.message),
  });
  const move = useMutation({
    mutationFn: () => api.post(`/jobs/${found!.id}/status`, { status: nextStatus, note: note.trim() || null }),
    onSuccess: () => ok(`Status changed to ${JOB_STATUS_LABELS[nextStatus as keyof typeof JOB_STATUS_LABELS]}`),
    onError: (err) => toast.error(err.message),
  });

  const transitions = found ? (ENGINEER_TRANSITIONS[found.status] ?? []) : [];
  const transition = transitions.find((t) => t.to === nextStatus);
  const closed = found && CLOSED_STATUSES.includes(found.status);

  return (
    <Card title="Edit entry" subtitle="Reassign the engineer, move the work status or correct the retailer" icon={Pencil}>
      <JobLookup onFound={pick} />
      {found && (
        <div className="mt-5 space-y-5 border-t border-slate-100 pt-5">
          <JobSummary job={found} />
          {closed ? (
            <p className="text-sm text-slate-600">This job is closed and its entry can no longer be changed.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-2 rounded-lg border border-slate-200 p-4">
                <div className="font-medium">{found.assignedEngineer ? 'Reassign engineer' : 'Assign engineer'}</div>
                {canAssign(found) ? (
                  <>
                    <EngineerSelect branchId={found.currentBranch.id} value={engineerId} onChange={setEngineerId} exclude={found.assignedEngineer?.id} />
                    <Button disabled={!engineerId} loading={reassign.isPending} onClick={() => reassign.mutate()}>
                      {found.assignedEngineer ? 'Reassign' : 'Assign'}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">Not possible at this stage{found.location !== 'AT_BRANCH' ? ' — the phone is at L4 / in transit' : ''}.</p>
                )}
              </div>
              <div className="space-y-2 rounded-lg border border-slate-200 p-4">
                <div className="font-medium">Work status</div>
                {isManager && transitions.length > 0 ? (
                  <>
                    <select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)} className={inputClass}>
                      <option value="">Keep {JOB_STATUS_LABELS[found.status]}</option>
                      {transitions.map((t) => (
                        <option key={t.to} value={t.to}>{t.label}</option>
                      ))}
                    </select>
                    {nextStatus && (
                      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={transition?.noteRequired ? 'Remark (required)' : 'Remark (optional)'} className={inputClass} />
                    )}
                    <Button disabled={!nextStatus || (transition?.noteRequired && note.trim().length < 3)} loading={move.isPending} onClick={() => move.mutate()}>
                      Update status
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">
                    {JOB_STATUS_LABELS[found.status]} —{' '}
                    {isManager ? 'diagnosis, approval and delivery steps are done from the job page.' : 'status is updated by the engineer or a manager.'}
                  </p>
                )}
              </div>
              <div className="space-y-2 rounded-lg border border-slate-200 p-4">
                <div className="font-medium">Retailer</div>
                <input value={retailer} onChange={(e) => setRetailer(e.target.value)} maxLength={100} className={inputClass} />
                <Button variant="secondary" disabled={retailer.trim() === (found.retailer ?? '')} loading={saveRetailer.isPending} onClick={() => saveRetailer.mutate()}>
                  Save retailer
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Delete ─────────────────────────────────────────────────────────────────

function DeleteEntry() {
  const { found, setFound, refresh } = useEntryLookup();
  const { canAssign } = useCanAssign();
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const remove = useMutation({
    mutationFn: () => api.post(`/jobs/${found!.id}/unassign`, { note: note.trim() || null }),
    onSuccess: () => {
      toast.success(`Entry removed — ${found!.jobNumber} is back to Received`);
      setConfirm(false);
      setNote('');
      void refresh();
    },
    onError: (err) => {
      setConfirm(false);
      toast.error(err.message);
    },
  });
  const removable = found && found.status === 'ASSIGNED' && found.assignedEngineer && canAssign(found);

  return (
    <Card title="Delete entry" subtitle="Take a job back from its engineer before work has started. History is kept." icon={Trash2}>
      <JobLookup onFound={setFound} />
      {found && (
        <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
          <JobSummary job={found} />
          {removable ? (
            <div className="max-w-md space-y-3">
              <Field label="Reason">
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputClass} placeholder="e.g. Assigned to the wrong engineer" />
              </Field>
              <Button variant="danger" onClick={() => setConfirm(true)}>Delete entry</Button>
            </div>
          ) : (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {!found.assignedEngineer
                ? 'This job has no engineer entry.'
                : 'The engineer has already started work on this job — use Edit to reassign it instead.'}
            </p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Delete entry ${found?.jobNumber ?? ''}?`}
        message={`The job is taken back from ${found?.assignedEngineer?.name ?? 'the engineer'} and returns to Received. The job itself is not deleted.`}
        confirmLabel="Delete entry"
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirm(false)}
      />
    </Card>
  );
}
