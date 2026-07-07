import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { Candidate } from '@/types/api'
import type { JobOutletContext } from '@/components/JobLayout'
import { ShortlistTab } from '@/components/ShortlistTab'
import { ParsedResumesTab, type ShortlistTriggeredPayload } from '@/components/ParsedResumesTab'
import { UploadTab } from '@/components/UploadTab'
import { ParsingTab } from '@/components/ParsingTab'
import { AIShortlistingTab } from '@/components/AIShortlistingTab'
import { useJobPipelineCandidates } from '@/hooks/useJobPipelineCandidates'

const TABS = [
  'AI Shortlisted',
  'Upload',
  'Parsing',
  'Parsed Resumes',
  'AI Shortlisting',
] as const
type Tab = (typeof TABS)[number]

const WORKFLOW_SECTION_CLASS = 'space-y-3'

export default function JobShortlistPage() {
  const { jobId } = useOutletContext<JobOutletContext>()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('AI Shortlisted')
  const [shortlistTriggered, setShortlistTriggered] = useState(false)
  const [shortlistBatchIds, setShortlistBatchIds] = useState<string[]>([])
  const [shortlistBatchCandidates, setShortlistBatchCandidates] = useState<Candidate[]>([])

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
      <div className="border-b border-slate-200">
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'AI Shortlisted' ? (
        <div className={WORKFLOW_SECTION_CLASS}>
          <ShortlistTab
            jobId={jobId}
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
