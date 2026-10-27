import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2 } from 'lucide-react';
import { type JobListItemDto, type Paginated } from '@msm/shared';
import { Modal } from '@/components/ui/Modal';
import { inputClass } from '@/components/ui/Field';
import { JobStatusBadge } from '@/features/jobs/JobStatusBadge';
import { api } from '@/lib/api-client';
import { formatJobNumber } from '@/lib/format';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function FindJobModal({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const trimmed = searchTerm.trim();
  const search = useQuery({
    queryKey: ['jobs', 'quick-find', trimmed],
    queryFn: () => api.get<Paginated<JobListItemDto>>(`/jobs?search=${encodeURIComponent(trimmed)}&pageSize=8`),
    enabled: open && trimmed.length >= 2,
    staleTime: 5000,
  });

  const handleSelectJob = (id: string) => {
    onClose();
    setSearchTerm('');
    navigate(`/jobs/${id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const items = search.data?.items ?? [];
      if (items.length === 1 && items[0]) {
        handleSelectJob(items[0].id);
      }
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Find a Job" size="md">
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            placeholder="Search by Mobile number or Job number..."
            className={`${inputClass} pl-9`}
          />
          {search.isFetching && (
            <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-slate-400" />
          )}
        </div>

        <div className="min-h-48 max-h-80 overflow-y-auto divide-y divide-slate-100">
          {trimmed.length < 2 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              Type at least 2 digits of the customer mobile or job number.
            </p>
          ) : search.isLoading ? (
            <p className="py-8 text-center text-xs text-slate-400">Searching jobs...</p>
          ) : !search.data?.items.length ? (
            <p className="py-8 text-center text-xs text-slate-500">
              No jobs found matching “{trimmed}”.
            </p>
          ) : (
            search.data.items.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => handleSelectJob(job.id)}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-50 rounded-lg transition"
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-sm text-brand-600">
                      {formatJobNumber(job.jobNumber)}
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs font-medium text-slate-700 truncate">
                      {job.device}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-900">{job.customer.name}</span>
                    <span>·</span>
                    <span>📞 {job.customer.phone}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <JobStatusBadge status={job.status} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
