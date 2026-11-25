import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BranchDto } from '@msm/shared';
import { Field, inputClass } from '@/components/ui/Field';
import { SuggestInput } from '@/components/ui/SuggestInput';
import { useAuth } from '@/features/auth/auth-context';
import { useOptions } from '@/lib/crud';

export type Area = { state: string; district: string; city: string; village: string };

type GeoState = { name: string; districts: { code: string; name: string; talukas: string[] }[] };

/** Static lists built from the Government of India village directory (see public/data/geo/SOURCE.md). */
async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error('Could not load the area list');
  return (await res.json()) as T;
}
const forever = { staleTime: Infinity, gcTime: Infinity } as const;
const useGeoIndex = () => useQuery({ queryKey: ['geo', 'index'], queryFn: () => loadJson<GeoState[]>('/data/geo/index.json'), ...forever });

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The state and district of the signed-in user's branch, used to pre-fill new job sheets. The district is
 * found from the branch's city, which may be a district or one of its talukas.
 */
export function useBranchArea(): { state: string; district: string } | null {
  const own = useAuth().user?.branch?.id;
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: !!own });
  const index = useGeoIndex().data;
  const branch = branches.find((b) => b.id === own);
  return useMemo(() => {
    if (!branch || !index) return null;
    const state = index.find((s) => same(s.name, branch.city.state.name));
    if (!state) return null;
    const city = branch.city.name;
    const byName = state.districts.find((d) => same(d.name, city));
    const byTaluka = state.districts.filter((d) => d.talukas.some((t) => same(t, city)));
    return { state: state.name, district: byName?.name ?? (byTaluka.length === 1 ? byTaluka[0]!.name : '') };
  }, [branch, index]);
}

/** State → District → City/Taluka → Gaon. Changing a level clears the ones below it. */
export function AreaPicker({ value, onChange, errors = {} }: { value: Area; onChange: (area: Area) => void; errors?: Partial<Record<keyof Area, string>> }) {
  const index = useGeoIndex();
  const state = index.data?.find((s) => same(s.name, value.state));
  const district = state?.districts.find((d) => same(d.name, value.district));
  const villages = useQuery({
    queryKey: ['geo', 'villages', district?.code],
    queryFn: () => loadJson<Record<string, string[]>>(`/data/geo/villages/${district!.code}.json`),
    enabled: !!district,
    // A few city districts have no villages at all.
    retry: false,
    ...forever,
  });

  // With a district chosen, list its talukas; otherwise every taluka in the state, which also fills the district.
  const talukas = useMemo(
    () => (district ? district.talukas.map((t) => ({ value: t })) : (state?.districts.flatMap((d) => d.talukas.map((t) => ({ value: t, hint: d.name }))) ?? []).sort((a, b) => a.value.localeCompare(b.value))),
    [state, district],
  );
  const gaons = useMemo(() => {
    const byTaluka = villages.data ?? {};
    const taluka = Object.keys(byTaluka).find((t) => same(t, value.city));
    return taluka
      ? byTaluka[taluka]!.map((v) => ({ value: v }))
      : Object.entries(byTaluka).flatMap(([t, names]) => names.map((v) => ({ value: v, hint: t }))).sort((a, b) => a.value.localeCompare(b.value));
  }, [villages.data, value.city]);

  return (
    <>
      <Field label="State" error={errors.state}>
        <select aria-label="State" value={state?.name ?? ''} onChange={(e) => onChange({ state: e.target.value, district: '', city: '', village: '' })} className={inputClass}>
          <option value="">{index.isLoading ? 'Loading…' : 'Select state'}</option>
          {(index.data ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="District" error={errors.district}>
        <select aria-label="District" value={district?.name ?? ''} disabled={!state} onChange={(e) => onChange({ ...value, district: e.target.value, city: '', village: '' })} className={inputClass}>
          <option value="">{state ? 'Select district' : 'Select state first'}</option>
          {(state?.districts ?? []).map((d) => <option key={d.code} value={d.name}>{d.name}</option>)}
        </select>
      </Field>
      <Field label="City / Taluka" error={errors.city}>
        <SuggestInput
          aria-label="City / Taluka"
          value={value.city}
          options={talukas}
          placeholder="Select or type city / taluka"
          onChange={(city, picked) => onChange({ ...value, city, district: picked?.hint ?? value.district, village: same(city, value.city) ? value.village : '' })}
        />
      </Field>
      <Field label="Gaon / Village" error={errors.village} hint={index.error ? index.error.message : villages.isFetching ? 'Loading villages…' : 'Type the name if it is not listed'}>
        <SuggestInput
          aria-label="Gaon / Village"
          value={value.village}
          options={gaons}
          placeholder={district ? 'Select or type gaon' : 'Select district for the list'}
          onChange={(village, picked) => onChange({ ...value, village, city: picked?.hint ?? value.city })}
        />
      </Field>
    </>
  );
}
