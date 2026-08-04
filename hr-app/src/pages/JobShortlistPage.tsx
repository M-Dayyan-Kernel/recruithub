import { useEffect, useMemo } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import type { JobOutletContext } from '@/components/JobLayout'
import { ShortlistTab } from '@/components/ShortlistTab'
import { ProcessingTab } from '@/components/ProcessingTab'
import { useJobPipelineCandidates } from '@/hooks/useJobPipelineCandidates'
import {
  resolveShortlistTab,
  shortlistTabParam,
  type ShortlistTabId,
} from '@/components/shortlist/ShortlistStatusTabs'

const WORKFLOW_SECTION_CLASS = 'space-y-3'

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
      next.set('tab', shortlistTabParam('AI Shortlisted'))
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

  const handleProcessingComplete = () => {
    pipeline.clearProgressBatch()
    setActiveTab('AI Shortlisted', true)
  }

  return (
    <>
      {activeTab === 'AI Shortlisted' ? (
        <div className={WORKFLOW_SECTION_CLASS}>
          <ShortlistTab
            jobId={jobId}
            jobTitle={job.title}
            voiceScreeningEnabled={job.voice_screening_enabled}
            requiredSkills={job.required_skills ?? []}
            shortlistTriggered={false}
            onShortlistComplete={() => pipeline.refetch()}
            mode="aiShortlisted"
          />
        </div>
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
    </>
  )
}
