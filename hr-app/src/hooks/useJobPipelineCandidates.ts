import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { Candidate, ShortlistResultWithCandidate } from '@/types/api'
import { fetchJobCandidates, isInProgressPipelineStatus } from '@/lib/workflow'

const PIPELINE_POLL_MS = 2_000

interface Options {
  watchCandidateIds?: string[]
}

export function useJobPipelineCandidates(jobId: string, options: Options = {}) {
  const { watchCandidateIds = [] } = options
  const [pollStartTime] = useState(() => Date.now())
  /** Stable batch of IDs for progress — seeds from upload watch list and/or accumulates in-flight. */
  const [batchIds, setBatchIds] = useState<string[]>([])

  const pipelineQuery = useQuery<Candidate[]>({
    queryKey: ['candidates', jobId, 'pipeline'],
    queryFn: () => fetchJobCandidates(jobId),
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: (query) => {
      const list = (query.state.data ?? []) as Candidate[]
      const inFlight = list.some((c) => isInProgressPipelineStatus(c.pipeline_status))
      const watching = watchCandidateIds.length > 0 || batchIds.length > 0
      if (!inFlight && !watching) return false
      // Keep polling while batch has unsettled items
      const batchSet = new Set(batchIds)
      const batchUnsettled =
        batchSet.size > 0 &&
        list.some(
          (c) =>
            batchSet.has(c.id) && isInProgressPipelineStatus(c.pipeline_status),
        )
      if (!inFlight && !batchUnsettled && watchCandidateIds.length === 0) return false
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
      if (!inFlight && watchCandidateIds.length === 0 && batchIds.length === 0) return false
      return PIPELINE_POLL_MS
    },
  })

  const candidates = pipelineQuery.data ?? []

  const processingCandidates = useMemo(
    () => candidates.filter((c) => isInProgressPipelineStatus(c.pipeline_status)),
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

  // Seed / expand the progress batch from explicit watch IDs (upload) and live in-flight rows
  useEffect(() => {
    setBatchIds((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of watchCandidateIds) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      for (const c of processingCandidates) {
        if (!next.has(c.id)) {
          next.add(c.id)
          changed = true
        }
      }
      return changed ? [...next] : prev
    })
  }, [watchCandidateIds, processingCandidates])

  const batchSet = useMemo(() => new Set(batchIds), [batchIds])

  const watchedCandidates = useMemo(() => {
    if (batchSet.size === 0) {
      return processingCandidates.concat(failedCandidates)
    }
    return candidates.filter((c) => batchSet.has(c.id))
  }, [batchSet, candidates, processingCandidates, failedCandidates])

  const watchedDone = useMemo(
    () =>
      watchedCandidates.filter(
        (c) => c.pipeline_status === 'completed' || c.pipeline_status === 'failed',
      ).length,
    [watchedCandidates],
  )

  const watchedTotal = batchSet.size > 0 ? batchSet.size : watchedCandidates.length

  const clearProgressBatch = useCallback(() => {
    setBatchIds([])
  }, [])

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
    clearProgressBatch,
    isLoading: pipelineQuery.isLoading,
    isError: pipelineQuery.isError,
    refetch: () => {
      void pipelineQuery.refetch()
      void shortlistQuery.refetch()
    },
  }
}
