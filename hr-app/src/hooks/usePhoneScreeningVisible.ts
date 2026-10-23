import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { VoiceScreeningPreview } from '@/lib/voiceScreeningSwitch'

/**
 * Whether the job shows a Phone screening step.
 *
 * With voice screening on, always. With it off, only while candidates from the phone
 * round are still there to deal with (waiting, on a call that is finishing, or with a call
 * result to act on): hiding the tab then would leave them where nobody can reach them.
 * The count comes from the same preview the voice-screening switch uses.
 */
/** The switch preview, one definition for every reader of the cache entry. */
export function voiceScreeningPreviewQuery(jobId: string) {
  return {
    queryKey: ['voice-screening', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}/voice-screening`) as unknown as Promise<VoiceScreeningPreview>,
  }
}

export function usePhoneScreeningVisible(job: { id: string; voice_screening_enabled?: boolean }) {
  const screeningOn = job.voice_screening_enabled !== false
  const { data, isLoading, isError } = useQuery({ ...voiceScreeningPreviewQuery(job.id), enabled: !screeningOn })
  const leftOver = data ? data.in_phone_round.length + data.live_calls + data.with_call_result : 0
  return {
    screeningOn,
    // If the count cannot be fetched, keep the tab: hiding it would strand anyone left.
    visible: screeningOn || isError || leftOver > 0,
    // Off and not yet known: callers that redirect must wait rather than guess.
    loading: !screeningOn && isLoading,
  }
}
