/**
 * Wording for report values, shared by the CSV export and the PDF reports so a recommendation
 * never reads differently in two places. Pure, with relative imports.
 */
import type { ShortlistResult } from '../types/api.ts'

export type SkillStatus = 'matched' | 'gap' | 'unclear'

export const SKILL_STATUS_LABEL: Record<SkillStatus, string> = {
  matched: 'Matched',
  gap: 'Gap',
  unclear: 'Unclear',
}

export function formatRecommendation(rec: ShortlistResult['recommendation']): string {
  if (rec === 'shortlisted') return 'Shortlisted'
  if (rec === 'rejected') return 'Rejected'
  return 'Review'
}

export function formatHrDecision(decision: ShortlistResult['hr_decision']): string {
  if (decision === 'pending') return 'Pending'
  if (decision === 'approved') return 'Approved'
  if (decision === 'rejected') return 'Rejected'
  return 'Overridden'
}
