import { api } from '@/lib/api'
import type {
  CandidateListItem,
  CandidateProfile,
  CandidateUpdatePayload,
  PaginatedResponse,
} from '@/types/api'

export interface CandidatesListParams {
  jobId?: string
  stage?: CandidateStageFilter
  q?: string
  limit?: number
  offset?: number
}

export type CandidateStageFilter =
  | 'pipeline'
  | 'ai_shortlisted'
  | 'screening'
  | 'interview'
  | 'finalists'

export const CANDIDATE_STAGE_FILTERS: Array<{
  value: CandidateStageFilter | ''
  label: string
}> = [
  { value: '', label: 'All stages' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'ai_shortlisted', label: 'AI Shortlisted' },
  { value: 'screening', label: 'Screening' },
  { value: 'interview', label: 'Interview' },
  { value: 'finalists', label: 'Finalists' },
]

export function displayOrNa(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'N/A'
  return String(value)
}

export async function fetchCandidates(
  params: CandidatesListParams = {},
): Promise<PaginatedResponse<CandidateListItem>> {
  const search = new URLSearchParams()
  if (params.jobId) search.set('job_id', params.jobId)
  if (params.stage) search.set('stage', params.stage)
  if (params.q?.trim()) search.set('q', params.q.trim())
  search.set('limit', String(params.limit ?? 25))
  search.set('offset', String(params.offset ?? 0))
  const qs = search.toString()
  const data = (await api.get(`/api/candidates?${qs}`)) as
    | PaginatedResponse<CandidateListItem>
    | CandidateListItem[]
  if (data && !Array.isArray(data) && Array.isArray(data.items)) {
    return data
  }
  const items = Array.isArray(data) ? data : []
  return {
    items,
    total: items.length,
    limit: params.limit ?? 25,
    offset: params.offset ?? 0,
  }
}

export async function fetchCandidateProfile(candidateId: string): Promise<CandidateProfile> {
  return api.get(`/api/candidates/${candidateId}`) as unknown as Promise<CandidateProfile>
}

export async function updateCandidate(
  candidateId: string,
  payload: CandidateUpdatePayload,
): Promise<CandidateListItem> {
  return api.patch(`/api/candidates/${candidateId}`, payload) as unknown as Promise<CandidateListItem>
}
