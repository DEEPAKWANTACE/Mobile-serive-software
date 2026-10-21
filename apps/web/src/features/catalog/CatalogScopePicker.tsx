import { ROLES, type BranchDto } from '@msm/shared';
import { useAuth } from '@/features/auth/auth-context';
import { useOptions } from '@/lib/crud';
import { inputClass } from '@/components/ui/Field';

export function CatalogScopePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { user } = useAuth();
  const { items } = useOptions<BranchDto>('branches', {}, { enabled: user?.role === ROLES.SUPER_ADMIN });
  if (user?.role !== ROLES.SUPER_ADMIN) return null;
  return <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} w-64!`} aria-label="Catalogue scope">
    <option value="">Global defaults</option>
    {items.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
  </select>;
}

export const scopeParams = (branchId: string) => branchId ? { branchId, scope: 'branch' } : { scope: 'global' };
