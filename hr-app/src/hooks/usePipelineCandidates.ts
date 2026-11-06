import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { PipelineCandidatesResponse, PipelineSort, PipelineStageKey } from '@/types/api'

export const PIPELINE_PAGE_SIZE = 25

interface Options {
  stage?: PipelineStageKey | null
  q?: string
  sort?: PipelineSort
  offset?: number
  limit?: number
  enabled?: boolean
}

/**
 * Every candidate on a job with the one stage each is in, and the count per stage, from the server
 * (`GET /api/jobs/{id}/pipeline-candidates`). The stage is decided there, once, so this view and the
 * stage pages cannot disagree. Asking for `limit: 1` is the cheap way to get just the counts.
 */
export function usePipelineCandidates(jobId: string, options: Options = {}) {
  const { stage = null, q = '', sort = 'match', offset = 0, limit = PIPELINE_PAGE_SIZE, enabled = true } = options
  return useQuery<PipelineCandidatesResponse>({
    // Under ['candidates', jobId] so every upload, decision, deletion and retry that already
    // invalidates the job's candidates refreshes this too.
    queryKey: ['candidates', jobId, 'stages', { stage, q, sort, offset, limit }],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sort })
      if (stage) params.set('stage', stage)
      if (q.trim()) params.set('q', q.trim())
      return api.get(`/api/jobs/${jobId}/pipeline-candidates?${params}`) as unknown as Promise<PipelineCandidatesResponse>
    },
    enabled: enabled && !!jobId,
    // A decision anywhere moves a candidate, so never trust an old answer; keep the last page on
    // screen while the next one loads so the list does not flash empty between searches.
    staleTime: 0,
    placeholderData: keepPreviousData,
  })
}
