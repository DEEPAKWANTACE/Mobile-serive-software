import { PO_STAGE_LABELS, type PoStage } from '@msm/shared';

const STYLES: Record<PoStage, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SENT: 'bg-amber-100 text-amber-900',
  ACCEPTED: 'bg-sky-50 text-sky-700',
  PART_SUPPLIED: 'bg-violet-50 text-violet-700',
  IN_TRANSIT: 'bg-indigo-50 text-indigo-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
  CLOSED: 'bg-slate-200 text-slate-700',
};

export function PoStageBadge({ stage }: { stage: PoStage }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STYLES[stage]}`}>{PO_STAGE_LABELS[stage]}</span>;
}
