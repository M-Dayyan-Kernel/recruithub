import { useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { JobOutletContext } from '@/components/JobLayout'
import { ShortlistTab } from '@/components/ShortlistTab'
import { UploadTab } from '@/components/UploadTab'
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
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveShortlistTab(searchParams.get('tab'))
  const [watchCandidateIds, setWatchCandidateIds] = useState<string[]>([])

  const setActiveTab = (tab: ShortlistTabId) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', shortlistTabParam(tab))
    setSearchParams(next, { replace: true })
  }

  const pipeline = useJobPipelineCandidates(jobId, { watchCandidateIds })

  const handleUploadSuccess = (createdIds: string[]) => {
    setWatchCandidateIds(createdIds)
    setActiveTab('Processing')
    void queryClient.invalidateQueries({ queryKey: ['candidates', jobId, 'pipeline'] })
    void queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
  }

  const handleProcessingComplete = () => {
    setWatchCandidateIds([])
    setActiveTab('AI Shortlisted')
  }

  const watchedCandidates =
    watchCandidateIds.length > 0
      ? pipeline.candidates.filter((c) => watchCandidateIds.includes(c.id))
      : pipeline.processingCandidates.concat(pipeline.failedCandidates)

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
            onSwitchToCandidates={() => setActiveTab('Upload')}
            mode="aiShortlisted"
          />
        </div>
      ) : activeTab === 'Upload' ? (
        <UploadTab
          jobId={jobId}
          candidates={pipeline.uploadCandidates}
          isLoading={pipeline.isLoading}
          isError={pipeline.isError}
          onRetry={pipeline.refetch}
          onUploadSuccess={handleUploadSuccess}
        />
      ) : activeTab === 'Processing' ? (
        <ProcessingTab
          jobId={jobId}
          candidates={watchedCandidates}
          watchedTotal={pipeline.watchedTotal}
          watchedDone={pipeline.watchedDone}
          isLoading={pipeline.isLoading}
          isError={pipeline.isError}
          onRetry={pipeline.refetch}
          onComplete={handleProcessingComplete}
        />
      ) : null}
    </>
  )
}
