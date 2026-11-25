import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_JOB_LIST_COLUMNS, JOB_LIST_COLUMN_LABELS, ROLES, type JobListColumn, type JobListColumnsDto, type JobListItemDto, type JobListMode, type JobListModeDto, type Role } from '@msm/shared';
import type { Column } from '@/components/ui/DataTable';
import { api } from '@/lib/api-client';
import { formatCurrency, formatDate, formatJobNumber } from '@/lib/format';
import { JobStatusBadge } from './JobStatusBadge';

export const jobListColumnsQueryKey = ['settings', 'job-list-columns'] as const;

export const jobListModeQueryKey = ['settings', 'job-list-mode'] as const;

/** Paged or infinite-scroll job list, as chosen by Super Admin (infinite scroll until the setting loads). */
export function useJobListMode(): JobListMode {
  const query = useQuery({
    queryKey: jobListModeQueryKey,
    queryFn: () => api.get<JobListModeDto>('/settings/job-list-mode'),
    staleTime: 5 * 60_000,
  });
  return query.data?.mode ?? 'INFINITE';
}

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
  ((j.status === 'READY_FOR_DELIVERY' && (role === ROLES.CCO || role === ROLES.BRANCH_MANAGER)) || (j.status === 'RWR' && role === ROLES.CCO));

export const jobProblem = (j: JobListItemDto) => j.faults.join(', ');

export const isBackHome = (j: JobListItemDto) => j.location === 'AT_BRANCH' && j.currentBranch.id === j.branch.id;

export const phoneWhereabouts = (j: JobListItemDto) =>
  j.location === 'TO_L4' ? 'On the way to L4'
    : j.location === 'TO_BRANCH' ? `On the way back to ${j.branch.code}`
      : `At ${j.currentBranch.code}`;

