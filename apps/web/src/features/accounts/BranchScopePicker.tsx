import type { BranchDto } from '@msm/shared';
import { FilterSelect } from '@/components/ui/Filters';
import { useAuth } from '@/features/auth/auth-context';
import { useOptions } from '@/lib/crud';

/** For Super Admin: pick one branch or "All branches". Branch staff always see their own branch. */
export function BranchScopePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { user } = useAuth();
  const { items } = useOptions<BranchDto>('branches', {}, { enabled: !user?.branch });
  if (user?.branch) return null;
  return (
    <FilterSelect value={value} onChange={onChange} placeholder="All branches" options={items.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))} />
  );
}
