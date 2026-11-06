import type { CandidateProfile, PipelineCandidate, PipelineStageKey } from '../types/api.ts'
import { buildCandidateSteps, type StepKey, type StepState } from './candidateSteps.ts'
import { describePipelineCandidate, type CandidateStageView, type StageTone } from './pipelineStages.ts'
import { buildSkillMatchMap, summarizeSkillMatches, type SkillMatchEntry } from './skillMatch.ts'
import { shortDate } from './timeAgo.ts'

/**
 * What the candidate page shows, worked out from the profile: the stage, the match verdict, the
 * skills against the job's, the collected details, and the pipeline with dates. Pure, so each rule is
 * tested on its own; the components only lay these out. Anything with nothing to show comes back
 * empty, and the page hides it rather than showing a blank.
 */

export function profileStageKey(profile: CandidateProfile): PipelineStageKey | null {
  return profile.pipeline_stage ?? null
}

/**
 * A best guess at the stage from what the profile holds, for the timeline when the server could not
 * say (an older API, or a failed lookup). Never used to offer a move: that needs the real state.
 */
function inferStage(profile: CandidateProfile): PipelineStageKey | null {
  if ((profile.interview_sessions ?? []).length > 0) return 'interview'
  if (profile.screening && !profile.screening.skipped) return 'phone'
  return profile.shortlist ? 'resume' : null
}

/** The stage as words. Falls back to the directory's label if the server could not place them. */
export function profileStageView(profile: CandidateProfile): CandidateStageView {
  const stage = profile.pipeline_stage
  if (!stage) return { label: profile.hiring_stage, detail: '', tone: 'neutral' }
  const asPipeline: PipelineCandidate = {
    candidate_id: profile.id,
    name: profile.name,
    stage,
    state: profile.stage_state,
    reason: profile.stage_reason,
    scheduled_at: profile.stage_scheduled_at,
    applied_at: profile.date_applied,
    updated_at: profile.date_applied,
  }
  return describePipelineCandidate(asPipeline)
}

const VERDICT: Record<string, { label: string; tone: StageTone }> = {
  shortlisted: { label: 'Strong fit', tone: 'pos' },
  review: { label: 'Needs review', tone: 'warn' },
  rejected: { label: 'Weak fit', tone: 'neg' },
}

export function matchVerdict(profile: CandidateProfile): { label: string; tone: StageTone } | null {
  const rec = profile.shortlist?.recommendation
  return rec ? (VERDICT[rec] ?? null) : null
}

export interface SkillSummary {
  entries: SkillMatchEntry[]
  matched: number
  total: number
  /** Skills on the resume that the job did not ask for. */
  other: string[]
}

/** The job's required skills against what the AI found, plus the candidate's other skills. */
export function skillSummary(profile: CandidateProfile, requiredSkills: string[]): SkillSummary | null {
  const shortlist = profile.shortlist
  if (!shortlist || requiredSkills.length === 0) return null
  const entries = buildSkillMatchMap(requiredSkills, shortlist.strengths ?? [], shortlist.gaps ?? [])
  const required = requiredSkills.map((s) => s.toLowerCase().trim())
  const other = (profile.parsed_data?.skills ?? []).filter((skill) => {
    const s = skill.toLowerCase().trim()
    return s && !required.some((r) => r.includes(s) || s.includes(r))
  })
  return { entries, matched: summarizeSkillMatches(entries).matched, total: requiredSkills.length, other }
}

export interface DetailRow {
  label: string
  value: string
}
export interface DetailSection {
  title: string
  rows: DetailRow[]
}

function pushRow(rows: DetailRow[], label: string, value: string | number | null | undefined) {
  const text = value == null ? '' : String(value).trim()
  if (text) rows.push({ label, value: text })
}

function yearsText(years: number | null | undefined): string {
  return years == null ? '' : `${Number.isInteger(years) ? years : years.toFixed(1)} ${years === 1 ? 'year' : 'years'}`
}

/** The collected details in three groups; a group with nothing in it is left out. */
export function detailSections(profile: CandidateProfile): DetailSection[] {
  const screening = profile.screening && !profile.screening.skipped ? profile.screening : null
  const parsed = profile.parsed_data

  const personal: DetailRow[] = []
  pushRow(personal, 'Full name', profile.name)
  pushRow(personal, 'Location preference', screening?.location_preference)

  const experience: DetailRow[] = []
  pushRow(experience, 'Total experience', yearsText(profile.years_experience ?? parsed?.total_experience_years))
  pushRow(experience, 'Relevant experience', screening?.relevant_experience)
  const role = [parsed?.current_role, parsed?.current_company].filter(Boolean).join(' · ')
  pushRow(experience, 'Current role', role)
  const education = parsed?.education?.[0]
  pushRow(experience, 'Education', education ? [education.degree, education.institution].filter(Boolean).join(', ') : '')

  const comp: DetailRow[] = []
  pushRow(comp, 'Current CTC', profile.current_ctc ?? screening?.current_ctc)
  pushRow(comp, 'Expected CTC', profile.expected_ctc ?? screening?.expected_ctc)
  pushRow(comp, 'Notice period', profile.notice_period ?? screening?.notice_period)
  pushRow(comp, 'Last working day', profile.last_working_day)
  pushRow(comp, 'Availability', screening?.availability)
  pushRow(comp, 'Employment status', screening?.employment_status)

  return [
    { title: 'Personal', rows: personal },
    { title: 'Experience', rows: experience },
    { title: 'Compensation & availability', rows: comp },
  ].filter((section) => section.rows.length > 0)
}

/** The short chips under the name: what a recruiter wants to know before opening anything. */
export function headerChips(profile: CandidateProfile): string[] {
  const chips: string[] = []
  if (profile.notice_period) chips.push(`Notice: ${profile.notice_period}`)
  if (profile.expected_ctc) chips.push(`Expects ${profile.expected_ctc}`)
  const years = yearsText(profile.years_experience ?? profile.parsed_data?.total_experience_years)
  if (years) chips.push(years)
  return chips
}

export interface PipelineEvent {
  key: StepKey | 'rejected'
  label: string
  state: StepState | 'rejected'
  detail?: string
  /** A short date, when the step has one. */
  at?: string
}

/** The pipeline as a timeline: each step's state and result, and the day it happened. */
export function pipelineEvents(profile: CandidateProfile): PipelineEvent[] {
  const stage = profile.pipeline_stage ?? inferStage(profile)
  if (!stage) return []
  const { steps, outcome } = buildCandidateSteps(stage, profile)
  const sessions = profile.interview_sessions ?? []
  const lastRound = sessions.length ? sessions.reduce((a, b) => (b.round_number >= a.round_number ? b : a)) : null
  const dates: Partial<Record<StepKey, string | null | undefined>> = {
    resume: profile.shortlist?.created_at,
    phone: profile.screening && !profile.screening.skipped ? profile.screening.created_at : null,
    interview: lastRound ? (lastRound.completed_at ?? lastRound.started_at ?? lastRound.created_at) : null,
  }
  const events: PipelineEvent[] = steps.map((step) => ({
    key: step.key,
    label: step.label,
    state: step.state,
    detail: step.detail,
    at: shortDate(dates[step.key]) || undefined,
  }))
  if (outcome === 'rejected') events.push({ key: 'rejected', label: 'Rejected', state: 'rejected' })
  return events
}
