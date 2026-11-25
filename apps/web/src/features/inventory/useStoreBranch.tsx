import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ROLES, type BranchDto } from '@msm/shared';
import { FilterSelect } from '@/components/ui/Filters';
import { useAuth } from '@/features/auth/auth-context';
import { useOptions } from '@/lib/crud';

/**
 * Store pages work on one branch: the user's own, or (Super Admin) a chosen one. The Central Storekeeper
 * starts on the Central Store and may switch to any branch store to look at it.
 */
export function useStoreBranch() {
  const { user } = useAuth();
  const own = user?.branch?.id ?? '';
  const isCentral = user?.role === ROLES.CENTRAL_STOREKEEPER;
  const canSwitch = !own || isCentral;
  const [params] = useSearchParams();
  const [chosen, setChosen] = useState(() => (canSwitch ? (params.get('branchId') ?? '') : ''));
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: canSwitch });
  const branchId = canSwitch ? chosen || own : own;
  const branch = branches.find((b) => b.id === branchId);

  const picker = !canSwitch ? null : (
    <FilterSelect
      value={chosen === own ? '' : chosen}
      onChange={setChosen}
      placeholder={isCentral ? 'Central Store (mine)' : 'Select branch'}
      options={branches.filter((b) => b.id !== own).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
    />
  );
  return {
    branchId,
    picker,
    needsBranch: !branchId,
    isCentral,
    /** Central looking at another store: nothing can be changed there (stock can only be recalled). */
    viewingOther: isCentral && branchId !== own,
    ownBranchId: own,
    branchName: branch ? `${branch.name} (${branch.code})` : '',
    branchType: branch?.type,
  };
}
