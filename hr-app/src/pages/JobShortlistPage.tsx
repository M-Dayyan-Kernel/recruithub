import { useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { Candidate } from '@/types/api'
import type { JobOutletContext } from '@/components/JobLayout'
import { ShortlistTab } from '@/components/ShortlistTab'
import { ParsedResumesTab, type ShortlistTriggeredPayload } from '@/components/ParsedResumesTab'
import { UploadTab } from '@/components/UploadTab'
import { ParsingTab } from '@/components/ParsingTab'
import { AIShortlistingTab } from '@/components/AIShortlistingTab'
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
  const [shortlistTriggered, setShortlistTriggered] = useState(false)
  const [shortlistBatchIds, setShortlistBatchIds] = useState<string[]>([])
  const [shortlistBatchCandidates, setShortlistBatchCandidates] = useState<Candidate[]>([])

  const setActiveTab = (tab: ShortlistTabId) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', shortlistTabParam(tab))
    setSearchParams(next, { replace: true })
  }

  const handleShortlistTriggered = ({ candidateIds, candidates }: ShortlistTriggeredPayload) => {
    setShortlistBatchIds(candidateIds)
    setShortlistBatchCandidates(candidates)
    setShortlistTriggered(true)
  }

  const refreshShortlistData = () => {
    queryClient.invalidateQueries({ queryKey: ['candidates', jobId, 'pipeline'] })
    queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
    queryClient.invalidateQueries({ queryKey: ['shortlist-status', jobId] })
  }

  const handleShortlistComplete = () => {
    setShortlistTriggered(false)
    setShortlistBatchIds([])
    setShortlistBatchCandidates([])
    refreshShortlistData()
  }

  const pipeline = useJobPipelineCandidates(jobId, {
    shortlistInProgress: shortlistTriggered || shortlistBatchIds.length > 0,
    pendingShortlistIds: shortlistBatchIds,
  })

  return (
    <>
      {activeTab === 'AI Shortlisted' ? (
        <div className={WORKFLOW_SECTION_CLASS}>
          <ShortlistTab
            jobId={jobId}
            jobTitle={job.title}
            requiredSkills={job.required_skills ?? []}
            shortlistTriggered={shortlistTriggered}
            onShortlistComplete={handleShortlistComplete}
            onSwitchToCandidates={() => setActiveTab('Parsed Resumes')}
            mode="aiShortlisted"
          />
        </div>
      ) : activeTab === 'Upload' ? (
        <UploadTab
          jobId={jobId}
          queueCandidates={pipeline.queueCandidates}
          isLoading={pipeline.isLoading}
          isError={pipeline.isError}
          onRetry={pipeline.refetch}
        />
      ) : activeTab === 'Parsing' ? (
        <ParsingTab
          parsingCandidates={pipeline.parsingCandidates}
          isLoading={pipeline.isLoading}
          isError={pipeline.isError}
          onRetry={pipeline.refetch}
        />
      ) : activeTab === 'Parsed Resumes' ? (
        <ParsedResumesTab
          jobId={jobId}
          parsedCandidates={pipeline.parsedCandidates}
          isLoading={pipeline.isLoading}
          isError={pipeline.isError}
          onRetry={pipeline.refetch}
          onShortlistTriggered={handleShortlistTriggered}
          onSwitchToShortlisting={() => setActiveTab('AI Shortlisting')}
        />
      ) : activeTab === 'AI Shortlisting' ? (
        <AIShortlistingTab
          jobId={jobId}
          batchCandidates={shortlistBatchCandidates}
          batchCandidateIds={shortlistBatchIds}
          shortlistTriggered={shortlistTriggered}
          onShortlistComplete={() => {
            handleShortlistComplete()
            setActiveTab('AI Shortlisted')
          }}
        />
      ) : null}
    </>
  )
}
