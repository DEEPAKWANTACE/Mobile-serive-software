import type { BranchDto, CityDto, StateDto } from '@msm/shared';
import { FilterSelect } from '@/components/ui/Filters';
import { useOptions } from '@/lib/crud';

export type FranchiseSelection = { stateId: string; cityId: string; branchId: string };

/** Super Admin: drill down State → City → Branch to view one branch (franchise) or everything. */
export function FranchisePicker({ value, onChange }: { value: FranchiseSelection; onChange: (v: FranchiseSelection) => void }) {
  const { items: states } = useOptions<StateDto>('states');
  const { items: cities } = useOptions<CityDto>('cities', { stateId: value.stateId }, { enabled: !!value.stateId });
  const { items: branches } = useOptions<BranchDto>('branches', { stateId: value.stateId, cityId: value.cityId });
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <span className="text-sm font-medium text-slate-600">View:</span>
      <FilterSelect value={value.stateId} onChange={(v) => onChange({ stateId: v, cityId: '', branchId: '' })} placeholder="All states" options={states.map((s) => ({ value: s.id, label: s.name }))} />
      <FilterSelect
        value={value.cityId}
        onChange={(v) => onChange({ ...value, cityId: v, branchId: '' })}
        placeholder={value.stateId ? 'All cities' : 'Select state'}
        disabled={!value.stateId}
        options={cities.map((c) => ({ value: c.id, label: c.name }))}
      />
      <FilterSelect value={value.branchId} onChange={(v) => onChange({ ...value, branchId: v })} placeholder="All branches" options={branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))} />
    </div>
  );
}
