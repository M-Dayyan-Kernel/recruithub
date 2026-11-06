import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import { CandidateHeader } from '@/components/candidate/CandidateHeader'
import { DetailsCard, DocumentsCard, PipelineCard, ScoresCard, SkillsCard } from '@/components/candidate/CandidateCards'
import { CandidateAiTab } from '@/components/candidates/CandidateAiTab'
import { CandidateScreeningTab } from '@/components/candidates/CandidateScreeningTab'
import { CandidateInterviewTab } from '@/components/candidates/CandidateInterviewTab'
import { CandidateTimelineTab } from '@/components/candidates/CandidateTimelineTab'
import StageTabs from '@/components/stage/StageTabs'
import { useCandidateProfile } from '@/hooks/useCandidateProfile'
import { PHONE_SCREENING_LABEL } from '@/lib/stageLabels'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'resume', label: 'Resume analysis' },
  { id: 'phone', label: PHONE_SCREENING_LABEL },
  { id: 'interviews', label: 'Interviews' },
  { id: 'activity', label: 'Activity' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function CandidateProfilePage() {
  const { candidateId = '' } = useParams<{ candidateId: string }>()
  const location = useLocation()
  const [tab, setTab] = useState<TabId>('overview')
  const { data: profile, isLoading, isError, refetch } = useCandidateProfile(candidateId)
  const { data: job } = useQuery<Job>({
    queryKey: ['job', profile?.job_id],
    queryFn: () => api.get(`/api/jobs/${profile?.job_id}`) as unknown as Promise<Job>,
    enabled: !!profile?.job_id,
  })

  // Back to the candidate list with the search and filters it was left with.
  const listHref = `/candidates${location.search}`

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-ink-subtle" aria-label="Loading candidate" />
      </div>
    )
  }

  if (isError || !profile) {
    return (
      <div className="space-y-4">
        <Link to={listHref} className="text-sm font-medium text-ink-muted hover:text-ink">
          Back to candidates
        </Link>
        <BackendError onRetry={() => void refetch()} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-ink-muted">
        <Link to={listHref} className="hover:text-ink">
          Candidates
        </Link>
        <ChevronRight size={13} aria-hidden className="shrink-0 text-ink-subtle" />
        <Link to={`/jobs/${profile.job_id}`} className="max-w-[16rem] truncate hover:text-ink">
          {profile.job_title}
        </Link>
        <ChevronRight size={13} aria-hidden className="shrink-0 text-ink-subtle" />
        <span aria-current="page" className="truncate font-medium text-ink">
          {profile.name}
        </span>
      </nav>

      <CandidateHeader profile={profile} />

      <StageTabs label="Candidate sections" tabs={TABS.map(({ id, label }) => ({ id, label }))} active={tab} onChange={setTab} />

      {tab === 'overview' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-5">
            <DetailsCard profile={profile} />
            <SkillsCard profile={profile} requiredSkills={job?.required_skills ?? []} />
          </div>
          <div className="min-w-0 space-y-5">
            <ScoresCard profile={profile} />
            <PipelineCard profile={profile} />
            <DocumentsCard profile={profile} />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-5">
          {tab === 'resume' && <CandidateAiTab profile={profile} />}
          {tab === 'phone' && <CandidateScreeningTab profile={profile} />}
          {tab === 'interviews' && <CandidateInterviewTab profile={profile} />}
          {tab === 'activity' && <CandidateTimelineTab profile={profile} />}
        </div>
      )}
    </div>
  )
}
