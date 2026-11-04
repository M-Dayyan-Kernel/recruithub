import type { ShortlistResultWithCandidate } from '../types/api.ts'

/**
 * Whether a scored candidate is still the Resume Screening list's to decide. Approved ones are in
 * Phone screening or Interviews and rejected ones in Rejected, so only these belong on that list.
 */
export function isAwaitingDecision(result: Pick<ShortlistResultWithCandidate, 'hr_decision'>): boolean {
  return result.hr_decision !== 'approved' && result.hr_decision !== 'rejected'
}

export interface DecisionCopy {
  title: string
  body: string
  confirmLabel: string
}

/**
 * What the confirmation dialog says. Approving does something to the candidate (a call or
 * an invite), so the dialog names which; rejecting says they move to Rejected and are not
 * emailed yet.
 */
export function decisionCopy(
  decision: 'approved' | 'rejected',
  opts: { name: string; score?: number; screeningEffective: boolean; count?: number },
): DecisionCopy {
  const { name, score, screeningEffective } = opts
  const count = opts.count ?? 1
  const who =
    count > 1
      ? `${count} candidates`
      : score === undefined
        ? name
        : `${name} (${Math.round(score)}%)`

  if (decision === 'approved') {
    return {
      title: `Approve ${who}?`,
      body: screeningEffective
        ? `${count > 1 ? 'Each candidate' : 'The candidate'} will be scheduled for an AI voice screening call. Once approved, they are managed from the Phone screening tab.`
        : `${count > 1 ? 'Each candidate' : 'The candidate'} will be emailed an interview invitation. Once approved, they are managed from the Interviews tab.`,
      confirmLabel: screeningEffective ? 'Approve and start screening' : 'Approve and send invite',
    }
  }
  return {
    title: `Reject ${who}?`,
    body: `${count > 1 ? 'Each candidate' : 'The candidate'} moves to Rejected. They are not emailed until you send it from the Rejected list, and you can reconsider until then.`,
    confirmLabel: count > 1 ? `Reject ${count}` : 'Reject candidate',
  }
}

/** The text of a failed decision request, so a 409 from a stale page reads as itself. */
export function decisionErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message
  return 'Could not update the decision. Please try again.'
}
