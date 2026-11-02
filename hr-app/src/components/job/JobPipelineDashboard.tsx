import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, ClipboardCheck, FileText, Phone, Video } from 'lucide-react'
import { api } from '@/lib/api'
import { fetchCandidatePage } from '@/lib/workflow'
import type {
  InterviewPipelineResponse,
  Job,
  ScreeningCall,
  ShortlistResultWithCandidate,
  SystemSettings,
} from '@/types/api'
import { buildScreeningRows, countByTab } from '@/components/screening/screeningRows'
import { ResumeUploadZone } from '@/components/ResumeUploadZone'
import { isArchivedJobStatus } from '@/lib/jobStatus'
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
  /** Background and text colour of the icon tile. */
  tint: string
  to?: string
  disabled?: boolean
}

/**
 * The stage counts as one strip, not a card each: a number and its label need a line or two,
 * and four tall cards spent most of their height on empty padding. Cells are divided by a
 * 1px gap over a tinted background, so the divider survives wrapping to two columns.
 */
function StageStrip({ stages, columns }: { stages: StageConfig[]; columns: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200', columns)}>
      {stages.map((stage) => {
        const cell = (
          <div
            className={cn(
              'flex h-full items-center gap-3 bg-white px-4 py-3 transition-colors',
              stage.to && !stage.disabled && 'hover:bg-slate-50',
              stage.disabled && 'opacity-50',
            )}
          >
            <span
              aria-hidden
              className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', stage.tint)}
            >
              {stage.icon}
            </span>
            <p className="min-w-[2ch] font-mono text-2xl font-semibold leading-none tabular-nums text-slate-900">
              {stage.value}
            </p>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-snug text-slate-800">{stage.label}</p>
              <p className="mt-0.5 text-xs leading-snug text-slate-500">{stage.description}</p>
            </div>
          </div>
        )
        return !stage.to || stage.disabled ? (
          <div key={stage.key}>{cell}</div>
        ) : (
          <Link
            key={stage.key}
            to={stage.to}
            className="block focus:outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {cell}
          </Link>
        )
      })}
    </div>
  )
}

