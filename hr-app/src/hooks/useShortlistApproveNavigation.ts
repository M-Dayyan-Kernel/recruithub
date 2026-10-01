import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { ShortlistDecisionResponse } from '@/types/api'

export function navigateAfterScreeningSkipped(
  jobId: string,
  navigate: ReturnType<typeof useNavigate>,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
  navigate(`/jobs/${jobId}/interviews?tab=scheduled`)
}

export function useShortlistApproveNavigation(jobId: string) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return (data: ShortlistDecisionResponse) => {
    if (!data.screening_skipped) return

    if (data.interview_email_sent === false) {
      toast.error('Approved, but the interview email could not be sent. Check the candidate email.')
    } else if (data.interview_email_sent) {
      toast.success('Interview link sent — candidate moved to Scheduled')
    } else {
      toast.success('Candidate moved to Scheduled interviews')
    }

    navigateAfterScreeningSkipped(jobId, navigate, queryClient)
  }
}
