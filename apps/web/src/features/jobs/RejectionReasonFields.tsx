import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rejectionNote, type RejectionReasonDto } from '@msm/shared';
import { Field, inputClass } from '@/components/ui/Field';
import { api } from '@/lib/api-client';

const OTHER = '__other__';

/**
 * Customer rejection: reason picked from the branch's list (global defaults + branch rows) and an optional remark.
 * Reports the note to store through `onChange` — '' while it is not complete yet.
 * "Other" (or a branch with no list) needs the reason typed in the remark.
 */
export function RejectionReasonFields({ branchId, onChange, error }: { branchId: string; onChange: (note: string) => void; error?: string }) {
  const reasons = useQuery({
    queryKey: ['settings', 'rejection-reasons', 'effective', branchId],
    queryFn: () => api.get<RejectionReasonDto[]>(`/settings/rejection-reasons?branchId=${branchId}`),
  });
  const active = (reasons.data ?? []).filter((r) => r.isActive);
  const [reason, setReason] = useState('');
  const [remark, setRemark] = useState('');
  const noList = reasons.isSuccess && active.length === 0;
  const typed = noList || reason === OTHER;

  const report = (nextReason: string, nextRemark: string) => {
    const freeText = noList || nextReason === OTHER;
    onChange(freeText ? nextRemark.trim() : nextReason ? rejectionNote(nextReason, nextRemark) : '');
  };

  return (
    <>
      {!noList && (
        <Field label="Customer's reason" required error={reason ? undefined : error}>
          <select
            value={reason}
            onChange={(e) => (setReason(e.target.value), report(e.target.value, remark))}
            className={inputClass}
            disabled={reasons.isLoading}
          >
            <option value="">{reasons.isLoading ? 'Loading…' : 'Select the reason'}</option>
            {active.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
            <option value={OTHER}>Other (type below)</option>
          </select>
        </Field>
      )}
      <Field label={typed ? "Customer's reason" : 'Remark (optional)'} required={typed} error={typed ? error : undefined}>
        <textarea
          value={remark}
          onChange={(e) => (setRemark(e.target.value), report(reason, e.target.value))}
          rows={2}
          maxLength={400}
          className={inputClass}
          placeholder={typed ? 'e.g. Too costly, will buy a new phone' : 'Anything else the customer said'}
        />
      </Field>
    </>
  );
}