function StageStripSkeleton({ count, columns }: { count: number; columns: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200', columns)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 bg-white px-4 py-3">
          <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-7 w-8 animate-pulse rounded bg-slate-200" />
          <div className="space-y-1.5">
            <div className="h-3.5 w-24 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function JobPipelineDashboard({ job }: Props) {
  const jobId = job.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const screeningEffective = job.voice_screening_enabled !== false
  const uploadDisabled = isArchivedJobStatus(job.status)

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
        // Its own key: ['candidates', jobId] elsewhere holds a bare array, not this page.
        queryKey: ['candidates', jobId, 'page'],
        queryFn: () => fetchCandidatePage(jobId),
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
    const candidates = candidatesQuery.data?.items ?? []
    const pipeline = pipelineQuery.data

    // HR's decision is the source of truth here, not the AI's recommendation: a candidate the
    // AI marked "review" and HR moved ahead is approved all the same.
    const approvedShortlist = shortlist.filter((r) => r.hr_decision === 'approved')
    const awaitingDecision = shortlist.filter((r) => r.hr_decision === 'pending').length
    const candidatesMap = Object.fromEntries(candidates.map((c) => [c.id, c]))
    const screeningRows = buildScreeningRows(
      approvedShortlist,
      candidatesMap,
      screeningCalls,
      settings,
    )
    const screeningCounts = countByTab(screeningRows)
    const counts = pipeline?.counts

    return {
      // The server's total: the list is capped, so its length undercounts a big job.
      applied: candidatesQuery.data?.total ?? 0,
      approved: approvedShortlist.length,
      awaitingDecision,
      screeningCompleted: screeningEffective ? screeningCounts.completed : 0,
      screeningWaiting: screeningEffective ? screeningCounts.pending : 0,
      // Finalists were interviewed too, so they count here: each number is "reached this stage".
      interviewsCompleted: (counts?.completed ?? 0) + (counts?.finalists ?? 0),
      interviewsOpen: (counts?.scheduled ?? 0) + (counts?.ongoing ?? 0),
      finalists: counts?.finalists ?? 0,
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

  const handleUploadSuccess = (createdIds: string[] = []) => {
    void queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
    void queryClient.invalidateQueries({ queryKey: ['candidates', jobId, 'pipeline'] })
    void queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
    void shortlistQuery.refetch()
    void candidatesQuery.refetch()
    void pipelineQuery.refetch()
    const qs = new URLSearchParams({ tab: 'processing' })
    if (createdIds.length > 0) qs.set('watch', createdIds.join(','))
    navigate(`/jobs/${jobId}/shortlist?${qs.toString()}`)
  }

  const stages: StageConfig[] = useMemo(() => {
    const base: StageConfig[] = [
      {
        key: 'applied',
        label: 'Applied',
        description: 'Resumes uploaded',
        value: metrics.applied,
        icon: <FileText size={16} />,
        tint: 'bg-slate-100 text-slate-600',
        to: `/jobs/${jobId}/shortlist?tab=results`,
      },
      {
        key: 'approved',
        label: 'Resume approved',
        description: metrics.awaitingDecision > 0 ? `${metrics.awaitingDecision} awaiting decision` : 'Approved by HR',
        value: metrics.approved,
        icon: <ClipboardCheck size={16} />,
        tint: 'bg-violet-50 text-violet-600',
        to: `/jobs/${jobId}/shortlist?tab=results`,
      },
    ]

    if (screeningEffective) {
      base.push({
        key: 'screening',
        label: 'Phone calls completed',
        description: metrics.screeningWaiting > 0 ? `${metrics.screeningWaiting} waiting for a call` : 'Voice screening done',
        value: metrics.screeningCompleted,
        icon: <Phone size={16} />,
        tint: 'bg-sky-50 text-sky-600',
        to: `/jobs/${jobId}/screening`,
      })
    }

    base.push(
      {
        key: 'interviews',
        label: 'Interviews completed',
        description: metrics.interviewsOpen > 0 ? `${metrics.interviewsOpen} booked or in progress` : 'Interviews taken',
        value: metrics.interviewsCompleted,
        icon: <Video size={16} />,
        tint: 'bg-indigo-50 text-indigo-600',
        to: `/jobs/${jobId}/interviews?tab=completed`,
      },
      {
        key: 'finalists',
        label: 'Finalists',
        description: 'Approved after interview',
        value: metrics.finalists,
        icon: <CheckCircle2 size={16} />,
        tint: 'bg-emerald-50 text-emerald-600',
        to: `/jobs/${jobId}/finalists`,
      },
    )

    return base
  }, [jobId, metrics, screeningEffective])

  // Applied already counts everyone; summing the stages would count each candidate once per stage.
  const totalInPipeline = metrics.applied
  const gridCols = screeningEffective ? 'lg:grid-cols-5' : 'lg:grid-cols-4'

  // Its own card under the stats: adding resumes is an action, not part of the numbers.
  const uploadCard = (
    <section aria-label="Add candidates">
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:px-6 sm:py-5">
        <h2 className="text-lg font-semibold text-slate-900">Add candidates</h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">
          Upload resumes and AI scores each one against this job automatically.
        </p>
        <ResumeUploadZone
          jobId={jobId}
          variant="pipeline"
          disabled={uploadDisabled}
          onUploadSuccess={handleUploadSuccess}
        />
      </div>
    </section>
  )

  if (isLoading) {
    return (
      <div className="space-y-6">
        <section aria-label="Stats">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 px-5 py-4 sm:px-6">
              <div className="h-5 w-16 animate-pulse rounded bg-slate-200" />
              <div className="mt-2 h-4 w-40 animate-pulse rounded bg-slate-100" />
            </div>
            <div className="p-5 sm:p-6">
              <StageStripSkeleton count={stages.length} columns={gridCols} />
            </div>
          </div>
        </section>
        {uploadCard}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section aria-label="Stats">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 px-5 py-4 sm:px-6">
            <h2 className="text-lg font-semibold text-slate-900">Stats</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {totalInPipeline > 0
                ? `${totalInPipeline} candidate${totalInPipeline === 1 ? '' : 's'} on this job`
                : 'No candidates yet — they will show here as they move through hiring'}
            </p>
          </div>

          <div className="p-5 sm:p-6">
            {isError && (
              <div className="mb-5 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <AlertCircle size={16} className="shrink-0" />
                Failed to load pipeline stats.
                <button type="button" onClick={refetchAll} className="ml-1 underline">
                  Retry
                </button>
              </div>
            )}

            <StageStrip stages={stages} columns={gridCols} />
          </div>
        </div>
      </section>

      {uploadCard}
    </div>
  )
}
