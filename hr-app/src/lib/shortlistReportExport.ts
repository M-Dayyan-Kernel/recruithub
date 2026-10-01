import { buildSkillMatchMap } from '@/lib/skillMatch'
import type { ShortlistResultWithCandidate } from '@/types/api'

const SKILL_STATUS_LABEL = {
  matched: 'Matched',
  gap: 'Gap',
  unclear: 'Unclear',
} as const

export function slugifyFilename(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'export'
}

function formatRecommendation(rec: ShortlistResultWithCandidate['recommendation']): string {
  if (rec === 'shortlisted') return 'Shortlisted'
  if (rec === 'rejected') return 'Rejected'
  return 'Review'
}

function formatHrDecision(decision: ShortlistResultWithCandidate['hr_decision']): string {
  if (decision === 'pending') return 'Pending'
  if (decision === 'approved') return 'Approved'
  if (decision === 'rejected') return 'Rejected'
  return 'Overridden'
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function buildShortlistCsv(
  results: ShortlistResultWithCandidate[],
  requiredSkills: string[],
): string {
  const headers = [
    'Name',
    'Email',
    'Match Score (%)',
    'AI Recommendation',
    'HR Decision',
    'Strengths',
    'Gaps',
    'Skill Match',
    'AI Assessment',
  ]

  const rows = [...results]
    .sort((a, b) => b.match_score - a.match_score)
    .map((result) => {
      const skillSummary = buildSkillMatchMap(
        requiredSkills,
        result.strengths ?? [],
        result.gaps ?? [],
      )
        .map((entry) => `${entry.skill} (${SKILL_STATUS_LABEL[entry.status]})`)
        .join('; ')

      return [
        result.candidate_name ?? '',
        result.candidate_email ?? '',
        Math.round(result.match_score),
        formatRecommendation(result.recommendation),
        formatHrDecision(result.hr_decision),
        (result.strengths ?? []).join('; '),
        (result.gaps ?? []).join('; '),
        skillSummary,
        result.reason ?? '',
      ].map(csvEscape)
    })

  return [headers.map(csvEscape).join(','), ...rows.map((row) => row.join(','))].join('\n')
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'text/plain;charset=utf-8',
): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function exportTimestamp(): string {
  return new Date().toISOString().slice(0, 10)
}
