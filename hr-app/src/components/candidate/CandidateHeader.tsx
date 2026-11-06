import { Mail, MapPin, Phone } from 'lucide-react'
import type { CandidateProfile } from '@/types/api'
import { MatchRing } from '@/components/candidate/MatchRing'
import { MoveStageMenu } from '@/components/candidate/MoveStageMenu'
import { headerChips, matchVerdict, profileStageKey, profileStageView } from '@/lib/candidateProfileView'
import { PIPELINE_STAGE_DOT } from '@/lib/pipelineStages'
import { initialsOf } from '@/lib/timeAgo'
import { isPlaceholderEmail } from '@/lib/validation'
import { cn } from '@/lib/utils'

const VERDICT_TEXT = { pos: 'text-pos', warn: 'text-warn', neg: 'text-neg', neutral: 'text-ink-muted', accent: 'text-ink-muted' } as const

/** Who the candidate is, where they are, the match, and the way to move them on. */
export function CandidateHeader({ profile }: { profile: CandidateProfile }) {
  const stage = profileStageView(profile)
  const stageKey = profileStageKey(profile)
  const verdict = matchVerdict(profile)
  const chips = headerChips(profile)
  const role = [profile.parsed_data?.current_role, profile.parsed_data?.current_company].filter(Boolean).join(' · ')
  const email = isPlaceholderEmail(profile.email) ? null : profile.email
  const location = profile.screening && !profile.screening.skipped ? profile.screening.location_preference : null

  return (
    <header className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-3 text-lg font-semibold text-ink-muted"
        >
          {initialsOf(profile.name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="break-words text-xl font-semibold tracking-tight text-ink">{profile.name}</h1>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-[12px] font-medium text-ink">
              {stageKey && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', PIPELINE_STAGE_DOT[stageKey])} />}
              {stage.label}
            </span>
          </div>
          <p className="mt-0.5 break-words text-sm text-ink-muted">
            {role || profile.job_title}
            {stage.detail && <span> · {stage.detail}{stage.at && <span className="font-mono tabular-nums">, {stage.at}</span>}</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
            {email && (
              <span className="inline-flex items-center gap-1.5">
                <Mail size={13} aria-hidden />
                {email}
              </span>
            )}
            {profile.phone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone size={13} aria-hidden />
                {profile.phone}
              </span>
            )}
            {location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={13} aria-hidden />
                {location}
              </span>
            )}
          </div>
          {chips.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Key facts">
              {chips.map((chip) => (
                <li key={chip} className="rounded-full bg-surface-3 px-2.5 py-1 text-[12px] font-medium text-ink">
                  {chip}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-3">
          {profile.shortlist && (
            <div className="flex items-center gap-3">
              {verdict && (
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Match</p>
                  <p className={cn('text-sm font-semibold', VERDICT_TEXT[verdict.tone])}>{verdict.label}</p>
                </div>
              )}
              <MatchRing score={profile.shortlist.match_score} />
            </div>
          )}
          <MoveStageMenu profile={profile} />
        </div>
      </div>
    </header>
  )
}
