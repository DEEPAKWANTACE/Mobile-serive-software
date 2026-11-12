import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_JOB_LIST_COLUMNS, JOB_LIST_COLUMN_LABELS, ROLES, type JobListColumn, type JobListColumnsDto, type JobListItemDto, type Role } from '@msm/shared';
import type { Column } from '@/components/ui/DataTable';
import { api } from '@/lib/api-client';
import { formatCurrency, formatDate, formatJobNumber } from '@/lib/format';
import { JobStatusBadge } from './JobStatusBadge';

export const jobListColumnsQueryKey = ['settings', 'job-list-columns'] as const;

/** Columns Super Admin chose for this role (defaults until the matrix loads or if it fails). */
export function useJobListColumns(role: Role | undefined): JobListColumn[] {
  const query = useQuery({
    queryKey: jobListColumnsQueryKey,
    queryFn: () => api.get<JobListColumnsDto>('/settings/job-list-columns'),
    staleTime: 5 * 60_000,
  });
  if (!role) return [];
  return query.data?.[role] ?? DEFAULT_JOB_LIST_COLUMNS[role];
}

/** Phone is back at its own branch and ready to hand over (RWR returns need the Branch Manager). */
export const canDeliverRow = (j: JobListItemDto, role: Role | undefined) =>
  j.location === 'AT_BRANCH' && j.currentBranch.id === j.branch.id &&
  ((j.status === 'READY_FOR_DELIVERY' && (role === ROLES.CCO || role === ROLES.BRANCH_MANAGER)) || (j.status === 'RWR' && role === ROLES.BRANCH_MANAGER));

export const jobProblem = (j: JobListItemDto) => j.faults.join(', ');

const ageDays = (j: JobListItemDto) => Math.max(0, Math.floor((Date.now() - new Date(j.createdAt).getTime()) / 86_400_000));

function Payment({ j }: { j: JobListItemDto }) {
  if (j.balance > 0) return <span className="block truncate font-semibold text-orange-700" title={`${formatCurrency(j.paid)} paid of ${formatCurrency(j.totalAmount)}`}>Due {formatCurrency(j.balance)}</span>;
  if (j.balance < 0) return <span className="block truncate font-semibold text-blue-700">Credit {formatCurrency(Math.abs(j.balance))}</span>;
  if (j.paid > 0) return <span className="font-semibold text-emerald-700">Paid {formatCurrency(j.paid)}</span>;
  return <span className="text-slate-500">Not billed</span>;
}

const truncate = (text: string | null | undefined, className = '') => (
  <span className={`block truncate ${className}`} title={text ?? undefined}>{text || '—'}</span>
);

/** Relative width weight per column, so the fixed table layout gives text-heavy columns more room. */
const WEIGHT: Record<JobListColumn | 'jobNumber', number> = {
  jobNumber: 12, status: 14, date: 9, customerName: 13, customerMobile: 11, device: 14, problem: 17, engineer: 11,
  pendingWith: 14, estimate: 9, payment: 11, imei: 13, city: 9, branch: 9, inwardBy: 10, ageDays: 7, approval: 10,
};

export function buildJobColumns(
  keys: JobListColumn[],
  { role, onApprove, onDeliver }: { role: Role | undefined; onApprove: (job: JobListItemDto) => void; onDeliver: (job: JobListItemDto) => void },
): Column<JobListItemDto>[] {
  const canApprove = role === ROLES.CCO || role === ROLES.BRANCH_MANAGER;
  // The approval column is only meaningful for staff who can record customer approval.
  const visible = keys.filter((k) => k !== 'approval' || canApprove);
  const total = WEIGHT.jobNumber + visible.reduce((sum, k) => sum + WEIGHT[k], 0);
  const width = (k: JobListColumn | 'jobNumber') => ({ width: `${((WEIGHT[k] / total) * 100).toFixed(2)}%` });

  const cells: Record<JobListColumn, Column<JobListItemDto>['cell']> = {
    status: (j) => <JobStatusBadge status={j.status} />,
    date: (j) => <span className="whitespace-nowrap text-slate-600">{formatDate(j.createdAt)}</span>,
    customerName: (j) => truncate(j.customer.name, 'font-medium'),
    customerMobile: (j) => <a href={`tel:${j.customer.phone}`} className="block truncate text-brand-600 hover:underline">{j.customer.phone}</a>,
    device: (j) => truncate(j.device, 'font-medium'),
    problem: (j) => truncate(jobProblem(j), 'text-slate-700'),
    engineer: (j) => j.assignedEngineer ? truncate(j.assignedEngineer.name) : <span className="text-amber-700">Unassigned</span>,
    pendingWith: (j) => truncate(j.pendingWith, 'text-slate-600'),
    estimate: (j) => <span className="whitespace-nowrap">{j.quotedAmount !== null ? formatCurrency(j.quotedAmount) : j.totalAmount ? formatCurrency(j.totalAmount) : '—'}</span>,
    payment: (j) => <Payment j={j} />,
    imei: (j) => truncate(j.imei ?? j.serialNumber, 'font-mono text-xs'),
    city: (j) => truncate(j.city),
    branch: (j) => truncate(j.branch.code),
    inwardBy: (j) => truncate(j.inwardBy),
    ageDays: (j) => <span className="tabular-nums">{ageDays(j)}d</span>,
    approval: (j) => j.status === 'AWAITING_APPROVAL'
      ? <button type="button" onClick={() => onApprove(j)} className="rounded-md bg-orange-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-orange-700">Approval</button>
      : canDeliverRow(j, role)
        ? <button type="button" onClick={() => onDeliver(j)} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Deliver</button>
        : <span className="text-slate-300">—</span>,
  };

  return [
    {
      header: 'Job Sheet ID',
      className: '',
      cell: (j) => (
        <Link to={`/jobs/${j.id}`} className="block truncate font-mono text-sm font-semibold text-brand-600 hover:underline" title={formatJobNumber(j.jobNumber)}>
          {formatJobNumber(j.jobNumber)}
        </Link>
      ),
      style: width('jobNumber'),
    },
    ...visible.map((k) => ({ header: k === 'approval' ? 'Action' : JOB_LIST_COLUMN_LABELS[k], cell: cells[k], style: width(k) })),
  ];
}
