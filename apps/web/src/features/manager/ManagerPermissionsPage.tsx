import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ManagerPermissionsDto } from '@msm/shared';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api-client';

/** Super Admin: switch individual Branch Manager actions on or off for every branch. */
export function ManagerPermissionsPage() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['manager', 'permissions'], queryFn: () => api.get<ManagerPermissionsDto>('/manager/permissions') });
  const save = useMutation({
    mutationFn: (v: { key: string; allowed: boolean }) => api.put<ManagerPermissionsDto>('/manager/permissions', v),
    onSuccess: (data) => {
      queryClient.setQueryData(['manager', 'permissions'], data);
      toast.success('Saved');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Branch Manager Permissions" description="Turn individual Branch Manager actions on or off. The Super Admin always has every permission." />
      <Card title="Branch Manager can…">
        <ul className="divide-y divide-slate-100">
          {(q.data ?? []).map((p) => (
            <li key={p.key} className="flex items-center justify-between gap-3 py-3">
              <span className="text-sm">{p.label}</span>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={p.allowed} disabled={save.isPending} onChange={(e) => save.mutate({ key: p.key, allowed: e.target.checked })} className="size-4" />
                <span className={p.allowed ? 'font-medium text-emerald-700' : 'text-slate-500'}>{p.allowed ? 'Allowed' : 'Off'}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
