import { type ReactNode, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ExternalLink, FileText, Loader2, Minus, Pencil, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { CandidateProfile, ResumeLink } from '@/types/api'
import Modal from '@/components/ui/Modal'
import { BTN_SECONDARY } from '@/components/ui/Surface'
import { CandidateOverviewForm } from '@/components/candidates/CandidateOverviewForm'
import { detailSections, matchVerdict, pipelineEvents, skillSummary, type PipelineEvent } from '@/lib/candidateProfileView'
import { cn } from '@/lib/utils'

const CARD = 'rounded-xl border border-line bg-surface'

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={CARD}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

/** The facts collected from the resume, the call and HR, in three groups. Edit opens the form. */
export function DetailsCard({ profile }: { profile: CandidateProfile }) {
  const [editing, setEditing] = useState(false)
  const sections = detailSections(profile)
  return (
    <>
      <Card
        title="Collected details"
        action={
          <button type="button" onClick={() => setEditing(true)} className={BTN_SECONDARY}>
            <Pencil size={13} aria-hidden />
            Edit
          </button>
        }
      >
        {sections.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing collected yet. Edit to add details.</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {sections.map((section) => (
              <div key={section.title} className="min-w-0 space-y-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{section.title}</h3>
                <dl className="space-y-3">
                  {section.rows.map((row) => (
                    <div key={row.label}>
                      <dt className="text-[12px] text-ink-muted">{row.label}</dt>
                      <dd className="mt-0.5 break-words text-sm font-medium text-ink">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </Card>
      {editing && (
        <Modal title="Edit details" onClose={() => setEditing(false)} size="xl">
          <div className="p-5">
            <CandidateOverviewForm profile={profile} />
          </div>
        </Modal>
      )}
    </>
  )
}

/** The job's required skills against what the AI found on the resume, and the rest of the resume. */
export function SkillsCard({ profile, requiredSkills }: { profile: CandidateProfile; requiredSkills: string[] }) {
  const summary = skillSummary(profile, requiredSkills)
  if (!summary) return null
  return (
    <Card
      title="Skills"
      action={
        <span className="font-mono text-[12px] tabular-nums text-ink-muted">
          {summary.matched} of {summary.total} required
        </span>
      }
    >
      <ul className="flex flex-wrap gap-1.5" aria-label="Required skills">
        {summary.entries.map((entry) => (
          <li
            key={entry.skill}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium',
              entry.status === 'matched' && 'border-line-strong bg-surface-2 text-ink',
              entry.status === 'gap' && 'border-neg/30 bg-neg-soft text-neg',
              entry.status === 'unclear' && 'border-dashed border-line-strong text-ink-muted',
            )}
          >
            {entry.status === 'matched' ? (
              <Check size={12} aria-hidden />
            ) : entry.status === 'gap' ? (
              <X size={12} aria-hidden />
            ) : (
              <Minus size={12} aria-hidden />
            )}
            {entry.skill}
            <span className="sr-only">
              {entry.status === 'matched' ? ' (matched)' : entry.status === 'gap' ? ' (gap)' : ' (not confirmed)'}
            </span>
          </li>
        ))}
      </ul>
      {summary.other.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Also on the resume</p>
          <ul className="flex flex-wrap gap-1.5">
            {summary.other.slice(0, 20).map((skill) => (
              <li key={skill} className="rounded-full bg-surface-3 px-2.5 py-1 text-[12px] text-ink-muted">
                {skill}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

const CALL_RESULT: Record<string, string> = { pass: 'Passed', fail: 'Did not pass', needs_review: 'Needs review' }

/** The scores that exist: the resume match, and the phone call's result. Nothing is invented. */
export function ScoresCard({ profile }: { profile: CandidateProfile }) {
  const resume = profile.shortlist
  const call = profile.screening && !profile.screening.skipped ? profile.screening : null
  if (!resume && !call) return null
  const verdict = matchVerdict(profile)
  const bar = resume ? (resume.match_score >= 70 ? 'bg-pos' : resume.match_score >= 50 ? 'bg-warn' : 'bg-neg') : ''
  return (
    <Card title="Scores">
      <dl className="space-y-4">
        {resume && (
          <div>
            <div className="flex items-baseline justify-between">
              <dt className="text-[12px] text-ink-muted">Resume match</dt>
              <dd className="font-mono text-lg font-semibold tabular-nums text-ink">{Math.round(resume.match_score)}</dd>
            </div>
            <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className={cn('h-full rounded-full', bar)} style={{ width: `${Math.max(3, Math.min(100, resume.match_score))}%` }} />
            </div>
            {verdict && <p className="mt-1.5 text-[12px] text-ink-muted">{verdict.label}</p>}
          </div>
        )}
        {call?.result && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[12px] text-ink-muted">Phone screening</dt>
            <dd className="text-sm font-medium text-ink">{CALL_RESULT[call.result] ?? call.result}</dd>
          </div>
        )}
        {call?.communication_quality && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[12px] text-ink-muted">Communication</dt>
            <dd className="text-sm font-medium capitalize text-ink">{call.communication_quality}</dd>
          </div>
        )}
      </dl>
    </Card>
  )
}

const NODE: Record<PipelineEvent['state'], string> = {
  done: 'border-ink bg-ink text-surface',
  current: 'border-ink bg-surface text-ink ring-2 ring-line-strong',
  skipped: 'border-line-strong bg-surface text-ink-subtle',
  upcoming: 'border-line bg-surface text-ink-subtle',
  rejected: 'border-neg bg-neg text-surface',
}

/** The pipeline as a vertical timeline: each step's state, what it produced, and the day. */
export function PipelineCard({ profile }: { profile: CandidateProfile }) {
  const events = pipelineEvents(profile)
  if (events.length === 0) return null
  return (
    <Card title="Pipeline">
      <ol>
        {events.map((event, i) => (
          <li key={event.key} className="relative flex gap-3 pb-5 last:pb-0">
            {i < events.length - 1 && <span aria-hidden className="absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-px bg-line" />}
            <span aria-hidden className={cn('z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold', NODE[event.state])}>
              {event.state === 'done' ? <Check size={13} /> : event.state === 'skipped' ? <Minus size={13} /> : event.state === 'rejected' ? <X size={13} /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className={cn('text-sm font-medium', event.state === 'upcoming' ? 'text-ink-subtle' : 'text-ink')}>
                {event.label}
                <span className="sr-only"> ({event.state})</span>
              </p>
              {(event.detail || event.at) && (
                <p className="text-[12px] text-ink-muted">
                  {[event.at, event.detail].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}

/** The resume file, opened through a fresh short-lived link. Hidden when no file is stored. */
export function DocumentsCard({ profile }: { profile: CandidateProfile }) {
  const [opening, setOpening] = useState(false)
  // Only to know whether a file exists: a 404 means none is stored, so the card is not shown.
  const { data: link, isError } = useQuery({
    queryKey: ['candidate', profile.id, 'resume-link'],
    queryFn: () => api.get(`/api/candidates/${profile.id}/resume-link`) as unknown as Promise<ResumeLink>,
    enabled: !!profile.resume_file_path,
    retry: false,
    staleTime: 10 * 60_000,
  })
  if (!profile.resume_file_path || isError || !link) return null

  const open = async () => {
    setOpening(true)
    try {
      // A new link each time: the one fetched on load may have expired.
      const fresh = (await api.get(`/api/candidates/${profile.id}/resume-link`)) as unknown as ResumeLink
      window.open(fresh.url, '_blank', 'noopener,noreferrer')
    } catch {
      toast.error('Could not open the resume')
    } finally {
      setOpening(false)
    }
  }

  return (
    <Card title="Documents">
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2/50 p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-muted">
          <FileText size={16} aria-hidden />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={link.filename}>
          {link.filename}
        </p>
        <button type="button" onClick={() => void open()} disabled={opening} className={BTN_SECONDARY} aria-label={`Open ${link.filename}`}>
          {opening ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <ExternalLink size={13} aria-hidden />}
          Open
        </button>
      </div>
    </Card>
  )
}
