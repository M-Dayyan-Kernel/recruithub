import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Eye,
  FileText,
  Gavel,
  PhoneCall,
  UserCog,
  Video,
} from 'lucide-react'
import type { CandidateProfile } from '@/types/api'
import { Card } from '@/components/ui/Surface'

interface Props {
  profile: CandidateProfile
}

/** Icon, label and tone per audit action. Unknown actions fall back safely. */
const ACTIONS: Record<
  string,
  { label: string; Icon: typeof FileText; tone: 'accent' | 'pos' | 'warn' | 'neg' | 'neutral' }
> = {
  'candidate.uploaded': { label: 'Resume uploaded', Icon: FileText, tone: 'accent' },
  'candidate.updated': { label: 'Candidate updated', Icon: UserCog, tone: 'neutral' },
  'candidate.view_detail': { label: 'Profile viewed', Icon: Eye, tone: 'neutral' },
  'shortlist.decision_set': { label: 'Shortlist decision', Icon: Gavel, tone: 'accent' },
  'screening.result_set': { label: 'Screening result', Icon: PhoneCall, tone: 'accent' },
  'interview.decision_set': { label: 'Interview decision', Icon: Video, tone: 'accent' },
}

const NODE_TONES = {
  accent: 'bg-accent-soft text-accent ring-accent-border',
  pos: 'bg-pos-soft text-pos ring-pos/20',
  warn: 'bg-warn-soft text-warn ring-warn/20',
  neg: 'bg-neg-soft text-neg ring-neg/20',
  neutral: 'bg-surface-3 text-ink-muted ring-line',
} as const

/** A decision value rendered as its own pill, so a transition reads at a glance. */
function ValuePill({ value }: { value: string }) {
  const v = value.toLowerCase()
  const tone =
    v.includes('approve') || v === 'pass' || v === 'hired'
      ? 'bg-pos-soft text-pos'
      : v.includes('reject') || v === 'fail' || v.includes('declin')
        ? 'bg-neg-soft text-neg'
        : v === 'pending'
          ? 'bg-warn-soft text-warn'
          : 'bg-surface-3 text-ink-muted'
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone} capitalize`}>
      {value.replace(/_/g, ' ')}
    </span>
  )
}

/**
 * Renders what actually changed. The audit rows carry `before_state` and
 * `after_state`, which were previously dropped entirely - the old timeline
 * showed only that "a shortlist decision" happened, never what it became.
 */
function StateChange({
  before,
  after,
}: {
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}) {
  const keys = Object.keys(after ?? {})
  if (keys.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {keys.map((k) => {
        const from = before?.[k]
        const to = after?.[k]
        if (to == null) return null
        return (
          <span key={k} className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span className="text-ink-subtle">{k.replace(/_/g, ' ')}</span>
            {from != null && String(from) !== String(to) && (
              <>
                <ValuePill value={String(from)} />
                <ArrowRight className="h-3 w-3 shrink-0 text-ink-subtle" />
              </>
            )}
            <ValuePill value={String(to)} />
          </span>
        )
      })}
    </div>
  )
}

function splitDateTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: iso, time: '' }
  return {
    date: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  }
}

export function CandidateTimelineTab({ profile }: Props) {
  const timeline = profile.timeline ?? []

  if (timeline.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <CalendarClock className="mx-auto mb-3 h-8 w-8 text-ink-subtle" />
        <p className="text-sm font-semibold text-ink">No activity recorded yet</p>
        <p className="mt-1 text-[13px] text-ink-muted">
          Uploads, decisions and interview events will appear here.
        </p>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">Activity</h3>
        <span className="font-mono text-[12px] tabular-nums text-ink-subtle">
          {timeline.length} event{timeline.length === 1 ? '' : 's'}
        </span>
      </div>

      <ol className="relative">
        {timeline.map((entry, i) => {
          const cfg = ACTIONS[entry.action] ?? {
            label: entry.action.replace(/\./g, ' '),
            Icon: CheckCircle2,
            tone: 'neutral' as const,
          }
          const { Icon } = cfg
          const { date, time } = splitDateTime(entry.created_at)
          const last = i === timeline.length - 1

          return (
            <li key={entry.id} className="relative flex gap-4 pb-6 last:pb-0">
              {/* The rail. Stops at the last node rather than trailing past it. */}
              {!last && (
                <span
                  aria-hidden
                  className="absolute left-[19px] top-10 h-[calc(100%-1.5rem)] w-px bg-line-strong"
                />
              )}

              <span
                className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-4 ring-surface ${NODE_TONES[cfg.tone]}`}
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>

              <div className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-[14px] font-semibold text-ink">{cfg.label}</p>
                  <p className="shrink-0 text-[11px] text-ink-subtle">
                    {date}
                    {time && <span className="ml-1.5 font-mono tabular-nums">{time}</span>}
                  </p>
                </div>

                {entry.subject_label && (
                  <p className="mt-0.5 truncate text-[13px] text-ink-muted" title={entry.subject_label}>
                    {entry.subject_label}
                  </p>
                )}

                <StateChange
                  before={entry.before_state}
                  after={entry.after_state}
                />

                <p className="mt-2 text-[11px] text-ink-subtle">
                  {entry.actor_name}
                  {entry.actor_role && <span className="capitalize"> · {entry.actor_role}</span>}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
