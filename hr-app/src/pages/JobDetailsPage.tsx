import { useOutletContext } from 'react-router-dom'
import type { JobOutletContext } from '@/components/JobLayout'
import { JobPipelineDashboard } from '@/components/job/JobPipelineDashboard'

/** Job overview — JobHeader is rendered by JobLayout on this route. */
export default function JobDetailsPage() {
  const { job } = useOutletContext<JobOutletContext>()
  return <JobPipelineDashboard job={job} />
}
