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

export function DayBookPage() {
  const { user } = useAuth();
  const canVoid = !!user && EXPENSE_VOID_ROLES.includes(user.role);
  const canOpenJobs = user?.role !== ROLES.ACCOUNTS;
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

  const quick = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };
  const monthStart = `${todayIso().slice(0, 8)}01`;

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
    { header: 'By', cell: (e) => e.createdBy.name },
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
      <PageHeader title="Day Book" description="Money received, refunds and office expenses" actions={<Button onClick={() => setAdding(true)}>Add expense</Button>} />
      <FilterBar>
        <BranchScopePicker value={branchId} onChange={setBranchId} />
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" className={`${inputClass} w-40!`} />
        <span className="text-slate-500">to</span>
        <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} aria-label="To" className={`${inputClass} w-40!`} />
        <Button variant="secondary" size="sm" onClick={() => quick(todayIso(), todayIso())}>Today</Button>
        <Button variant="secondary" size="sm" onClick={() => quick(todayIso(-1), todayIso(-1))}>Yesterday</Button>
        <Button variant="secondary" size="sm" onClick={() => quick(monthStart, todayIso())}>This month</Button>
      </FilterBar>

      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Received" value={formatCurrency(data.received.total)} tone="info" />
            <StatCard label="Refunds" value={formatCurrency(data.refunds.total)} />
            <StatCard label="Expenses" value={formatCurrency(data.expenses.total)} />
            <StatCard label="Net" value={formatCurrency(data.net)} tone="info" />
            <StatCard label="Cash in hand" value={formatCurrency(data.cashInHand)} tone="warning" />
          </div>

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

function ExpenseForm({ branchId, onDone }: { branchId: string; onDone: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ category: '', description: '', amount: '', mode: 'CASH' as PaymentMode, expenseDate: todayIso() });
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
        <select value={form.category} onChange={set('category')} className={inputClass}>
          <option value="">Select category</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
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
