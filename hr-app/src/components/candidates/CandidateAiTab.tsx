import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { CandidateProfile, Job, ShortlistResultWithCandidate } from '@/types/api'
import { ShortlistReportContent } from '@/components/shortlist/ShortlistReportContent'

interface Props {
  profile: CandidateProfile
}

export function CandidateAiTab({ profile }: Props) {
  const { data: job } = useQuery<Job>({
    queryKey: ['job', profile.job_id],
    queryFn: () => api.get(`/api/jobs/${profile.job_id}`) as unknown as Promise<Job>,
  })

  if (!profile.shortlist) {
    return (
      <p className="text-sm text-slate-500">No resume screening analysis available yet for this candidate.</p>
    )
  }

  const result: ShortlistResultWithCandidate = {
    ...profile.shortlist,
    strengths: profile.shortlist.strengths ?? [],
    gaps: profile.shortlist.gaps ?? [],
    reason: profile.shortlist.reason ?? '',
    candidate_name: profile.name,
    candidate_email: profile.email,
  }

  return (
    <ShortlistReportContent
      result={result}
      requiredSkills={job?.required_skills ?? []}
    />
  )
}
