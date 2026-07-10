import type { Job } from '@/types/api'

const STATUS_CONFIG: Record<Job['status'], { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-indigo-100 text-indigo-700' },
  active: { label: 'Active', className: 'bg-indigo-100 text-indigo-700' },
  closed: { label: 'Closed', className: 'bg-slate-100 text-slate-600' },
  paused: { label: 'Paused', className: 'bg-amber-100 text-amber-700' },
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-500' },
}

export function JobStatusBadge({ status }: { status: Job['status'] }) {
  const { label, className } = STATUS_CONFIG[status] ?? STATUS_CONFIG.open
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
