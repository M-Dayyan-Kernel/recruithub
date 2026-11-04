import { useEffect, useMemo } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ListChecks } from 'lucide-react'
import { api } from '@/lib/api'
import type { ShortlistResultWithCandidate } from '@/types/api'
import StageHeader from '@/components/stage/StageHeader'
import { RESUME_SCREENING_LABEL } from '@/lib/stageLabels'
import { isAwaitingDecision } from '@/lib/shortlistDecision'
import type { JobOutletContext } from '@/components/JobLayout'
import { ShortlistTab } from '@/components/ShortlistTab'
import { ProcessingTab } from '@/components/ProcessingTab'
import { FailedTab } from '@/components/FailedTab'
import { useJobPipelineCandidates } from '@/hooks/useJobPipelineCandidates'
import { useFailedCandidates } from '@/hooks/useFailedCandidates'
import {
  resolveShortlistTab,
  ShortlistStatusTabs,
  shortlistTabParam,
  type ShortlistTabId,
} from '@/components/shortlist/ShortlistStatusTabs'

export default function JobShortlistPage() {
  const { job, jobId } = useOutletContext<JobOutletContext>()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveShortlistTab(searchParams.get('tab'))

  const watchCandidateIds = useMemo(() => {
    const raw = searchParams.get('watch') ?? ''
    return raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  }, [searchParams])

  useEffect(() => {
    if (!searchParams.get('tab')) {
      const next = new URLSearchParams(searchParams)
      next.set('tab', shortlistTabParam('Resume Screening'))
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const setActiveTab = (tab: ShortlistTabId, clearWatch = false) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', shortlistTabParam(tab))
    if (clearWatch) next.delete('watch')
    setSearchParams(next, { replace: true })
  }

  const pipeline = useJobPipelineCandidates(jobId, { watchCandidateIds })
  const failed = useFailedCandidates(jobId)
  const queryClient = useQueryClient()

  // Same key as the results table below, so this is one request, not two.
  const { data: results } = useQuery<ShortlistResultWithCandidate[]>({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<ShortlistResultWithCandidate[]>,
    enabled: !!jobId,
  })

  // A finished batch lands on the Failed tab when anything in it failed, so a failure is seen
  // when it happens instead of being a count nobody opens; otherwise on the scored results.
  const handleProcessingComplete = ({ failed: failedInBatch }: { failed: number }) => {
    pipeline.clearProgressBatch()
    if (failedInBatch > 0) void queryClient.invalidateQueries({ queryKey: ['candidates', jobId, 'failed'] })
    setActiveTab(failedInBatch > 0 ? 'Failed' : 'Resume Screening', true)
  }

  return (
    <div className="space-y-5">
      <StageHeader
        icon={ListChecks}
        title={RESUME_SCREENING_LABEL}
        description="Candidates scored by AI with match scores and recommendations."
        count={results?.filter(isAwaitingDecision).length}
      >
        <ShortlistStatusTabs />
      </StageHeader>

      {activeTab === 'Resume Screening' ? (
        <ShortlistTab
          jobId={jobId}
          jobTitle={job.title}
          voiceScreeningEnabled={job.voice_screening_enabled}
          requiredSkills={job.required_skills ?? []}
        />
      ) : activeTab === 'Failed' ? (
        <FailedTab
          jobId={jobId}
          candidates={failed.failedCandidates}
          isLoading={failed.isLoading}
          isError={failed.isError}
          onRetry={failed.refetch}
        />
      ) : (
        <ProcessingTab
          jobId={jobId}
          candidates={pipeline.watchedCandidates}
          watchedTotal={pipeline.watchedTotal}
          watchedDone={pipeline.watchedDone}
          isLoading={pipeline.isLoading}
          isError={pipeline.isError}
          onRetry={pipeline.refetch}
          onComplete={handleProcessingComplete}
        />
      )}
    </div>
  )
}
