import { cn } from '@/lib/utils'

type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'muted'
  | 'indigo'
  | 'outline'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default:  'bg-slate-100 text-slate-700',
  success:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  warning:  'bg-amber-50 text-amber-700 border border-amber-200',
  danger:   'bg-rose-50 text-rose-700 border border-rose-200',
  info:     'bg-blue-50 text-blue-700 border border-blue-200',
  muted:    'bg-slate-100 text-slate-500',
  indigo:   'bg-indigo-50 text-indigo-700 border border-indigo-200',
  outline:  'border border-slate-300 text-slate-600 bg-transparent',
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}

// Convenience helpers for common statuses
export function ParseStatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    pending:  'muted',
    parsing:  'indigo',
    ready:    'success',
    failed:   'danger',
  }
  const labels: Record<string, string> = {
    pending: 'Pending',
    parsing: 'Parsing…',
    ready:   'Ready',
    failed:  'Failed',
  }
  return <Badge variant={map[status] ?? 'default'}>{labels[status] ?? status}</Badge>
}

export function ScreeningBadge({ result }: { result: string }) {
  const map: Record<string, BadgeVariant> = {
    pass:         'success',
    fail:         'danger',
    needs_review: 'warning',
  }
  const labels: Record<string, string> = {
    pass:         '✓ Pass',
    fail:         '✗ Fail',
    needs_review: '⚠ Needs Review',
  }
  return <Badge variant={map[result] ?? 'default'}>{labels[result] ?? result}</Badge>
}

export function JobStatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    active: 'success',
    draft:  'muted',
    closed: 'danger',
  }
  const labels: Record<string, string> = {
    active: 'Active',
    draft:  'Draft',
    closed: 'Closed',
  }
  return <Badge variant={map[status] ?? 'default'}>{labels[status] ?? status}</Badge>
}

export function ScoreBadge({ score }: { score: number }) {
  const variant: BadgeVariant = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger'
  return (
    <Badge variant={variant} className="text-sm font-bold px-2.5 py-1">
      {score}
    </Badge>
  )
}

export function RecommendationBadge({ value }: { value: string }) {
  return (
    <Badge variant={value === 'shortlist' ? 'indigo' : 'muted'}>
      {value === 'shortlist' ? 'Shortlist' : 'Reject'}
    </Badge>
  )
}

export function HRDecisionBadge({ decision }: { decision: string }) {
  const map: Record<string, BadgeVariant> = {
    approved:   'success',
    rejected:   'danger',
    overridden: 'warning',
    pending:    'muted',
  }
  const labels: Record<string, string> = {
    approved:   '✓ Approved',
    rejected:   '✗ Rejected',
    overridden: '↺ Overridden',
    pending:    'Pending',
  }
  return <Badge variant={map[decision] ?? 'default'}>{labels[decision] ?? decision}</Badge>
}

export function InterviewStatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    link_sent:    'info',
    in_progress:  'indigo',
    completed:    'warning',
    report_ready: 'success',
  }
  const labels: Record<string, string> = {
    link_sent:    'Link Sent',
    in_progress:  'In Progress',
    completed:    'Completed',
    report_ready: 'Report Ready',
  }
  return <Badge variant={map[status] ?? 'default'}>{labels[status] ?? status}</Badge>
}
