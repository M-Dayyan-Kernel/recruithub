import { Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { CANDIDATE_STAGE_FILTERS, type CandidateStageFilter } from '@/lib/candidates'
import type { Job } from '@/types/api'
import { WORKFLOW_INPUT_CLASS } from '@/lib/workflow'
import { cn } from '@/lib/utils'

interface Props {
  jobId: string
  stage: CandidateStageFilter | ''
  search: string
  onJobIdChange: (jobId: string) => void
  onStageChange: (stage: CandidateStageFilter | '') => void
  onSearchChange: (value: string) => void
  onSearchSubmit: () => void
}

export function CandidatesToolbar({
  jobId,
  stage,
  search,
  onJobIdChange,
  onStageChange,
  onSearchChange,
  onSearchSubmit,
}: Props) {
  const { data: jobs } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/api/jobs') as unknown as Promise<Job[]>,
  })

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <select
        value={jobId}
        onChange={(e) => onJobIdChange(e.target.value)}
        className={cn(WORKFLOW_INPUT_CLASS, 'sm:max-w-xs')}
        aria-label="Filter by job"
      >
        <option value="">All jobs</option>
        {(jobs ?? []).map((job) => (
          <option key={job.id} value={job.id}>
            {job.title}
          </option>
        ))}
      </select>

      <select
        value={stage}
        onChange={(e) => onStageChange(e.target.value as CandidateStageFilter | '')}
        className={cn(WORKFLOW_INPUT_CLASS, 'sm:max-w-xs')}
        aria-label="Filter by stage"
      >
        {CANDIDATE_STAGE_FILTERS.map((opt) => (
          <option key={opt.value || 'all'} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <form
        className="relative min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault()
          onSearchSubmit()
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name…"
          className={cn(WORKFLOW_INPUT_CLASS, 'pl-9')}
        />
      </form>
    </div>
  )
}
