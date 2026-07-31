import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { Candidate, ShortlistResultWithCandidate } from '@/types/api'
import { fetchJobCandidates, isInProgressPipelineStatus } from '@/lib/workflow'

const PIPELINE_POLL_MS = 2_000

interface Options {
  watchCandidateIds?: string[]
}

export function useJobPipelineCandidates(jobId: string, options: Options = {}) {
  const { watchCandidateIds = [] } = options
  const watchSet = useMemo(() => new Set(watchCandidateIds), [watchCandidateIds])
  const [pollStartTime] = useState(() => Date.now())

  const pipelineQuery = useQuery<Candidate[]>({
    queryKey: ['candidates', jobId, 'pipeline'],
    queryFn: () => fetchJobCandidates(jobId),
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: (query) => {
      const list = (query.state.data ?? []) as Candidate[]
      const inFlight = list.some((c) => isInProgressPipelineStatus(c.pipeline_status))
      const watching = watchSet.size > 0
      if (!inFlight && !watching) return false
      return Date.now() - pollStartTime > 120_000 ? 5_000 : PIPELINE_POLL_MS
    },
  })

  const shortlistQuery = useQuery<ShortlistResultWithCandidate[]>({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<ShortlistResultWithCandidate[]>,
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: () => {
      const list = (pipelineQuery.data ?? []) as Candidate[]
      const inFlight = list.some((c) => isInProgressPipelineStatus(c.pipeline_status))
      if (!inFlight && watchSet.size === 0) return false
      return PIPELINE_POLL_MS
    },
  })

  const candidates = (pipelineQuery.data ?? []).filter((c) => !c.skip_ai_shortlist)

  const processingCandidates = useMemo(
    () =>
      candidates.filter((c) => isInProgressPipelineStatus(c.pipeline_status)),
    [candidates],
  )

  const failedCandidates = useMemo(
    () => candidates.filter((c) => c.pipeline_status === 'failed'),
    [candidates],
  )

  const completedCandidates = useMemo(
    () => candidates.filter((c) => c.pipeline_status === 'completed'),
    [candidates],
  )

  const watchedCandidates = useMemo(() => {
    if (watchSet.size === 0) return processingCandidates
    return candidates.filter((c) => watchSet.has(c.id))
  }, [candidates, watchSet, processingCandidates])

  const watchedDone = useMemo(
    () =>
      watchedCandidates.filter(
        (c) => c.pipeline_status === 'completed' || c.pipeline_status === 'failed',
      ).length,
    [watchedCandidates],
  )

  const watchedTotal = watchedCandidates.length

  return {
    candidates,
    uploadCandidates: candidates,
    processingCandidates,
    failedCandidates,
    completedCandidates,
    watchedCandidates,
    watchedDone,
    watchedTotal,
    hasProcessingInFlight: processingCandidates.length > 0,
    isLoading: pipelineQuery.isLoading,
    isError: pipelineQuery.isError,
    refetch: () => {
      void pipelineQuery.refetch()
      void shortlistQuery.refetch()
    },
  }
}
