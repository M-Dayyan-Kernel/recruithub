import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Download,
  FileText,
  ListChecks,
  Menu,
  Phone,
  Trophy,
  Video,
  X,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { FinalistsResponse, Job, SystemSettings } from '@/types/api'
import { cn } from '@/lib/utils'
import { ScreeningStatusTabs } from '@/components/screening/ScreeningStatusTabs'
import { ShortlistStatusTabs } from '@/components/shortlist/ShortlistStatusTabs'
import { InterviewRubricPanel } from '@/components/InterviewRubricPanel'
import { downloadFinalistsExcel } from '@/lib/finalistsExport'

const PHASES = [
  {
    label: 'AI Shortlist',
    segment: 'shortlist',
    icon: ListChecks,
    description: 'Rank and shortlist resumes',
  },
  {
    label: 'Screening',
    segment: 'screening',
    icon: Phone,
    description: 'Phone screening calls',
  },
  {
    label: 'Interviews',
    segment: 'interviews',
    icon: Video,
    description: 'AI video interviews',
  },
  {
    label: 'Finalists',
    segment: 'finalists',
    icon: Trophy,
    description: 'Top candidates',
  },
] as const

export function currentPhaseSegment(pathname: string, jobId: string): string {
  const base = `/jobs/${jobId}`
  if (pathname === base || pathname === `${base}/`) return ''
  const rest = pathname.slice(base.length + 1)
  return rest.split('/')[0] ?? ''
}

export function jobPhasePath(jobId: string, segment: string): string {
  return segment ? `/jobs/${jobId}/${segment}` : `/jobs/${jobId}`
}

function phaseLabel(phase: string, phases: Array<(typeof PHASES)[number]>): string {
  if (phase === '') return 'Job overview'
  return phases.find((p) => p.segment === phase)?.label ?? 'Pipeline'
}

function PhaseToolbar({
  children,
  end,
}: {
  children: ReactNode
  end: ReactNode
}) {
  return (
    <div className="flex h-14 w-full min-w-0 items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3 shadow-sm sm:px-4">
      <div className="min-w-0 flex-1 overflow-x-auto">{children}</div>
      <div className="flex shrink-0 items-center gap-2 border-l border-slate-100 pl-3">{end}</div>
    </div>
  )
}

function PhaseTitle({
  icon: Icon,
  title,
  subtitle,
  badge,
}: {
  icon: typeof Trophy
  title: string
  subtitle: string
  badge?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-500 ring-1 ring-slate-200/70">
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2>
          {badge}
        </div>
        <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
      </div>
    </div>
  )
}

interface Props {
  job: Job
}

export function JobPhaseNav({ job }: Props) {
  const location = useLocation()
  const phase = currentPhaseSegment(location.pathname, job.id)
  const [panelOpen, setPanelOpen] = useState(false)

  const { data: settings } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings') as unknown as Promise<SystemSettings>,
  })

  const { data: finalistsData } = useQuery<FinalistsResponse>({
    queryKey: ['finalists', job.id],
    queryFn: () =>
      api.get(`/api/jobs/${job.id}/finalists`) as unknown as Promise<FinalistsResponse>,
    enabled: phase === 'finalists',
  })

  const screeningEnabled = settings?.screening_enabled !== false
  const finalists = finalistsData?.candidates ?? []

  const phases = useMemo(() => {
    if (!screeningEnabled) {
      return PHASES.filter((p) => p.segment !== 'screening')
    }
    return [...PHASES]
  }, [screeningEnabled])

  const activeIndex = phases.findIndex((p) => p.segment === phase)

  useEffect(() => {
    setPanelOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [panelOpen])

  const pipelineButton = (
    <button
      type="button"
      onClick={() => setPanelOpen(true)}
      className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
      aria-label="Open pipeline"
      aria-haspopup="dialog"
      aria-expanded={panelOpen}
    >
      <Menu className="h-4 w-4" />
      <span className="hidden sm:inline">Pipeline</span>
      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 sm:hidden">
        {phaseLabel(phase, phases)}
      </span>
    </button>
  )

  const toolbar =
    phase === 'interviews' ? (
      <InterviewRubricPanel job={job} headerEnd={pipelineButton} />
    ) : phase === 'shortlist' ? (
      <PhaseToolbar end={pipelineButton}>
        <ShortlistStatusTabs />
      </PhaseToolbar>
    ) : phase === 'screening' ? (
      <PhaseToolbar end={pipelineButton}>
        <ScreeningStatusTabs jobId={job.id} />
      </PhaseToolbar>
    ) : phase === 'finalists' ? (
      <PhaseToolbar
        end={
          <>
            <button
              type="button"
              disabled={finalists.length === 0}
              onClick={() => downloadFinalistsExcel(job.title, finalists)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Export Excel</span>
            </button>
            {pipelineButton}
          </>
        }
      >
        <PhaseTitle
          icon={Trophy}
          title="Finalists"
          subtitle="Approved after interview — ready for offer discussions"
          badge={
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-indigo-600">
              {finalists.length}
            </span>
          }
        />
      </PhaseToolbar>
    ) : (
      <PhaseToolbar end={pipelineButton}>
        <PhaseTitle
          icon={FileText}
          title="Job overview"
          subtitle={job.title}
        />
      </PhaseToolbar>
    )

  return (
    <>
      <div className="w-full min-w-0">{toolbar}</div>

      {panelOpen && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Hiring pipeline">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close pipeline panel"
            onClick={() => setPanelOpen(false)}
          />

          <aside
            className={cn(
              'absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white shadow-2xl',
              'animate-in slide-in-from-right duration-200',
            )}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Hiring pipeline</p>
                <p className="truncate text-xs text-slate-500">{job.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <Link
                to={jobPhasePath(job.id, '')}
                onClick={() => setPanelOpen(false)}
                className={cn(
                  'mb-4 block rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                  phase === ''
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50',
                )}
              >
                Job overview
              </Link>

              <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Pipeline steps
              </p>

              <ol className="relative">
                {phases.map(({ label, segment, icon: Icon, description }, index) => {
                  const to = jobPhasePath(job.id, segment)
                  const isActive = phase === segment
                  const isPast = activeIndex > index
                  const isLast = index === phases.length - 1

                  return (
                    <li key={segment} className="relative flex gap-3">
                      {!isLast && (
                        <span
                          className={cn(
                            'absolute left-[15px] top-9 h-[calc(100%-0.5rem)] w-px',
                            isPast || isActive ? 'bg-indigo-300' : 'bg-slate-200',
                          )}
                          aria-hidden
                        />
                      )}
                      <NavLink
                        to={to}
                        onClick={() => setPanelOpen(false)}
                        className={cn(
                          'group relative z-10 mb-2 flex min-w-0 flex-1 gap-3 rounded-xl p-2 transition-colors',
                          isActive ? 'bg-indigo-50' : 'hover:bg-slate-50',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                            isActive
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : isPast
                                ? 'border-indigo-400 bg-indigo-100 text-indigo-700'
                                : 'border-slate-200 bg-white text-slate-400 group-hover:border-slate-300 group-hover:text-slate-600',
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 pt-0.5">
                          <span
                            className={cn(
                              'block text-sm font-medium',
                              isActive ? 'text-indigo-700' : 'text-slate-800',
                            )}
                          >
                            {label}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-400">{description}</span>
                        </span>
                      </NavLink>
                    </li>
                  )
                })}
              </ol>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
