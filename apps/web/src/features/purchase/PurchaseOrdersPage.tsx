import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileText } from 'lucide-react';
import {
  ROLES,
  type BranchDto,
  type Paginated,
  type PoStage,
  type PurchaseOrderDto,
  type StockRowDto,
} from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { FilterSelect, SearchInput } from '@/components/ui/Filters';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/features/auth/auth-context';
import { api, ApiError } from '@/lib/api-client';
import { toQueryString, useOptions } from '@/lib/crud';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { exportChallan, printChallan, SUPPLY_LINE_STATUS } from './challan';
import { SupplyDialog } from './SupplyDialog';
import { PoStageBadge } from './PoStageBadge';

type TabKey = 'new' | 'supply' | 'draft' | 'open' | 'done' | 'all';

const IN_TAB: Record<TabKey, (s: PoStage) => boolean> = {
  new: (s) => s === 'SENT',
  supply: (s) => s === 'ACCEPTED' || s === 'PART_SUPPLIED',
  draft: (s) => s === 'DRAFT',
  open: (s) => ['SENT', 'ACCEPTED', 'PART_SUPPLIED', 'IN_TRANSIT'].includes(s),
  done: (s) => ['COMPLETED', 'REJECTED', 'CLOSED'].includes(s),
  all: () => true,
};

/** Purchase orders: branches raise and track them; the Central Store accepts and supplies them. */
export function PurchaseOrdersPage() {
  const { user } = useAuth();
  const isCentral = user?.role === ROLES.CENTRAL_STOREKEEPER;
  const isSupplier = isCentral || user?.role === ROLES.SUPER_ADMIN;
  const isBranch = !isCentral;
  const [params, setParams] = useSearchParams();
  const tabs: { key: TabKey; label: string }[] = isCentral
    ? [{ key: 'new', label: 'New' }, { key: 'supply', label: 'To supply' }, { key: 'open', label: 'All open' }, { key: 'done', label: 'Finished' }, { key: 'all', label: 'All' }]
    : [{ key: 'open', label: 'Open' }, { key: 'draft', label: 'Drafts' }, { key: 'done', label: 'Finished' }, { key: 'all', label: 'All' }];
  const tab = tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0]!.key;
  const [branchId, setBranchId] = useState(params.get('branchId') ?? '');
  const [creating, setCreating] = useState(false);
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: isSupplier });
  const orders = useQuery({
    queryKey: ['purchase-orders', branchId],
    queryFn: () => api.get<PurchaseOrderDto[]>(`/purchase-orders?${toQueryString({ branchId })}`),
    refetchInterval: 60_000,
  });
  const all = orders.data ?? [];
  const shown = all.filter((p) => IN_TAB[tab](p.stage));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Orders"
        description={isCentral ? 'Orders from the branches. Accept, then supply in full or in parts.' : 'Order parts from the Central Store and track what has been sent.'}
        actions={isBranch && <Button onClick={() => setCreating(true)}>New purchase order</Button>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setParams({ tab: t.key }, { replace: true })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {t.label} ({all.filter((p) => IN_TAB[t.key](p.stage)).length})
            </button>
          ))}
        </div>
        {isSupplier && (
          <FilterSelect value={branchId} onChange={setBranchId} placeholder="All branches" options={branches.filter((b) => b.type !== 'CENTRAL_STORE').map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))} />
        )}
      </div>
      {orders.error && <p className="text-sm text-red-600">{orders.error.message}</p>}
      {orders.isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !shown.length ? (
        <Card>
          <p className="text-sm text-slate-500">No purchase orders here.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {shown.map((po) => (
            <OrderCard key={po.id} po={po} isSupplier={isSupplier} isBranch={isBranch} />
          ))}
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New purchase order to Central Store" size="lg">
        {creating && <NewOrderForm onDone={() => setCreating(false)} />}
      </Modal>
    </div>
  );
}

