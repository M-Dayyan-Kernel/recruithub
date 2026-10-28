/** The phone-screening report as plain data. The call transcript is not part of it. */
import type { ScreeningCall, ScreeningResult } from '../../../types/api.ts'
import { formatDateTime, humanize } from '../format.ts'
import type { Tone } from '../theme.ts'

/** A screening field with a real value: not null, empty or a literal "null". Mirrors screeningUtils. */
export function displayField(value?: string | null): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  return ['null', 'none', 'n/a', 'na', 'undefined', '-'].includes(trimmed.toLowerCase()) ? null : trimmed
}

const RESULT: Record<ScreeningResult, { label: string; tone: Tone }> = {
  pass: { label: 'Passed', tone: 'pos' },
  fail: { label: 'Failed', tone: 'neg' },
  needs_review: { label: 'Needs review', tone: 'warn' },
}

export interface ScreeningReportOptions {
  candidateName?: string
  phone?: string | null
  jobTitle?: string
  attemptNumber?: number
  timeZone?: string
}

export interface ScreeningReportModel {
  title: string
  footerTitle: string
  jobTitle: string | null
  candidateName: string
  meta: string[]
  metrics: { label: string; value: string; tone: Tone }[]
  summary: string | null
  details: { label: string; value: string }[]
  generatedOn: string
}

function willingness(value: boolean | null | undefined): string {
  if (value === true) return 'Interested'
  if (value === false) return 'Not interested'
  return '—'
}

export function buildScreeningReportModel(
  call: ScreeningCall,
  options: ScreeningReportOptions = {},
  now: Date = new Date(),
): ScreeningReportModel {
  const result = RESULT[call.result ?? 'needs_review'] ?? RESULT.needs_review

  const rows: [string, string | null | undefined][] = [
    ['Relevant experience', call.relevant_experience],
    ['Employment status', call.employment_status],
    ['Location preference', call.location_preference],
    ['Availability to join', call.availability],
    ['Notice period', call.notice_period],
    ['Current CTC', call.current_ctc],
    ['Expected CTC', call.expected_ctc],
  ]

  const quality = displayField(call.communication_quality)

  return {
    title: 'AI Screening Report',
    footerTitle: 'AI Screening Report',
    jobTitle: options.jobTitle?.trim() || null,
    candidateName: options.candidateName?.trim() || 'Candidate',
    meta: [
      displayField(options.phone),
      formatDateTime(call.created_at, options.timeZone) || null,
      options.attemptNumber != null ? `Attempt ${options.attemptNumber}` : null,
      call.ended_reason ? humanize(call.ended_reason) : null,
    ].filter((part): part is string => !!part),
    metrics: [
      { label: 'Screening result', value: result.label, tone: result.tone },
      { label: 'Willingness', value: willingness(call.willingness_to_proceed), tone: 'neutral' },
      { label: 'Communication', value: quality ? humanize(quality) : '—', tone: 'neutral' },
    ],
    summary: displayField(call.summary),
    details: rows.flatMap(([label, value]) => {
      const shown = displayField(value)
      return shown ? [{ label, value: shown }] : []
    }),
    generatedOn: formatDateTime(now, options.timeZone),
  }
}
