import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { INPUT } from '@/components/ui/Surface'
import { RequiredMark } from '@/components/FieldError'
import type { InterviewSession } from '@/types/api'

const REASON_MAX_LENGTH = 500

interface Props {
  candidateId: string
  candidateName: string
  roundNumber: number
  onClose: () => void
  onVoided: () => void
}

/**
 * Voids the current taken round so the candidate can retake it, e.g. after a technical problem.
 * The round's report stays on file, marked voided, and the candidate gets a fresh link.
 */
export function VoidRoundDialog({ candidateId, candidateName, roundNumber, onClose, onVoided }: Props) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/api/candidates/${candidateId}/interview/void`, {
        reason: reason.trim(),
      }) as unknown as Promise<InterviewSession>,
    onSuccess: () => {
      toast.success(`Round ${roundNumber} voided — ${candidateName} was sent a new link`)
      onVoided()
      onClose()
    },
    onError: (err: Error) => setError(err.message || 'Could not void this round.'),
  })

  return (
    <ConfirmDialog
      title={`Void round ${roundNumber} for ${candidateName}?`}
      body={
        <p>
          {candidateName} gets a new link to retake round {roundNumber}. The current report stays on
          file, marked voided, and does not count. This cannot be undone.
        </p>
      }
      confirmLabel="Void round"
      busy={mutation.isPending}
      error={error}
      confirmDisabled={!reason.trim()}
      onConfirm={() => {
        setError(null)
        mutation.mutate()
      }}
      onClose={onClose}
    >
      <label htmlFor="void-reason" className="block text-[13px] font-medium text-ink">
        Reason
        <RequiredMark />
      </label>
      <textarea
        id="void-reason"
        value={reason}
        maxLength={REASON_MAX_LENGTH}
        rows={3}
        onChange={(e) => setReason(e.target.value)}
        disabled={mutation.isPending}
        placeholder="e.g. The candidate's connection dropped twice"
        className={`${INPUT} mt-1.5 h-auto py-2`}
      />
    </ConfirmDialog>
  )
}