function OrderCard({ po, isSupplier, isBranch }: { po: PurchaseOrderDto; isSupplier: boolean; isBranch: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [supplying, setSupplying] = useState(false);
  const act = useMutation({
    mutationFn: (v: { action: 'send' | 'accept' | 'reject' | 'close'; reason?: string }) => api.post(`/purchase-orders/${po.id}/${v.action}`, v.reason ? { reason: v.reason } : {}),
    onSuccess: (_r, v) => {
      toast.success({ send: 'Sent to the Central Store', accept: 'Order accepted', reject: 'Order rejected', close: 'Order closed short' }[v.action]);
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? (Object.values((e.details as Record<string, string[]>) ?? {})[0]?.[0] ?? e.message) : e.message),
  });
  const decideWithReason = (action: 'reject' | 'close', question: string) => {
    const reason = window.prompt(question)?.trim();
    if (reason === undefined) return;
    if (reason.length < 3) return toast.error('Enter a reason');
    act.mutate({ action, reason });
  };

  const progress = new Map(po.progress.map((p) => [p.partId, p]));
  const ordered = po.progress.reduce((s, p) => s + p.ordered, 0);
  const supplied = po.progress.reduce((s, p) => s + Math.min(p.supplied, p.ordered), 0);
  const pendingLines = po.lines.filter((l) => (progress.get(l.partId)?.pending ?? 0) > 0);
  const canSupply = isSupplier && ['SENT', 'ACCEPTED', 'PART_SUPPLIED'].includes(po.stage);

  return (
    <section className="theme-panel rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-brand-700">{po.poNumber}</span>
            <PoStageBadge stage={po.stage} />
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{po.source === 'MANUAL' ? 'Picked parts' : 'From consumption'}</span>
          </div>
          <div className="mt-1 text-sm text-slate-700">
            <b>{po.branchName}</b> ({po.branchCode}) · {po.lines.length} part{po.lines.length === 1 ? '' : 's'} · {po.totalQuantity} pcs · {formatCurrency(po.totalAmount)}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {po.forwardedAt ? `Sent ${formatDateTime(po.forwardedAt)}` : `Created ${formatDateTime(po.createdAt)}`} by {po.createdBy}
            {po.status !== 'DRAFT' && ` · supplied ${supplied} of ${ordered}`}
            {po.note && ` · “${po.note}”`}
          </div>
          {po.centralNote && <div className="mt-1 text-sm font-medium text-red-700">Central Store: {po.centralNote}</div>}
          <div className="mt-1 text-xs font-medium text-brand-600">{open ? 'Hide details' : 'View details'}</div>
        </button>
        <div className="flex flex-wrap gap-2">
          {isBranch && po.stage === 'DRAFT' && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ action: 'send' })}>Send to Central Store</Button>}
          {isSupplier && po.stage === 'SENT' && <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => act.mutate({ action: 'accept' })}>Accept</Button>}
          {canSupply && <Button size="sm" onClick={() => setSupplying(true)}>Supply</Button>}
          {isSupplier && (po.stage === 'SENT' || po.stage === 'ACCEPTED') && (
            <Button size="sm" variant="secondary" onClick={() => decideWithReason('reject', 'Why is this order rejected?')}>Reject</Button>
          )}
          {isSupplier && po.stage === 'PART_SUPPLIED' && (
            <Button size="sm" variant="secondary" onClick={() => decideWithReason('close', 'Why will the pending quantity not be supplied?')}>Close short</Button>
          )}
          {isBranch && po.progress.length > 0 && po.supplies.some((s) => s.lines.some((l) => l.status === 'SENT')) && (
            <Link to="/store/transfers"><Button size="sm">Receive stock</Button></Link>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-4 border-t border-slate-100 pt-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Part</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Ordered</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Supplied</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Received</th>
                  <th className="py-1.5 text-right font-medium">Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {po.lines.map((l) => {
                  const p = progress.get(l.partId);
                  return (
                    <tr key={l.partId}>
                      <td className="py-1.5 pr-3">
                        <span className="font-mono font-semibold">{l.partCode}</span> · {l.product}
                        <span className="text-xs text-slate-500">{[l.brand, l.model, l.color].filter(Boolean).map((v) => ` · ${v}`).join('')}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{l.quantity}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{p?.supplied ?? 0}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{p?.received ?? 0}</td>
                      <td className={`py-1.5 text-right tabular-nums ${p?.pending ? 'font-semibold text-amber-700' : ''}`}>{p?.pending ?? l.quantity}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {po.source === 'CONSUMPTION' && <p className="text-xs text-slate-500">Parts used on jobs from {formatDate(po.from)} to {formatDate(po.to)}.</p>}
          {po.supplies.map((s) => (
            <div key={s.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-mono font-semibold">{s.challanNumber}</span> · {formatDateTime(s.createdAt)} by {s.createdBy} · {s.totalQuantity} pcs · {formatCurrency(s.totalAmount)}
                  {s.note && <span className="text-slate-500"> · “{s.note}”</span>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => exportChallan(s)}><Download className="size-4" /> Excel</Button>
                  <Button size="sm" variant="secondary" onClick={() => printChallan(s)}><FileText className="size-4" /> PDF</Button>
                </div>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                {s.lines.map((l) => (
                  <li key={l.transferId}>
                    <span className="font-mono">{l.partCode}</span> × {l.quantity} @ {formatCurrency(l.rate)} — {SUPPLY_LINE_STATUS[l.status]}
                    {l.status === 'RECEIVED' && l.receivedQuantity != null && l.receivedQuantity !== l.quantity && (
                      <span className="font-semibold text-red-600"> (counted {l.receivedQuantity}: {l.discrepancyNote})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Modal open={supplying} onClose={() => setSupplying(false)} title={`Supply ${po.poNumber}`} size="lg">
        {supplying && (
          <SupplyDialog
            po={po}
            lines={pendingLines.map((l) => ({ partId: l.partId, code: l.partCode, name: l.product, quantity: progress.get(l.partId)!.pending, pending: progress.get(l.partId)!.pending, rate: l.unitCost }))}
            onDone={() => setSupplying(false)}
          />
        )}
      </Modal>
    </section>
  );
}

type Picked = { partId: string; code: string; name: string; inStock: number; quantity: string };

/** A branch picks the parts it wants; "Add low-stock parts" fills in everything at or below its minimum. */
function NewOrderForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const own = user?.branch?.id ?? '';
  const [chosenBranch, setChosenBranch] = useState('');
  const branchId = own || chosenBranch;
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: !own });
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Picked[]>([]);
  const [note, setNote] = useState('');

  const found = useQuery({
    queryKey: ['inventory', 'stock', 'po-search', branchId, search],
    queryFn: () => api.get<Paginated<StockRowDto>>(`/inventory/stock?${toQueryString({ branchId, search, page: 1, pageSize: 8 })}`),
    enabled: !!branchId && search.length > 0,
  });
  const add = (rows: StockRowDto[], quantity: (r: StockRowDto) => number) =>
    setLines((current) => [
      ...current,
      ...rows.filter((r) => !current.some((l) => l.partId === r.part.id)).map((r) => ({ partId: r.part.id, code: r.part.code, name: r.part.name, inStock: r.quantity, quantity: String(quantity(r)) })),
    ]);
  const addLow = useMutation({
    mutationFn: () => api.get<Paginated<StockRowDto>>(`/inventory/stock?${toQueryString({ branchId, lowOnly: true, page: 1, pageSize: 200 })}`),
    // Suggest enough to reach twice the minimum level; the quantity can be changed.
    onSuccess: (res) => (res.items.length ? add(res.items, (r) => Math.max(1, r.part.reorderLevel * 2 - r.quantity)) : toast.info('No part is at or below its minimum level')),
    onError: (e) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: (send: boolean) => api.post<PurchaseOrderDto>('/purchase-orders', { branchId: own ? undefined : branchId, note: note.trim() || undefined, send, lines: lines.map((l) => ({ partId: l.partId, quantity: Number(l.quantity) })) }),
    onSuccess: (po) => {
      toast.success(po.status === 'DRAFT' ? `${po.poNumber} saved as draft` : `${po.poNumber} sent to the Central Store`);
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? (Object.values((e.details as Record<string, string[]>) ?? {})[0]?.[0] ?? e.message) : e.message),
  });
  const valid = !!branchId && lines.length > 0 && lines.every((l) => Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0);

  return (
    <div className="space-y-4">
      {!own && (
        <Field label="Branch ordering" required>
          <select value={chosenBranch} onChange={(e) => (setChosenBranch(e.target.value), setLines([]))} className={inputClass}>
            <option value="">Select branch</option>
            {branches.filter((b) => b.type !== 'CENTRAL_STORE').map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
          </select>
        </Field>
      )}
      {branchId && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput onSearch={setSearch} placeholder="Search part code or name to add" className="w-full! sm:w-80!" />
            <Button type="button" variant="secondary" size="sm" loading={addLow.isPending} onClick={() => addLow.mutate()}>Add low-stock parts</Button>
          </div>
          {search && (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
              {(found.data?.items ?? []).map((r) => (
                <li key={r.part.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span><span className="font-mono font-semibold">{r.part.code}</span> · {r.part.name} <span className="text-xs text-slate-500">({r.quantity} in stock)</span></span>
                  <Button type="button" size="sm" variant="secondary" disabled={lines.some((l) => l.partId === r.part.id)} onClick={() => add([r], () => 1)}>Add</Button>
                </li>
              ))}
              {found.data && !found.data.items.length && <li className="px-3 py-2 text-slate-500">No part matches</li>}
            </ul>
          )}
        </>
      )}
      {lines.length > 0 && (
        <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 text-sm">
          {lines.map((l) => (
            <li key={l.partId} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className="min-w-0"><span className="font-mono font-semibold">{l.code}</span> · {l.name} <span className="text-xs text-slate-500">({l.inStock} in stock)</span></span>
              <span className="flex shrink-0 items-center gap-2">
                <input value={l.quantity} onChange={(e) => setLines((all) => all.map((x) => (x.partId === l.partId ? { ...x, quantity: e.target.value } : x)))} inputMode="numeric" aria-label={`Quantity of ${l.code}`} className={`${inputClass} w-20! py-1!`} />
                <button type="button" aria-label={`Remove ${l.code}`} onClick={() => setLines((all) => all.filter((x) => x.partId !== l.partId))} className="px-1 text-slate-400 hover:text-red-600">✕</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Field label="Note to Central Store">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputClass} placeholder="e.g. Urgent" />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="button" variant="secondary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate(false)}>Save draft</Button>
        <Button type="button" disabled={!valid} loading={save.isPending} onClick={() => save.mutate(true)}>Send to Central Store ({lines.length})</Button>
      </div>
      {!branchId && <p className="text-sm text-slate-500">Select a branch to add parts.</p>}
    </div>
  );
}
