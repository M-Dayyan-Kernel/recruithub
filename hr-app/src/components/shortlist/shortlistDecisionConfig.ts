import type { HrDecision } from '@/types/api'

export const DECISION_CONFIG: Record<
  Exclude<HrDecision, 'pending'>,
  { label: string; active: string; inactive: string }
> = {
  approved: {
    label: 'Approve',
    active: 'bg-emerald-600 text-white border-emerald-600',
    inactive:
      'border-slate-200 text-slate-400 hover:border-emerald-300 hover:text-emerald-600',
  },
  rejected: {
    label: 'Reject',
    active: 'bg-rose-600 text-white border-rose-600',
    inactive: 'border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600',
  },
  overridden: {
    label: 'Override',
    active: 'bg-amber-500 text-white border-amber-500',
    inactive:
      'border-slate-200 text-slate-400 hover:border-amber-300 hover:text-amber-600',
  },
}
