/**
 * The interview report as plain data: everything the PDF prints, with the wording, tones and
 * limits already decided, so the layout code only places it. The transcript is deliberately not
 * part of this model: a report is a summary of the interview, not a copy of it.
 */
import type { InterviewReport } from '../../../types/api.ts'
import { excerpt, formatDateTime, formatOutOf } from '../format.ts'
import type { Tone } from '../theme.ts'
import { buildProctoringModel, type ProctoringModel } from './proctoring.ts'

export const ANSWER_EXCERPT_CHARS = 280

const RECOMMENDATION_LABEL: Record<string, string> = {
  strong_hire: 'Strong Hire',
  hire: 'Hire',
  hold: 'Hold',
  no_hire: 'No Hire',
  needs_review: 'Needs Review',
}

const RECOMMENDATION_TONE: Record<string, Tone> = {
  strong_hire: 'pos',
  hire: 'pos',
  hold: 'warn',
  no_hire: 'neg',
  needs_review: 'neutral',
}

const LEGACY_SCORES: { key: keyof InterviewReport; label: string }[] = [
  { key: 'technical_fit_score', label: 'Technical fit' },
  { key: 'communication_score', label: 'Communication' },
  { key: 'problem_solving_score', label: 'Problem solving' },
  { key: 'experience_score', label: 'Experience' },
  { key: 'role_alignment_score', label: 'Role alignment' },
]

export interface QuestionModel {
  number: number
  text: string
  earned: number | null
  max: number
  scoreLabel: string
  /** Share of the points a good answer covers, 0..1; null when coverage was not assessed. */
  coverage: number | null
  coverageLabel: string | null
  points: { text: string; covered: boolean }[]
  answerExcerpt: string | null
}

export interface InterviewReportModel {
  title: string
  footerTitle: string
  candidateName: string
  jobTitle: string | null
  generatedOn: string
  recommendation: { label: string; tone: Tone } | null
  overall: { label: string; tone: Tone } | null
  /** The recording's home in the HR app. Never the (expiring, unauthenticated) storage URL. */
  recording: { available: true; url: string; label: string } | { available: false; label: string }
  summary: string | null
  jdFit: string | null
  strengths: string[]
  weaknesses: string[]
  questions: QuestionModel[]
  /** Only for reports that predate per-question scoring. */
  legacyScores: { label: string; value: string }[]
  coverageTotals: { covered: number; total: number } | null
  proctoring: ProctoringModel
}

/** Where the report page for this interview lives in the HR app. */
export function reportPageUrl(origin: string, jobId: string, candidateId: string): string {
  return `${origin.replace(/\/+$/, '')}/jobs/${jobId}/candidates/${candidateId}/report`
}

function scoreTone(value: number, max: number): Tone {
  const ratio = max > 0 ? value / max : 0
  if (ratio >= 0.7) return 'pos'
  if (ratio >= 0.5) return 'warn'
  return 'neg'
}

export interface InterviewModelOptions {
  /** window.location.origin where the report is generated; the recording link points back to it. */
  origin: string
  now?: Date
  timeZone?: string
}

export function buildInterviewReportModel(
  report: InterviewReport,
  { origin, now = new Date(), timeZone }: InterviewModelOptions,
): InterviewReportModel {
  const rubricTotal = report.rubric_total ?? 100
  const rec = report.final_recommendation ?? ''

  const questions: QuestionModel[] = (report.question_scores ?? []).map((q, index) => {
    const points = (q.point_coverage ?? []).map((p) => ({ text: p.point, covered: p.covered }))
    const covered = points.filter((p) => p.covered).length
    return {
      number: index + 1,
      text: q.question,
      earned: q.earned_score ?? null,
      max: q.score,
      scoreLabel: formatOutOf(q.earned_score ?? null, q.score),
      coverage: points.length > 0 ? covered / points.length : null,
      coverageLabel: points.length > 0 ? `${covered}/${points.length} points covered` : null,
      points,
      // Shown whether or not coverage exists: it is what the candidate actually said.
      answerExcerpt: excerpt(q.candidate_answer, ANSWER_EXCERPT_CHARS),
    }
  })

  const allPoints = questions.flatMap((q) => q.points)
  const legacyScores = questions.length
    ? []
    : LEGACY_SCORES.flatMap(({ key, label }) => {
        const value = report[key]
        return typeof value === 'number' ? [{ label, value: formatOutOf(value, 100) }] : []
      })

  return {
    title: 'AI Interview Report',
    footerTitle: 'Interview Report',
    candidateName: report.candidate_name?.trim() || 'Candidate',
    jobTitle: report.job_title?.trim() || null,
    generatedOn: formatDateTime(now, timeZone),
    recommendation: rec
      ? { label: RECOMMENDATION_LABEL[rec] ?? rec, tone: RECOMMENDATION_TONE[rec] ?? 'neutral' }
      : null,
    overall:
      report.overall_score != null
        ? {
            label: formatOutOf(report.overall_score, rubricTotal),
            tone: scoreTone(report.overall_score, rubricTotal),
          }
        : null,
    // The page knows the recording exists exactly when the API returned a playable URL for it.
    recording: report.recording_url
      ? {
          available: true,
          url: reportPageUrl(origin, report.job_id, report.candidate_id),
          label: 'Watch interview recording',
        }
      : { available: false, label: 'Recording not available' },
    summary: report.summary?.trim() || null,
    jdFit: report.jd_fit?.trim() || null,
    strengths: (report.strengths ?? []).filter((s) => s.trim()),
    weaknesses: (report.weaknesses ?? []).filter((s) => s.trim()),
    questions,
    legacyScores,
    coverageTotals: allPoints.length
      ? { covered: allPoints.filter((p) => p.covered).length, total: allPoints.length }
      : null,
    proctoring: buildProctoringModel(report.video_proctoring, report.integrity),
  }
}
