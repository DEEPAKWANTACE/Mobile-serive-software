import { useState } from 'react';
import type { BranchDto } from '@msm/shared';
import { FilterSelect } from '@/components/ui/Filters';
import { useAuth } from '@/features/auth/auth-context';
import { useOptions } from '@/lib/crud';

/** Store pages work on one branch: the user's own, or (Super Admin) a chosen one. */
export function useStoreBranch() {
  const { user } = useAuth();
  const own = user?.branch?.id ?? '';
  const [chosen, setChosen] = useState('');
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: !own });
  const branchId = own || chosen;

  const picker = own ? null : (
    <FilterSelect
      value={chosen}
      onChange={setChosen}
      placeholder="Select branch"
      options={branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
    />
  );
  return { branchId, picker, needsBranch: !branchId };
}
