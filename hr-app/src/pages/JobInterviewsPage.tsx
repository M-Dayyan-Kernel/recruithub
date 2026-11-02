import { Navigate, useOutletContext, useSearchParams } from 'react-router-dom'
import type { JobOutletContext } from '@/components/JobLayout'
import { InterviewsTab } from '@/components/InterviewsTab'

export default function JobInterviewsPage() {
  const { job, jobId } = useOutletContext<JobOutletContext>()
  const [searchParams] = useSearchParams()
  // Finalists used to be a tab here. Old links and bookmarks land on their own page now.
  if (searchParams.get('tab') === 'finalists') {
    return <Navigate to={`/jobs/${jobId}/finalists`} replace />
  }
  return <InterviewsTab job={job} jobId={jobId} />
}
