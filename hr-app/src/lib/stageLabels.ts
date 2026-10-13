/**
 * Display names for hiring stages - the single place a stage is named for people.
 *
 * Stable identifiers (the API's `hiring_stage` values such as "Screening", the
 * `?stage=screening` filter keys, route segments) are deliberately NOT renamed:
 * they are data, compared in code and carried in URLs and bookmarks. Only what
 * a person reads goes through here, so renaming a stage is a one-line change.
 *
 * Dependency-free so it can be unit tested without the app's module aliases.
 */

/** The phone-call screening round (the API identifier stays "Screening"). */
export const PHONE_SCREENING_LABEL = 'Phone Screening'

/** The resume-review round (the API identifier is "AI Shortlisted"). */
export const RESUME_SCREENING_LABEL = 'Resume Screening'

export type CandidateStageFilter = 'ai_shortlisted' | 'screening' | 'interview' | 'finalists'

export const CANDIDATE_STAGE_FILTERS: Array<{
  value: CandidateStageFilter | ''
  label: string
}> = [
  { value: '', label: 'All stages' },
  { value: 'ai_shortlisted', label: RESUME_SCREENING_LABEL },
  { value: 'screening', label: PHONE_SCREENING_LABEL },
  { value: 'interview', label: 'Interview' },
  { value: 'finalists', label: 'Finalists' },
]

/** API stage identifier -> label shown to people. Unlisted stages show as sent. */
const HIRING_STAGE_DISPLAY: Record<string, string> = {
  'AI Shortlisted': RESUME_SCREENING_LABEL,
  Screening: PHONE_SCREENING_LABEL,
}

/** User-facing hiring stage label for an API `hiring_stage` value. */
export function formatHiringStage(stage: string | null | undefined): string {
  if (!stage) return 'N/A'
  return HIRING_STAGE_DISPLAY[stage] ?? stage
}