function HomeBadge({ j }: { j: JobListItemDto }) {
  const home = isBackHome(j);
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${home ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{home ? 'Yes' : 'No'}</span>;
}

/** Extra Repeat Repair columns: the earlier job and whether the phone is back at the branch that took it in. */
const REPEAT_COLUMNS: { header: string; rem: number; cell: Column<JobListItemDto>['cell'] }[] = [
  { header: 'Repeat of', rem: 6, cell: (j) => <span className="block truncate font-mono text-sm">{j.repeatOf ? formatJobNumber(j.repeatOf) : '—'}</span> },
  { header: 'Back at home branch', rem: 10, cell: (j) => <HomeBadge j={j} /> },
  { header: 'Phone is now', rem: 10, cell: (j) => truncate(phoneWhereabouts(j)) },
];

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

const actionClass = 'inline-flex h-7 min-w-[4.75rem] items-center justify-center rounded-md px-2.5 text-xs font-semibold shadow-xs transition';

type ActionHandlers = { role: Role | undefined; onApprove: (job: JobListItemDto) => void; onDeliver: (job: JobListItemDto) => void };

/** The one action a row needs now: record approval (also ahead of the engineer's diagnosis), deliver, or open the invoice. */
export function JobRowAction({ job, role, onApprove, onDeliver, fallback }: ActionHandlers & { job: JobListItemDto; fallback?: ReactNode }) {
  const counter = role === ROLES.CCO || role === ROLES.BRANCH_MANAGER;
  if (counter && job.status === 'AWAITING_APPROVAL') {
    return <button type="button" onClick={() => onApprove(job)} className={`${actionClass} bg-orange-600 text-white hover:bg-orange-700`}>Approval</button>;
  }
  // Pending diagnosis: the counter can already record an approval the customer gave, skipping the wait.
  if (counter && job.status === 'ASSIGNED' && job.currentBranch.id === job.branch.id) {
    return <button type="button" onClick={() => onApprove(job)} title="Customer already agreed — record approval before diagnosis" className={`${actionClass} border border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100`}>Approval</button>;
  }
  if (canDeliverRow(job, role)) {
    return <button type="button" onClick={() => onDeliver(job)} className={`${actionClass} bg-emerald-600 text-white hover:bg-emerald-700`}>Deliver</button>;
  }
  if (counter && job.hasInvoice) {
    return (
      <Link to={`/jobs/${job.id}/invoice`} className={`${actionClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} title="View / download invoice">
        Invoice
      </Link>
    );
  }
  return <>{fallback ?? <span className="text-slate-300">—</span>}</>;
}

/** Plain-text value of a column (used for the phone cards). */
export function jobCellText(k: JobListColumn, j: JobListItemDto): string {
  switch (k) {
    case 'status': return j.pendingWith;
    case 'date': return formatDate(j.createdAt);
    case 'customerName': return j.customer.name;
    case 'customerMobile': return j.customer.phone;
    case 'device': return j.device;
    case 'problem': return jobProblem(j);
    case 'engineer': return j.assignedEngineer?.name ?? 'Unassigned';
    case 'pendingWith': return j.pendingWith;
    case 'estimate': return j.quotedAmount !== null ? formatCurrency(j.quotedAmount) : j.totalAmount ? formatCurrency(j.totalAmount) : '—';
    case 'payment': return j.balance > 0 ? `Due ${formatCurrency(j.balance)}` : j.balance < 0 ? `Credit ${formatCurrency(-j.balance)}` : j.paid > 0 ? `Paid ${formatCurrency(j.paid)}` : 'Not billed';
    case 'imei': return j.imei ?? j.serialNumber ?? '—';
    case 'city': return j.city ?? '—';
    case 'branch': return j.branch.code;
    case 'inwardBy': return j.inwardBy ?? '—';
    case 'ageDays': return `${ageDays(j)}d open`;
    case 'approval': return '';
  }
}

/** Relative width weight per column, so the fixed table layout gives text-heavy columns more room. */
const WEIGHT: Record<Exclude<JobListColumn, 'approval'>, number> = {
  status: 14, date: 9, customerName: 13, customerMobile: 11, device: 14, problem: 17, engineer: 11,
  pendingWith: 14, estimate: 9, payment: 11, imei: 13, city: 9, branch: 9, inwardBy: 10, ageDays: 7,
};

export function buildJobColumns(keys: JobListColumn[], handlers: ActionHandlers, repeatColumns = false): Column<JobListItemDto>[] {
  const extra = repeatColumns ? REPEAT_COLUMNS : [];
  const canApprove = handlers.role === ROLES.CCO || handlers.role === ROLES.BRANCH_MANAGER;
  // The action column is only meaningful for staff who can approve / deliver; it always sits right after the job ID.
  const showAction = keys.includes('approval') && canApprove;
  const rest = keys.filter((k): k is Exclude<JobListColumn, 'approval'> => k !== 'approval');
  const total = rest.reduce((sum, k) => sum + WEIGHT[k], 0) || 1;
  const fixedRem = 5.75 + (showAction ? 6.5 : 0) + extra.reduce((sum, c) => sum + c.rem, 0);

  const cells: Record<Exclude<JobListColumn, 'approval'>, Column<JobListItemDto>['cell']> = {
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
  };

  return [
    {
      header: 'Job ID',
      cell: (j) => (
        <Link to={`/jobs/${j.id}`} className="block truncate font-mono text-sm font-semibold text-brand-600 hover:underline" title={j.repeatOf ? `Repeat of ${formatJobNumber(j.repeatOf)}` : formatJobNumber(j.jobNumber)}>
          {formatJobNumber(j.jobNumber)}{j.repeatOf && <span className="ml-1 text-violet-600">↻</span>}
        </Link>
      ),
      style: { width: '5.75rem' },
    },
    ...(showAction ? [{ header: 'Action', cell: (j: JobListItemDto) => <JobRowAction job={j} {...handlers} />, style: { width: '6.5rem' } }] : []),
    ...extra.map((c) => ({ header: c.header, cell: c.cell, style: { width: `${c.rem}rem` } })),
    // The remaining width (after the fixed ID / action / repeat columns) is shared by weight.
    ...rest.map((k) => ({
      header: JOB_LIST_COLUMN_LABELS[k],
      cell: cells[k],
      style: { width: `calc((100% - ${fixedRem}rem) * ${(WEIGHT[k] / total).toFixed(4)})` },
    })),
  ];
}
