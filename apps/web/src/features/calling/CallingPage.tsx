import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CALL_OUTCOME_LABELS, ROLES, type CallingRowDto, type PendingCollectionSummaryDto } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/Filters';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/features/auth/auth-context';
import { BranchScopePicker } from '@/features/accounts/BranchScopePicker';
import { StatCard } from '@/features/dashboard/StatCard';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { api } from '@/lib/api-client';
import { formatCurrency, formatDateTime, timeAgo } from '@/lib/format';
import { LogCallForm } from './LogCallForm';
import { WhatsAppButton } from '@/features/messages/WhatsAppButton';

type ListKind = 'ready' | 'rwr' | 'due' | 'approval';
const TABS: { key: ListKind; label: string }[] = [
  { key: 'ready', label: 'Ready — please collect' },
  { key: 'rwr', label: 'Not repaired — please collect' },
  { key: 'due', label: 'Follow-ups due' },
  { key: 'approval', label: 'Estimate approval' },
];

export function CallingPage() {
  const { user } = useAuth();
  const canCall = user?.role !== ROLES.ACCOUNTS;
  const [list, setList] = useState<ListKind>('ready');
  const [branchId, setBranchId] = useState('');
  const [calling, setCalling] = useState<CallingRowDto | null>(null);
  const qs = branchId ? `&branchId=${branchId}` : '';

  const summary = useQuery({
    queryKey: ['calling', 'summary', branchId],
    queryFn: () => api.get<PendingCollectionSummaryDto>(`/calling/summary?${qs.slice(1)}`),
  });
  const rows = useQuery({ queryKey: ['calling', 'list', list, branchId], queryFn: () => api.get<CallingRowDto[]>(`/calling/list?list=${list}${qs}`) });

  const columns: Column<CallingRowDto>[] = [
    {
      header: 'Job',
      cell: (r) => (
        <div>
          {canCall ? (
            <Link to={`/jobs/${r.job.id}`} className="font-mono text-sm font-semibold whitespace-nowrap text-brand-600 hover:underline">
              {r.job.jobNumber}
            </Link>
          ) : (
            <span className="font-mono text-sm font-semibold">{r.job.jobNumber}</span>
          )}
          <div className="text-xs text-slate-500">{r.job.device}</div>
        </div>
      ),
    },
    {
      header: 'Customer',
      cell: (r) => (
        <div>
          <div className="font-medium">{r.customer.name}</div>
          <a href={`tel:${r.customer.phone}`} className="text-xs text-brand-600 hover:underline">📞 {r.customer.phone}</a>
          {r.customer.altPhone && <a href={`tel:${r.customer.altPhone}`} className="ml-2 text-xs text-slate-500 hover:underline">alt {r.customer.altPhone}</a>}
        </div>
      ),
    },
    { header: 'Status', cell: (r) => <JobStatusBadge status={r.job.status} /> },
    {
      header: 'Waiting',
      cell: (r) => <span className={r.daysWaiting >= 7 ? 'font-semibold text-red-600' : r.daysWaiting >= 3 ? 'font-medium text-orange-700' : ''}>{r.daysWaiting} day{r.daysWaiting === 1 ? '' : 's'}</span>,
    },
    {
      header: list === 'approval' ? 'Estimate' : 'Balance',
      cell: (r) => <span className={`font-semibold ${r.balance < 0 ? 'text-orange-700' : ''}`}>{r.balance < 0 ? `Refund ${formatCurrency(-r.balance)}` : formatCurrency(r.balance)}</span>,
    },
    {
      header: 'Last call',
      cell: (r) =>
        r.lastCall ? (
          <div className="text-sm">
            {CALL_OUTCOME_LABELS[r.lastCall.outcome]}
            <div className="text-xs text-slate-500">
              {timeAgo(r.lastCall.at)} ago by {r.lastCall.by} · {r.attempts} call{r.attempts === 1 ? '' : 's'}
            </div>
          </div>
        ) : (
          <span className="text-sm text-slate-400">Not called yet</span>
        ),
    },
    {
      header: 'Next follow-up',
      cell: (r) =>
        r.nextFollowUpAt ? (
          <span className={new Date(r.nextFollowUpAt) < new Date() ? 'font-medium text-red-600' : 'text-slate-600'}>{formatDateTime(r.nextFollowUpAt)}</span>
        ) : (
          '—'
        ),
    },
    ...(user?.branch ? [] : [{ header: 'Branch', cell: (r: CallingRowDto) => r.job.branchCode }]),
    {
      header: '',
      className: 'text-right',
      cell: (r) =>
        canCall && (
          <div className="flex justify-end gap-2 whitespace-nowrap">
            <WhatsAppButton
              phone={r.customer.phone}
              status={r.job.status}
              context={{
                customerName: r.customer.name,
                jobNumber: r.job.jobNumber,
                device: r.job.device,
                branchName: user?.branch?.name ?? r.job.branchCode,
                estimate: r.balance,
                balance: r.balance,
              }}
            />
            <Button size="sm" onClick={() => setCalling(r)}>
              Log call
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Customer Calling" description="Pending collection and follow-ups — call customers whose phones are waiting" />
      <FilterBar>
        <BranchScopePicker value={branchId} onChange={setBranchId} />
      </FilterBar>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Repaired, not collected" value={summary.data?.ready.count} tone="info" />
        <StatCard label="Amount to collect" value={summary.data ? formatCurrency(summary.data.ready.amount) : undefined} tone="warning" />
        <StatCard label="Unrepaired, not collected" value={summary.data?.rwr.count} />
        <StatCard label="Follow-ups due" value={summary.data?.followUpsDue} tone="warning" />
      </div>
      <div className="inline-flex flex-wrap rounded-md border border-slate-300 bg-white p-0.5 text-sm">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setList(t.key)} className={`rounded px-3 py-1.5 ${list === t.key ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <DataTable columns={columns} rows={rows.data} rowKey={(r) => r.job.id} isLoading={rows.isLoading} emptyMessage="Nobody to call in this list 🎉" />
      <Modal open={!!calling} onClose={() => setCalling(null)} title="Log customer call">
        {calling && (
          <LogCallForm jobId={calling.job.id} jobNumber={calling.job.jobNumber} status={calling.job.status} customer={calling.customer} onDone={() => setCalling(null)} />
        )}
      </Modal>
    </div>
  );
}
