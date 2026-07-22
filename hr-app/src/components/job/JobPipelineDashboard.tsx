import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Users, Phone, Calendar, CheckCircle2, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { fetchJobCandidates } from '@/lib/workflow'
import type {
  InterviewPipelineResponse,
  Job,
  ScreeningCall,
  ShortlistResultWithCandidate,
  SystemSettings,
} from '@/types/api'
import { buildScreeningRows, countByTab } from '@/components/screening/screeningRows'
import { cn } from '@/lib/utils'

interface Props {
  job: Job
}

interface StageConfig {
  key: string
  label: string
  description: string
  value: number | string
  icon: React.ReactNode
  accent: string
  iconBg: string
  barColor: string
  to?: string
  disabled?: boolean
}

function PipelineBar({
  stages,
}: {
  stages: Array<{ key: string; value: number; barColor: string; label: string }>
}) {
  const total = stages.reduce((sum, s) => sum + s.value, 0)

  if (total === 0) {
    return (
      <div className="mb-6">
        <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
          {stages.map((stage) => (
            <div key={stage.key} className="flex-1 border-r border-white last:border-r-0" />
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-slate-400">No candidates in the pipeline yet</p>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        {stages.map((stage) => {
          const width = Math.max((stage.value / total) * 100, stage.value > 0 ? 8 : 0)
          return (
            <div
              key={stage.key}
              className={cn('transition-all duration-500', stage.barColor)}
              style={{ width: `${width}%` }}
              title={`${stage.label}: ${stage.value}`}
            />
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {stages.map((stage) => (
          <span key={stage.key} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <span className={cn('h-2 w-2 rounded-full', stage.barColor)} />
            {stage.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function StageCard({ stage }: { stage: StageConfig }) {
  const content = (
    <div
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-xl border bg-white transition-all',
        stage.disabled
          ? 'border-slate-200 opacity-50'
          : stage.to
            ? 'border-slate-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md'
            : 'border-slate-200',
      )}
    >
      <div className={cn('h-1 w-full', stage.accent)} />
      <div className="flex flex-1 flex-col p-5">
        <div className={cn('mb-4 flex h-11 w-11 items-center justify-center rounded-xl', stage.iconBg)}>
          {stage.icon}
        </div>
        <p className="text-4xl font-bold tracking-tight text-slate-900 tabular-nums">{stage.value}</p>
        <p className="mt-1 text-sm font-semibold text-slate-800">{stage.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{stage.description}</p>
      </div>
    </div>
  )

  if (!stage.to || stage.disabled) return content

  return (
    <Link
      to={stage.to}
      className="block h-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      {content}
    </Link>
  )
}

function StageCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="h-1 animate-pulse bg-slate-200" />
      <div className="p-5">
        <div className="mb-4 h-11 w-11 animate-pulse rounded-xl bg-slate-100" />
        <div className="mb-2 h-10 w-14 animate-pulse rounded bg-slate-200" />
        <div className="mb-1 h-4 w-24 animate-pulse rounded bg-slate-200" />
        <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  )
}

export function JobPipelineDashboard({ job }: Props) {
  const jobId = job.id
  const screeningEffective = job.voice_screening_enabled !== false

  const [shortlistQuery, screeningQuery, candidatesQuery, pipelineQuery] = useQueries({
    queries: [
      {
        queryKey: ['shortlist', jobId],
        queryFn: () =>
          api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<ShortlistResultWithCandidate[]>,
        enabled: !!jobId,
      },
      {
        queryKey: ['screening', jobId],
        queryFn: () => api.get(`/api/jobs/${jobId}/screening`) as unknown as Promise<ScreeningCall[]>,
        enabled: !!jobId,
      },
      {
        queryKey: ['candidates', jobId],
        queryFn: () => fetchJobCandidates(jobId),
        enabled: !!jobId,
      },
      {
        queryKey: ['interviews-pipeline', jobId, 'overview'],
        queryFn: () =>
          api.get(`/api/jobs/${jobId}/interviews/pipeline`) as unknown as Promise<InterviewPipelineResponse>,
        enabled: !!jobId,
      },
    ],
  })

  const { data: settings } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings') as unknown as Promise<SystemSettings>,
  })

  const isLoading =
    shortlistQuery.isLoading || screeningQuery.isLoading || candidatesQuery.isLoading || pipelineQuery.isLoading
  const isError =
    shortlistQuery.isError || screeningQuery.isError || candidatesQuery.isError || pipelineQuery.isError

  const metrics = useMemo(() => {
    const shortlist = shortlistQuery.data ?? []
    const screeningCalls = screeningQuery.data ?? []
    const candidates = candidatesQuery.data ?? []
    const pipeline = pipelineQuery.data

    const shortlistedCount = shortlist.filter((r) => r.recommendation === 'shortlisted').length

    const approvedShortlist = shortlist.filter((r) => r.hr_decision === 'approved')
    const candidatesMap = Object.fromEntries(candidates.map((c) => [c.id, c]))
    const screeningRows = buildScreeningRows(
      approvedShortlist,
      candidatesMap,
      screeningCalls,
      settings,
    )
    const screeningCounts = countByTab(screeningRows)
    const screeningCompletedCount = screeningCounts.completed

    return {
      shortlisted: shortlistedCount,
      screeningCompleted: screeningEffective ? screeningCompletedCount : 0,
      scheduled: pipeline?.counts.scheduled ?? 0,
      finalists: pipeline?.counts.finalists ?? 0,
    }
  }, [
    shortlistQuery.data,
    screeningQuery.data,
    candidatesQuery.data,
    pipelineQuery.data,
    settings,
    screeningEffective,
  ])

  const refetchAll = () => {
    void shortlistQuery.refetch()
    void screeningQuery.refetch()
    void candidatesQuery.refetch()
    void pipelineQuery.refetch()
  }

  const stages: StageConfig[] = useMemo(() => {
    const base: StageConfig[] = [
      {
        key: 'shortlisted',
        label: 'Shortlisted',
        description: 'AI-recommended fits',
        value: metrics.shortlisted,
        icon: <Users size={20} className="text-violet-600" />,
        accent: 'bg-violet-500',
        iconBg: 'bg-violet-50',
        barColor: 'bg-violet-400',
        to: `/jobs/${jobId}/shortlist`,
      },
    ]

    if (screeningEffective) {
      base.push({
        key: 'screening',
        label: 'Screened',
        description: 'Voice screening completed',
        value: metrics.screeningCompleted,
        icon: <Phone size={20} className="text-emerald-600" />,
        accent: 'bg-emerald-500',
        iconBg: 'bg-emerald-50',
        barColor: 'bg-emerald-400',
        to: `/jobs/${jobId}/screening`,
      })
    }

    base.push(
      {
        key: 'scheduled',
        label: 'Scheduled',
        description: 'Interviews booked',
        value: metrics.scheduled,
        icon: <Calendar size={20} className="text-indigo-600" />,
        accent: 'bg-indigo-500',
        iconBg: 'bg-indigo-50',
        barColor: 'bg-indigo-400',
        to: `/jobs/${jobId}/interviews?tab=scheduled`,
      },
      {
        key: 'finalists',
        label: 'Finalists',
        description: 'HR-approved candidates',
        value: metrics.finalists,
        icon: <CheckCircle2 size={20} className="text-emerald-600" />,
        accent: 'bg-emerald-500',
        iconBg: 'bg-emerald-50',
        barColor: 'bg-emerald-400',
        to: `/jobs/${jobId}/finalists`,
      },
    )

    return base
  }, [jobId, metrics, screeningEffective])

  const barStages = stages.map((s) => ({
    key: s.key,
    label: s.label,
    value: typeof s.value === 'number' ? s.value : 0,
    barColor: s.barColor,
  }))

  const totalInPipeline = barStages.reduce((sum, s) => sum + s.value, 0)
  const gridCols = screeningEffective ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'

  if (isLoading) {
    return (
      <section aria-label="Hiring pipeline">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-5">
            <div className="h-5 w-36 animate-pulse rounded bg-slate-200" />
            <div className="mt-2 h-4 w-56 animate-pulse rounded bg-slate-100" />
          </div>
          <div className="p-6">
            <div className="mb-6 h-2.5 animate-pulse rounded-full bg-slate-100" />
            <div className={cn('grid grid-cols-1 gap-4', gridCols)}>
              {stages.map((stage) => (
                <StageCardSkeleton key={stage.key} />
              ))}
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Hiring pipeline">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Hiring pipeline</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {totalInPipeline > 0
                ? `${totalInPipeline} candidate${totalInPipeline === 1 ? '' : 's'} across all stages`
                : 'Candidates will appear here as they move through hiring'}
            </p>
          </div>
        </div>

        <div className="p-6">
          {isError && (
            <div className="mb-5 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertCircle size={16} className="shrink-0" />
              Failed to load pipeline stats.
              <button type="button" onClick={refetchAll} className="ml-1 underline">
                Retry
              </button>
            </div>
          )}

          <PipelineBar stages={barStages} />

          <div className={cn('grid grid-cols-1 gap-4', gridCols)}>
            {stages.map((stage) => (
              <StageCard key={stage.key} stage={stage} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
