import { useOutletContext } from 'react-router-dom'
import type { JobOutletContext } from '@/components/JobLayout'
import { InterviewsTab } from '@/components/InterviewsTab'

export default function JobInterviewsPage() {
  const { jobId } = useOutletContext<JobOutletContext>()
  return <InterviewsTab jobId={jobId} />
}
