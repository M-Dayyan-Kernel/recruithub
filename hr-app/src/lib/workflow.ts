export const WORKFLOW_CARD_CLASS =
  'overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm'
export const WORKFLOW_TABLE_CLASS = 'min-w-full divide-y divide-slate-200'
export const WORKFLOW_TABLE_EMPTY_ROW_CLASS = 'h-[360px]'
export const WORKFLOW_TABLE_EMPTY_CELL_CLASS =
  'h-[360px] align-middle px-6 text-center text-sm text-slate-400'
export const WORKFLOW_INPUT_CLASS =
  'h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-700 placeholder:text-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100'
export const WORKFLOW_PRIMARY_BUTTON_CLASS =
  'inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50'

export const IN_PROGRESS_PIPELINE_STATUSES = ['queued', 'processing'] as const

export type PipelineStatus = 'queued' | 'processing' | 'completed' | 'failed'

export function candidatesListUrl(
  jobId: string,
  params?: {
    pipeline_status?: string
    parse_status?: string
    has_shortlist_result?: boolean
  },
): string {
  const search = new URLSearchParams()
  const status = params?.pipeline_status ?? params?.parse_status
  if (status) search.set('pipeline_status', status)
  if (params?.has_shortlist_result !== undefined) {
    search.set('has_shortlist_result', String(params.has_shortlist_result))
  }
  const qs = search.toString()
  return `/api/jobs/${jobId}/candidates${qs ? `?${qs}` : ''}`
}

export function formatUploadedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function resumeDisplayName(candidate: {
  original_filename?: string | null
  name?: string | null
  parsed_data?: { name?: string | null } | null
  id: string
}): string {
  return (
    candidate.original_filename ??
    candidate.parsed_data?.name ??
    candidate.name ??
    `Resume ${candidate.id.slice(0, 8)}`
  )
}

export function pipelineStatusLabel(status: PipelineStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'processing':
      return 'Reviewing'
    case 'completed':
      return 'Done'
    case 'failed':
      return 'Failed'
    default:
      return status
  }
}
