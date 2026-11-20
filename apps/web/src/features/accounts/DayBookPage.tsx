import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_VOID_ROLES,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  ROLES,
  type DayBookDto,
  type ExpenseDto,
  type PaymentMode,
} from '@msm/shared';
import { QuickDateRange } from '@/components/ui/QuickDateRange';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, inputClass } from '@/components/ui/Field';
import { FilterBar } from '@/components/ui/Filters';
import { FormActions } from '@/components/ui/FormActions';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/features/auth/auth-context';
import { StatCard } from '@/features/dashboard/StatCard';
import { api, ApiError } from '@/lib/api-client';
import { toQueryString } from '@/lib/crud';
import { formatCurrency, formatDate, formatDateTime, todayIso } from '@/lib/format';
import { BranchScopePicker } from './BranchScopePicker';
import { ArrowDownLeft, Banknote, Download, FileText, Landmark, ReceiptText, Scale, Undo2, Wallet } from 'lucide-react';
import { downloadXlsx } from '@/lib/xlsx';
import type { DayClosingStatusDto } from '@msm/shared';
import { openPrintWindow, writeTable } from '@/lib/print-table';

const rupeeFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const rupees = (n: number) => rupeeFmt.format(Math.round(n));

export function DayBookPage() {
  const { user } = useAuth();
  const canVoid = !!user && EXPENSE_VOID_ROLES.includes(user.role);
  const canApprove = user?.role === ROLES.BRANCH_MANAGER || user?.role === ROLES.SUPER_ADMIN;
  const queryClient = useQueryClient();
  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/accounts/expenses/${id}/approve`, {}),
    onSuccess: () => {
      toast.success('Expense approved');
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const canOpenJobs = user?.role !== ROLES.ACCOUNTS;
  // CCO only sees today and yesterday — no older records.
  const isCco = user?.role === ROLES.CCO;
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [branchId, setBranchId] = useState('');
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<ExpenseDto | null>(null);

  const params = { from, to, branchId };
  const { data, isLoading, error } = useQuery({
    queryKey: ['accounts', 'day-book', params],
    queryFn: () => api.get<DayBookDto>(`/accounts/day-book?${toQueryString(params)}`),
  });

  const exportRows = (d: DayBookDto) => {
    const rows: (string | number)[][] = [
      ...d.payments.map((p) => [formatDateTime(p.createdAt), p.kind === 'REFUND' ? 'Refund' : p.kind === 'ADVANCE' ? 'Advance' : 'Payment', p.job.jobNumber, p.job.customer, PAYMENT_MODE_LABELS[p.mode], p.kind === 'REFUND' ? -p.amount : p.amount, p.receivedBy]),
      ...d.expenseItems.filter((e) => !e.voided).map((e) => [formatDate(e.expenseDate), `Expense: ${e.category}`, '', e.description, PAYMENT_MODE_LABELS[e.mode], -e.amount, `${e.createdBy.name}${e.approved ? ` (approved ${e.approved.by})` : ''}`]),
    ];
    return rows;
  };
  const exportHeaders = ['Date / time', 'Type', 'Job', 'Customer / description', 'Mode', 'Amount', 'By'];
  const exportXlsx = () => data && void downloadXlsx(`day_book_${from}_${to}.xlsx`, exportHeaders, exportRows(data), 'Day Book');
  const exportPdf = () => {
    if (!data) return;
    const win = openPrintWindow();
    if (!win) return toast.error('Allow pop-ups to download the PDF');
    const sub = `${formatDate(from)} to ${formatDate(to)} · Opening cash ${rupees(data.openingCash)} · Received ${rupees(data.received.total)} · Expenses ${rupees(data.expenses.total)} · Refunds ${rupees(data.refunds.total)} · Closing cash ${rupees(data.closingCash)} · Online ${rupees(data.onlineBalance)} · Outstanding due ${rupees(data.outstandingDue)}`;
    writeTable(win, { title: 'Day Book', subtitle: sub, headers: exportHeaders, rows: exportRows(data), landscape: true });
  };

  const quick = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };

  const paymentColumns: Column<DayBookDto['payments'][number]>[] = [
    { header: 'Time', cell: (p) => <span className="whitespace-nowrap text-slate-600">{formatDateTime(p.createdAt)}</span> },
    {
      header: 'Job',
      cell: (p) =>
        canOpenJobs ? (
          <Link to={`/jobs/${p.job.id}`} className="font-mono text-brand-600 hover:underline">
            {p.job.jobNumber}
          </Link>
        ) : (
          <span className="font-mono">{p.job.jobNumber}</span>
        ),
    },
    { header: 'Customer', cell: (p) => p.job.customer },
    { header: 'Type', cell: (p) => (p.kind === 'ADVANCE' ? 'Advance' : p.kind === 'FINAL' ? 'Payment' : 'Refund') },
    { header: 'Mode', cell: (p) => `${PAYMENT_MODE_LABELS[p.mode]}${p.reference ? ` (${p.reference})` : ''}` },
    {
      header: 'Amount',
      className: 'text-right',
      cell: (p) => (
        <span className={`font-medium ${p.kind === 'REFUND' ? 'text-orange-700' : 'text-emerald-700'}`}>
          {p.kind === 'REFUND' ? '− ' : ''}
          {formatCurrency(p.amount)}
        </span>
      ),
    },
    { header: 'By', cell: (p) => p.receivedBy },
  ];

  const expenseColumns: Column<ExpenseDto>[] = [
    { header: 'Date', cell: (e) => formatDate(e.expenseDate) },
    { header: 'Category', cell: (e) => e.category },
    {
      header: 'Description',
      cell: (e) => (
        <span className={e.voided ? 'text-slate-400 line-through' : ''}>
          {e.description}
          {e.voided && <span className="ml-2 text-xs no-underline">(voided by {e.voided.by}: {e.voided.reason})</span>}
        </span>
      ),
    },
    { header: 'Mode', cell: (e) => PAYMENT_MODE_LABELS[e.mode] },
    { header: 'Amount', className: 'text-right', cell: (e) => <span className={e.voided ? 'text-slate-400' : 'font-medium'}>{formatCurrency(e.amount)}</span> },
    { header: 'Added by', cell: (e) => e.createdBy.name },
    {
      header: 'Approved by',
      cell: (e) =>
        e.approved ? (
          <span className="text-sm text-emerald-700">{e.approved.by}</span>
        ) : canApprove && !e.voided ? (
          <Button variant="link" onClick={() => approve.mutate(e.id)}>Approve</Button>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      header: '',
      className: 'text-right',
      cell: (e) =>
        canVoid && !e.voided && (
          <Button variant="link" className="text-red-600!" onClick={() => setVoiding(e)}>
            Void
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Day Book" description="Money received, refunds and office expenses" actions={<>
        <Button variant="secondary" size="sm" disabled={!data} onClick={exportXlsx}><Download className="size-4" /> Excel</Button>
        <Button variant="secondary" size="sm" disabled={!data} onClick={exportPdf}><FileText className="size-4" /> PDF</Button>
        <Button onClick={() => setAdding(true)}>Add expense</Button>
      </>} />
      <FilterBar>
        <BranchScopePicker value={branchId} onChange={setBranchId} />
        {isCco ? (
          <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
            {([['Today', todayIso()], ['Yesterday', todayIso(-1)]] as const).map(([label, day]) => (
              <button
                key={label}
                type="button"
                onClick={() => quick(day, day)}
                className={`rounded px-3 py-1.5 ${from === day && to === day ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" className={`${inputClass} w-40!`} />
            <span className="text-slate-500">to</span>
            <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} aria-label="To" className={`${inputClass} w-40!`} />
            <QuickDateRange onSelect={quick} allowAll={false} label={false} />
          </>
        )}
      </FilterBar>

      {(user?.role === ROLES.BRANCH_MANAGER || (user?.role === ROLES.SUPER_ADMIN && !!branchId)) && from === to && <DayClosingCard date={from} branchId={branchId} />}
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {data && (
        <>
          {/* Same compact cards as the dashboard: whole rupees, icon badge, 2 / 3 / 4 per row. */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="Received" value={rupees(data.received.total)} tone="good" icon={ArrowDownLeft} />
            <StatCard label="Refunds" value={rupees(data.refunds.total)} tone="warning" icon={Undo2} />
            <StatCard label="Expenses" value={rupees(data.expenses.total)} icon={ReceiptText} />
            <StatCard label="Net" value={rupees(data.net)} tone="brand" icon={Scale} />
            <StatCard label="Cash in hand" value={rupees(data.cashInHand)} tone="info" icon={Wallet} hint={`${data.deliveredCount} delivered`} />
            <StatCard label="Opening cash" value={rupees(data.openingCash)} icon={Banknote} hint="Before this period" />
            <StatCard label="Closing cash" value={rupees(data.closingCash)} tone="info" icon={Wallet} hint="Opening + cash in hand" />
            <StatCard label="Online balance" value={rupees(data.onlineBalance)} icon={Landmark} hint="UPI + card, net" />
            <StatCard label="Total available" value={rupees(data.totalAvailable)} tone="good" icon={Scale} hint="Cash + online" />
            <StatCard label="Customer due" value={rupees(data.outstandingDue)} tone="warning" icon={ReceiptText} hint="Ready phones, unpaid" />
          </div>

          {data.expenseByCategory.length > 0 && (
            <Card title="Expenses by category">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {data.expenseByCategory.map((c) => (
                    <tr key={c.category}>
                      <td className="py-1.5">{c.category}</td>
                      <td className="py-1.5 text-right font-medium">{formatCurrency(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <Card title={`By payment mode · ${data.deliveredCount} phone${data.deliveredCount === 1 ? '' : 's'} delivered (invoiced ${formatCurrency(data.invoicedTotal)})`}>
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1.5 font-medium"></th>
                  {PAYMENT_MODES.map((m) => (
                    <th key={m} className="py-1.5 text-right font-medium">{PAYMENT_MODE_LABELS[m]}</th>
                  ))}
                  <th className="py-1.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {([['Received', data.received], ['Refunds', data.refunds], ['Expenses', data.expenses]] as const).map(([label, t]) => (
                  <tr key={label}>
                    <td className="py-1.5">{label}</td>
                    {PAYMENT_MODES.map((m) => (
                      <td key={m} className="py-1.5 text-right">{formatCurrency(t[m])}</td>
                    ))}
                    <td className="py-1.5 text-right font-medium">{formatCurrency(t.total)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5">Net</td>
                  {PAYMENT_MODES.map((m) => (
                    <td key={m} className="py-1.5 text-right">{formatCurrency(data.received[m] - data.refunds[m] - data.expenses[m])}</td>
                  ))}
                  <td className="py-1.5 text-right">{formatCurrency(data.net)}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card title={`Payments (${data.payments.length})`}>
            <DataTable columns={paymentColumns} rows={data.payments} rowKey={(p) => p.id} emptyMessage="No payments in this period" />
          </Card>
          <Card title={`Expenses (${data.expenseItems.length})`}>
            <DataTable columns={expenseColumns} rows={data.expenseItems} rowKey={(e) => e.id} emptyMessage="No expenses in this period" />
          </Card>
        </>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add expense" size="sm">
        {adding && <ExpenseForm branchId={branchId} onDone={() => setAdding(false)} />}
      </Modal>
      <Modal open={!!voiding} onClose={() => setVoiding(null)} title="Void expense" size="sm">
        {voiding && <VoidForm expense={voiding} onDone={() => setVoiding(null)} />}
      </Modal>
    </div>
  );
}

const CUSTOM = '__custom__';

function ExpenseForm({ branchId, onDone }: { branchId: string; onDone: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ category: '', description: '', amount: '', mode: 'CASH' as PaymentMode, expenseDate: todayIso() });
  const [custom, setCustom] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api.post('/accounts/expenses', { ...form, branchId: user?.branch ? undefined : branchId || null }),
    onSuccess: () => {
      toast.success('Expense added');
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      onDone();
    },
    onError: (err) => {
      const d = err instanceof ApiError ? (err.details as Record<string, string[]> | undefined) : undefined;
      if (d) setErrors(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v?.[0]])));
      else toast.error(err.message);
    },
  });

  return (
    <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="space-y-4">
      {!user?.branch && !branchId && <p className="text-sm text-amber-700">Select a branch at the top of the page first.</p>}
      <Field label="Category" required error={errors.category}>
        <select value={custom ? CUSTOM : form.category} onChange={(e) => { const isCustom = e.target.value === CUSTOM; setCustom(isCustom); setForm((f) => ({ ...f, category: isCustom ? '' : e.target.value })); }} className={inputClass}>
          <option value="">Select category</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
          <option value={CUSTOM}>Custom category…</option>
        </select>
        {custom && (
          <input value={form.category} onChange={set('category')} autoFocus className={`${inputClass} mt-2`} placeholder="Type the new category" />
        )}
      </Field>
      <Field label="Description" required error={errors.description}>
        <input value={form.description} onChange={set('description')} className={inputClass} placeholder="e.g. Tea for staff" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)" required error={errors.amount}>
          <input value={form.amount} onChange={set('amount')} inputMode="decimal" className={inputClass} />
        </Field>
        <Field label="Paid by">
          <select value={form.mode} onChange={set('mode')} className={inputClass}>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>{PAYMENT_MODE_LABELS[m]}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Date" error={errors.expenseDate}>
        <input type="date" value={form.expenseDate} max={todayIso()} onChange={set('expenseDate')} className={inputClass} />
      </Field>
      <FormActions onCancel={onDone} loading={save.isPending} submitLabel="Add expense" />
    </form>
  );
}

function VoidForm({ expense, onDone }: { expense: ExpenseDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/accounts/expenses/${expense.id}/void`, { reason }),
    onSuccess: () => {
      toast.success('Expense voided');
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="space-y-4">
      <p className="text-sm text-slate-600">
        {expense.description} · {formatCurrency(expense.amount)}
      </p>
      <Field label="Reason" required>
        <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus className={inputClass} placeholder="e.g. Entered twice" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Back</Button>
        <Button type="submit" variant="danger" disabled={reason.trim().length < 3} loading={save.isPending}>Void expense</Button>
      </div>
    </form>
  );
}

/** Close the business day: compare the cash the system expects with the cash actually counted. */
function DayClosingCard({ date, branchId }: { date: string; branchId: string }) {
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const q = useQuery({
    queryKey: ['manager', 'day-closing', date, branchId],
    queryFn: () => api.get<DayClosingStatusDto>(`/manager/day-closing?${toQueryString({ date, branchId })}`),
  });
  const close = useMutation({
    mutationFn: () => api.post('/manager/day-closing', { date, branchId: branchId || undefined, countedCash: counted === '' ? null : Number(counted), note: note.trim() || undefined }),
    onSuccess: () => {
      toast.success('Day closed');
      void queryClient.invalidateQueries({ queryKey: ['manager'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const d = q.data;
  if (!d) return null;
  if (d.closing) {
    const c = d.closing;
    return (
      <Card title={`Day closed — ${formatDate(date)}`}>
        <p className="text-sm">
          Expected cash {formatCurrency(c.expectedCash)}
          {c.countedCash != null && <> · counted {formatCurrency(c.countedCash)} · <b className={c.variance ? 'text-red-600' : 'text-emerald-700'}>{c.variance ? `difference ${formatCurrency(c.variance)}` : 'matches'}</b></>}
          {c.note && <> · “{c.note}”</>}
          <span className="block text-xs text-slate-500">Closed by {c.closedBy} on {formatDateTime(c.closedAt)}</span>
        </p>
      </Card>
    );
  }
  return (
    <Card title={`Close the day — ${formatDate(date)}`}>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => (e.preventDefault(), close.mutate())}>
        <div className="text-sm">Expected cash in drawer<div className="text-lg font-semibold">{formatCurrency(d.expectedCash)}</div></div>
        <label className="text-sm">Counted cash (₹)<input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" className={`${inputClass} mt-1 w-36!`} /></label>
        <label className="text-sm">Note<input value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClass} mt-1 w-64!`} placeholder="optional" /></label>
        <Button type="submit" loading={close.isPending}>Close day</Button>
      </form>
    </Card>
  );
}
