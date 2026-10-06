import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { JobListItemDto, Paginated } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { api } from '@/lib/api-client';

/** "Search Job No" box used by Edit / Delete tabs: finds the exact job number in the caller's scope. */
export function JobLookup({
  onFound,
  initial = '',
  placeholder = 'Job No, e.g. KOR01-2610-0020',
}: {
  onFound: (job: JobListItemDto | null) => void;
  /** Job number to look up straight away (e.g. from a `?job=` link). */
  initial?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const find = async (q = value.trim().toUpperCase()) => {
    if (!q) return;
    setLoading(true);
    setError(undefined);
    try {
      const res = await api.get<Paginated<JobListItemDto>>(`/jobs?search=${encodeURIComponent(q)}&pageSize=10`);
      const exact = res.items.find((j) => j.jobNumber.toUpperCase() === q) ?? (res.items.length === 1 ? res.items[0]! : null);
      if (!exact) {
        setError(res.items.length ? `Several jobs match — type the full job number (${res.items.slice(0, 3).map((j) => j.jobNumber).join(', ')}…)` : 'No job found with that number');
      }
      onFound(exact);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      onFound(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initial) void find(initial.trim().toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  return (
    <div>
      <div className="flex max-w-md gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void find())}
          placeholder={placeholder}
          aria-label="Job number"
          className={`${inputClass} font-mono uppercase`}
        />
        <Button loading={loading} onClick={() => void find()}>
          <Search className="size-4" /> Search
        </Button>
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
