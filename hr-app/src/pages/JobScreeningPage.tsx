import { Navigate, useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { JobOutletContext } from '@/components/JobLayout'
import { ScreeningTab } from '@/components/ScreeningTab'
import { api } from '@/lib/api'
import type { SystemSettings } from '@/types/api'
import { isVoiceScreeningEffective } from '@/lib/voiceScreening'

export default function JobScreeningPage() {
  const { job, jobId } = useOutletContext<JobOutletContext>()
  const { data: settings, isLoading } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings') as unknown as Promise<SystemSettings>,
  })

  if (!isLoading && !isVoiceScreeningEffective(settings, job)) {
    return <Navigate to={`/jobs/${jobId}/interviews?tab=scheduled`} replace />
  }

  return <ScreeningTab jobId={jobId} />
}
