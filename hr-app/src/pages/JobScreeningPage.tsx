import { Navigate, useOutletContext } from 'react-router-dom'
import type { JobOutletContext } from '@/components/JobLayout'
import { ScreeningTab } from '@/components/ScreeningTab'
import { usePhoneScreeningVisible } from '@/hooks/usePhoneScreeningVisible'

export default function JobScreeningPage() {
  const { job, jobId } = useOutletContext<JobOutletContext>()
  // With screening off, the tab stays reachable while phone-round candidates remain;
  // only once nobody is left does it send HR on to Interviews.
  const { visible, loading } = usePhoneScreeningVisible(job)

  if (!loading && !visible) {
    return <Navigate to={`/jobs/${jobId}/interviews?tab=scheduled`} replace />
  }

  return <ScreeningTab jobId={jobId} />
}
