/** The resume-screening (shortlist) report, single and bulk, as plain data. */
import type { ShortlistResultWithCandidate } from '../../../types/api.ts'
import { SKILL_STATUS_LABEL, formatHrDecision, formatRecommendation } from '../../reportLabels.ts'
import { buildSkillMatchMap } from '../../skillMatch.ts'
import { formatDateTime } from '../format.ts'
import type { Tone } from '../theme.ts'

const SKILL_TONE: Record<'matched' | 'gap' | 'unclear', Tone> = {
  matched: 'pos',
  gap: 'neg',
  unclear: 'neutral',
}

/** At 70 and above a match is strong, at 50 and above partial. A statement of fit, so a status colour. */
export function matchTone(score: number): Tone {
  if (score >= 70) return 'pos'
  if (score >= 50) return 'warn'
  return 'neg'
}

export interface ShortlistCandidateModel {
  name: string
  email: string | null
  metrics: { label: string; value: string; tone: Tone }[]
  skills: { skill: string; status: string; tone: Tone }[]
  strengths: string[]
  gaps: string[]
  assessment: string | null
}

export interface ShortlistReportModel {
  title: string
  footerTitle: string
  jobTitle: string | null
  generatedOn: string
  candidate: ShortlistCandidateModel
}

export interface ShortlistBundleModel {
  title: string
  footerTitle: string
  jobTitle: string | null
  generatedOn: string
  count: number
  summary: { rank: number; name: string; email: string; score: string; recommendation: string; decision: string }[]
  candidates: ShortlistCandidateModel[]
}

function candidateModel(result: ShortlistResultWithCandidate, requiredSkills: string[]): ShortlistCandidateModel {
  const strengths = (result.strengths ?? []).filter((s) => s.trim())
  const gaps = (result.gaps ?? []).filter((s) => s.trim())
  return {
    name: result.candidate_name?.trim() || 'Candidate',
    email: result.candidate_email?.trim() || null,
    metrics: [
      { label: 'Match score', value: `${Math.round(result.match_score)}%`, tone: matchTone(result.match_score) },
      { label: 'AI recommendation', value: formatRecommendation(result.recommendation), tone: 'accent' },
      { label: 'HR decision', value: formatHrDecision(result.hr_decision), tone: 'neutral' },
    ],
    skills: buildSkillMatchMap(requiredSkills, strengths, gaps).map((entry) => ({
      skill: entry.skill,
      status: SKILL_STATUS_LABEL[entry.status],
      tone: SKILL_TONE[entry.status],
    })),
    strengths,
    gaps,
    assessment: result.reason?.trim() || null,
  }
}

export function buildShortlistReportModel(
  result: ShortlistResultWithCandidate,
  requiredSkills: string[],
  options: { jobTitle?: string; timeZone?: string } = {},
  now: Date = new Date(),
): ShortlistReportModel {
  return {
    title: 'Resume Screening Report',
    footerTitle: 'Resume Screening Report',
    jobTitle: options.jobTitle?.trim() || null,
    generatedOn: formatDateTime(now, options.timeZone),
    candidate: candidateModel(result, requiredSkills),
  }
}

export function buildShortlistBundleModel(
  results: ShortlistResultWithCandidate[],
  requiredSkills: string[],
  options: { jobTitle?: string; timeZone?: string } = {},
  now: Date = new Date(),
): ShortlistBundleModel {
  const sorted = [...results].sort((a, b) => b.match_score - a.match_score)
  return {
    title: 'Resume Screening Export',
    footerTitle: 'Resume Screening Export',
    jobTitle: options.jobTitle?.trim() || null,
    generatedOn: formatDateTime(now, options.timeZone),
    count: sorted.length,
    summary: sorted.map((r, index) => ({
      rank: index + 1,
      name: r.candidate_name?.trim() || '—',
      email: r.candidate_email?.trim() || '—',
      score: `${Math.round(r.match_score)}%`,
      recommendation: formatRecommendation(r.recommendation),
      decision: formatHrDecision(r.hr_decision),
    })),
    candidates: sorted.map((r) => candidateModel(r, requiredSkills)),
  }
}
