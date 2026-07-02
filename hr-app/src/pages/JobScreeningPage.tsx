import { useOutletContext } from 'react-router-dom'
import type { JobOutletContext } from '@/components/JobLayout'
import { ScreeningTab } from '@/components/ScreeningTab'

export default function JobScreeningPage() {
  const { jobId } = useOutletContext<JobOutletContext>()
  return <ScreeningTab jobId={jobId} />
}
