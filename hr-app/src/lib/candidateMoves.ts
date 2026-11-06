import type { PipelineStageKey } from '../types/api.ts'

/**
 * The ways HR can move a candidate on from the candidate page, by the stage they are in. These are
 * the same actions the stage pages offer (approve and reject on Resume screening, send a link or
 * move on from a call on Phone screening, mark a finalist, reconsider), gathered in one menu, so the
 * page never offers a move the stage's own page would not.
 */

export type MoveId = 'approve' | 'reject' | 'send_interview' | 'advance' | 'finalist' | 'reconsider' | 'retry'

export const MOVE_LABEL: Record<MoveId, string> = {
  approve: 'Approve',
  reject: 'Reject',
  send_interview: 'Send interview link',
  advance: 'Move to interview',
  finalist: 'Mark as finalist',
  reconsider: 'Reconsider',
  retry: 'Retry the resume review',
}

export function availableMoves(stage: PipelineStageKey | null | undefined, state: string | null | undefined): MoveId[] {
  switch (stage) {
    case 'resume':
      return ['approve', 'reject']
    case 'phone':
      // A passed (or reviewable) call: the next step is the interview link.
      if (state === 'pending' || state === 'review') return ['send_interview', 'reject']
      // Nothing will call them (flagged, cancelled, screening off): move them on by hand.
      if (state === 'flagged' || state === 'cancelled' || state === 'paused') return ['advance', 'reject']
      return ['reject']
    case 'interview':
      return state === 'completed' ? ['finalist', 'reject'] : ['reject']
    case 'rejected':
      return ['reconsider']
    case 'failed':
      return ['retry']
    // Still being read, or a finalist (who cannot be rejected): nothing to move.
    default:
      return []
  }
}
